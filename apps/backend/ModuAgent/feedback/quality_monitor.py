"""响应质量监控器（P2-7: 升级支持 LLM-as-Judge）。

支持三种评估模式：
    - "rule":    基于关键词/长度/不确定词等规则评估（同步，原默认行为）
    - "llm":     使用独立 LLM 调用进行语义级评估（异步）
    - "hybrid":  规则 + LLM 双路评估后加权融合（异步）

LLM 模式需通过 `evaluator_llm` 注入一个具备异步推理能力的对象：
    - `BaseLLMReasoner` 子类（调用 `areason(prompt, context, **kwargs)`）
    - LangChain `ChatOpenAI`（调用 `ainvoke(messages)`）

当 LLM 评估失败（超时/解析错误）时，自动 fallback 到规则评估，确保闭环不中断。
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


class QualityMonitor:
    """响应质量监控器。

    P2-7: 在原有基于规则的评估之上，新增 LLM-as-Judge 模式。
    通过 `mode` 参数切换：
        - "rule":    `evaluate()` 同步调用规则评估（向后兼容）
        - "llm":     `evaluate_async()` 调用 LLM 评估，失败时 fallback 到规则
        - "hybrid":  规则与 LLM 双路评估后加权融合（rule_weight=0.4, llm_weight=0.6）

    评估维度：
        - relevance:     相关性 (0-1)
        - completeness:  完整性 (0-1)
        - confidence:    置信度 (0-1)（LLM 模式额外提供 accuracy）
        - tool_success:  工具调用成功率 (0-1)
        - overall:       综合得分 (0-1)
    """

    # 扣分关键词
    UNKNOWN_PATTERNS = ["不知道", "无法回答", "无法提供", "不清楚", "不确定"]
    # 低置信度模式
    LOW_CONFIDENCE_PATTERNS = [
        "可能", "也许", "不确定", "大概", "也许吧", "不太确定",
        "不是很确定", "我猜测", "我认为可能", "这可能是一个"
    ]
    # 工具调用失败的模式
    TOOL_FAILURE_PATTERNS = [
        "调用失败", "执行失败", "操作失败", "请求失败", "工具错误"
    ]

    # LLM Judge prompt 模板（输出 JSON）
    _JUDGE_SYSTEM_PROMPT = (
        "你是一个严格的回复质量评估器。请从相关性、完整性、准确性、置信度、"
        "工具调用成功率五个维度评估 Agent 回复质量，输出 0.00-1.00 之间的分数（保留 2 位小数）。"
        "若回复未涉及工具调用，tool_success 默认为 1.0。"
        "仅输出一个合法 JSON 对象，不要包含任何额外文字、Markdown 代码块或解释。"
    )

    _JUDGE_USER_TEMPLATE = (
        "【用户问题】\n{prompt}\n\n"
        "【Agent 回复】\n{response}\n\n"
        "【评估维度】\n"
        "1. relevance（相关性）：回复是否切题、与问题相关\n"
        "2. completeness（完整性）：回复是否完整回答了问题的各个方面\n"
        "3. accuracy（准确性）：回复中的事实信息是否准确无误\n"
        "4. confidence（置信度）：回复表达是否明确、是否避免不必要的模糊\n"
        "5. tool_success（工具调用成功率）：基于回复判断工具调用是否成功\n\n"
        "【输出格式】\n"
        '{{"relevance": 0.85, "completeness": 0.80, "accuracy": 0.90, '
        '"confidence": 0.85, "tool_success": 1.0, "overall": 0.87, '
        '"reasoning": "简短说明"}}'
    )

    # 从 LLM 输出中提取 JSON 的正则（容忍 ```json ... ``` 包裹）
    _JSON_PATTERN = re.compile(r"\{[^{}]*\}", re.DOTALL)

    def __init__(
        self,
        evaluator_llm: Optional[Any] = None,
        mode: str = "rule",
        llm_timeout: float = 10.0,
        llm_temperature: float = 0.0,
        llm_max_tokens: int = 256,
        hybrid_rule_weight: float = 0.4,
        hybrid_llm_weight: float = 0.6,
    ) -> None:
        """初始化质量监控器。

        Args:
            evaluator_llm: LLM Judge 实例（BaseLLMReasoner 或 LangChain ChatOpenAI）。
                mode="rule" 时可省略。
            mode: 评估模式，"rule" / "llm" / "hybrid"。
            llm_timeout: LLM 评估单次调用超时（秒）。
            llm_temperature: LLM Judge 温度参数（建议 0.0 以保证稳定）。
            llm_max_tokens: LLM Judge 最大输出 token 数。
            hybrid_rule_weight: hybrid 模式下规则结果权重。
            hybrid_llm_weight: hybrid 模式下 LLM 结果权重。
        """
        if mode not in ("rule", "llm", "hybrid"):
            logger.warning("Unknown quality_monitor mode '%s', falling back to 'rule'", mode)
            mode = "rule"

        if mode in ("llm", "hybrid") and evaluator_llm is None:
            logger.warning(
                "quality_monitor mode='%s' but evaluator_llm is None, falling back to 'rule'",
                mode,
            )
            mode = "rule"

        self._evaluator_llm = evaluator_llm
        self._mode = mode
        self._llm_timeout = llm_timeout
        self._llm_temperature = llm_temperature
        self._llm_max_tokens = llm_max_tokens
        self._hybrid_rule_weight = hybrid_rule_weight
        self._hybrid_llm_weight = hybrid_llm_weight

    @property
    def mode(self) -> str:
        """当前评估模式。"""
        return self._mode

    def evaluate(
        self,
        prompt: str,
        response: str,
        context: Dict[str, Any],
    ) -> Dict[str, float]:
        """评估响应质量（基于规则，同步）。

        规则：
        - 空响应 → 0分
        - 包含"不知道"/"无法回答" → 扣分
        - 工具调用失败 → 扣分
        - 低置信度感知 → 降低预期

        Args:
            prompt: 用户问题
            response: Agent 回复
            context: 上下文（可含 tool_result / tool_called）

        Returns:
            包含 relevance/completeness/confidence/tool_success/overall 的字典
        """
        if not response or not response.strip():
            return {
                "relevance": 0.0,
                "completeness": 0.0,
                "confidence": 0.0,
                "tool_success": 0.0,
                "overall": 0.0,
            }

        relevance = self._check_relevance(prompt, response, context)
        completeness = self._check_completeness(prompt, response, context)
        confidence = self._check_confidence(response)
        tool_success = self._check_tool_success(response, context)

        overall = (
            relevance * 0.3 +
            completeness * 0.3 +
            confidence * 0.2 +
            tool_success * 0.2
        )

        return {
            "relevance": relevance,
            "completeness": completeness,
            "confidence": confidence,
            "tool_success": tool_success,
            "overall": overall,
        }

    async def evaluate_async(
        self,
        prompt: str,
        response: str,
        context: Dict[str, Any],
    ) -> Dict[str, float]:
        """异步评估响应质量。

        按 `mode` 选择评估路径：
            - "rule":   直接调用 `evaluate()`（同步逻辑，无 await 开销）
            - "llm":    调用 LLM Judge，失败时 fallback 到规则
            - "hybrid": 规则 + LLM 双路并行，加权融合

        Args:
            prompt: 用户问题
            response: Agent 回复
            context: 上下文

        Returns:
            评估结果字典，与 `evaluate()` 结构兼容；
            LLM/hybrid 模式额外包含 `accuracy` 和 `evaluator_mode` 字段。
        """
        # 空响应短路：所有模式一致
        if not response or not response.strip():
            return {
                "relevance": 0.0,
                "completeness": 0.0,
                "confidence": 0.0,
                "tool_success": 0.0,
                "overall": 0.0,
                "evaluator_mode": self._mode,
            }

        if self._mode == "rule":
            result = self.evaluate(prompt, response, context)
            result["evaluator_mode"] = "rule"
            return result

        if self._mode == "llm":
            llm_result = await self._safe_evaluate_with_llm(prompt, response, context)
            if llm_result is not None:
                llm_result["evaluator_mode"] = "llm"
                return llm_result
            # fallback
            rule_result = self.evaluate(prompt, response, context)
            rule_result["evaluator_mode"] = "rule_fallback"
            return rule_result

        if self._mode == "hybrid":
            rule_result = self.evaluate(prompt, response, context)
            llm_result = await self._safe_evaluate_with_llm(prompt, response, context)
            if llm_result is None:
                rule_result["evaluator_mode"] = "rule_fallback"
                return rule_result
            blended = self._blend_results(rule_result, llm_result)
            blended["evaluator_mode"] = "hybrid"
            return blended

        # 兜底
        result = self.evaluate(prompt, response, context)
        result["evaluator_mode"] = "rule"
        return result

    async def _safe_evaluate_with_llm(
        self,
        prompt: str,
        response: str,
        context: Dict[str, Any],
    ) -> Optional[Dict[str, float]]:
        """调用 LLM Judge 并解析结果，失败时返回 None。

        任何异常（超时、网络、解析错误）都被捕获并记录，
        调用方据此决定是否 fallback 到规则评估。
        """
        if self._evaluator_llm is None:
            return None

        try:
            content = await asyncio.wait_for(
                self._invoke_judge_llm(prompt, response),
                timeout=self._llm_timeout,
            )
            return self._parse_judge_response(content)
        except asyncio.TimeoutError:
            logger.warning(
                "LLM Judge timed out after %.1fs, falling back to rule",
                self._llm_timeout,
            )
        except Exception as e:  # noqa: BLE001 - Judge 失败不应中断闭环
            logger.warning("LLM Judge failed: %s, falling back to rule", str(e))
        return None

    async def _invoke_judge_llm(self, prompt: str, response: str) -> str:
        """调用 evaluator_llm 获取 Judge 文本输出。

        通过鸭子类型兼容两种 LLM 接口：
            - `BaseLLMReasoner.areason(prompt, context, **kwargs)` → (content, usage, tool_calls)
            - LangChain `ChatOpenAI.ainvoke(messages)` → AIMessage
        """
        user_content = self._JUDGE_USER_TEMPLATE.format(
            prompt=prompt[:2000],  # 截断保护，避免超长输入
            response=response[:4000],
        )

        # 优先使用 BaseLLMReasoner 的 areason 接口
        if hasattr(self._evaluator_llm, "areason"):
            content, _usage, _tool_calls = await self._evaluator_llm.areason(
                prompt=user_content,
                context={},  # Judge 不需要历史/工具上下文
                temperature=self._llm_temperature,
                max_tokens=self._llm_max_tokens,
            )
            return content

        # LangChain ChatOpenAI 接口
        if hasattr(self._evaluator_llm, "ainvoke"):
            try:
                from langchain_core.messages import HumanMessage, SystemMessage
            except ImportError as e:
                raise RuntimeError(
                    "langchain_core is required for ChatOpenAI-based Judge"
                ) from e

            messages = [
                SystemMessage(content=self._JUDGE_SYSTEM_PROMPT),
                HumanMessage(content=user_content),
            ]
            result = await self._evaluator_llm.ainvoke(messages)
            return getattr(result, "content", str(result))

        raise TypeError(
            f"evaluator_llm must implement 'areason' or 'ainvoke', got "
            f"{type(self._evaluator_llm).__name__}"
        )

    def _parse_judge_response(self, content: str) -> Optional[Dict[str, float]]:
        """解析 LLM Judge 返回的 JSON 评分。

        LLM 输出可能包含：
            - 纯 JSON：`{"relevance": 0.85, ...}`
            - 代码块包裹：```json\n{...}\n```
            - 带前后多余文字的 JSON

        使用正则提取首个 JSON 对象，逐字段解析并钳制到 [0, 1]。
        """
        if not content or not content.strip():
            return None

        # 尝试直接解析（最理想情况）
        try:
            data = json.loads(content.strip())
        except json.JSONDecodeError:
            # fallback：用正则提取首个 {...} 块
            match = self._JSON_PATTERN.search(content)
            if not match:
                logger.warning("Failed to extract JSON from Judge response: %s", content[:200])
                return None
            try:
                data = json.loads(match.group(0))
            except json.JSONDecodeError as e:
                logger.warning("Failed to parse Judge JSON: %s, raw=%s", str(e), match.group(0)[:200])
                return None

        def _clamp(key: str, default: float = 0.5) -> float:
            val = data.get(key, default)
            try:
                val = float(val)
            except (TypeError, ValueError):
                return default
            return max(0.0, min(1.0, val))

        relevance = _clamp("relevance", 0.5)
        completeness = _clamp("completeness", 0.5)
        accuracy = _clamp("accuracy", 0.5)
        confidence = _clamp("confidence", 0.5)
        tool_success = _clamp("tool_success", 1.0)

        # overall 优先使用 LLM 给的，缺失则按规则加权计算
        overall_raw = data.get("overall")
        if overall_raw is not None:
            try:
                overall = max(0.0, min(1.0, float(overall_raw)))
            except (TypeError, ValueError):
                overall = self._compute_overall(relevance, completeness, accuracy, confidence, tool_success)
        else:
            overall = self._compute_overall(relevance, completeness, accuracy, confidence, tool_success)

        return {
            "relevance": relevance,
            "completeness": completeness,
            "accuracy": accuracy,
            "confidence": confidence,
            "tool_success": tool_success,
            "overall": overall,
        }

    @staticmethod
    def _compute_overall(
        relevance: float,
        completeness: float,
        accuracy: float,
        confidence: float,
        tool_success: float,
    ) -> float:
        """LLM 模式的综合得分加权（含 accuracy 维度）。"""
        return (
            relevance * 0.25 +
            completeness * 0.25 +
            accuracy * 0.25 +
            confidence * 0.15 +
            tool_success * 0.10
        )

    def _blend_results(
        self,
        rule_result: Dict[str, float],
        llm_result: Dict[str, float],
    ) -> Dict[str, float]:
        """hybrid 模式：规则与 LLM 结果加权融合。

        LLM 结果含 accuracy 维度，规则结果无此维度，融合时从 LLM 继承。
        """
        rw = self._hybrid_rule_weight
        lw = self._hybrid_llm_weight
        # 归一化权重（防止配置错误）
        total = rw + lw
        if total <= 0:
            rw, lw = 0.4, 0.6
        else:
            rw, lw = rw / total, lw / total

        blended: Dict[str, float] = {}
        # 规则与 LLM 共有的维度：加权平均
        common_keys = ["relevance", "completeness", "confidence", "tool_success"]
        for key in common_keys:
            r_val = rule_result.get(key, 0.5)
            l_val = llm_result.get(key, 0.5)
            blended[key] = r_val * rw + l_val * lw

        # accuracy 仅 LLM 提供，直接继承
        blended["accuracy"] = llm_result.get("accuracy", 0.5)

        # overall 重新加权（含 accuracy）
        blended["overall"] = self._compute_overall(
            blended["relevance"],
            blended["completeness"],
            blended["accuracy"],
            blended["confidence"],
            blended["tool_success"],
        )
        return blended

    # ===== 以下为原规则评估的内部方法（保持不变） =====

    def _check_relevance(
        self,
        prompt: str,
        response: str,
        context: Dict[str, Any],
    ) -> float:
        """检查响应与提示的相关性。

        低相关性特征：
        - 响应长度极短
        - 响应与提示关键词无重叠
        - 包含大量无关内容
        """
        if not response or not response.strip():
            return 0.0

        prompt_keywords = set(prompt.lower().split())
        response_keywords = set(response.lower().split())

        stop_words = {"的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这"}
        prompt_keywords -= stop_words
        response_keywords -= stop_words

        if not prompt_keywords:
            return 1.0

        overlap = len(prompt_keywords & response_keywords)
        keyword_ratio = overlap / len(prompt_keywords)

        response_length = len(response.strip())
        prompt_length = len(prompt.strip())

        if response_length < max(10, prompt_length * 0.1):
            if keyword_ratio < 0.2:
                return 0.2

        if keyword_ratio < 0.1:
            return 0.3

        relevance = min(1.0, keyword_ratio + 0.5)
        return max(0.3, relevance)

    def _check_completeness(
        self,
        prompt: str,
        response: str,
        context: Dict[str, Any],
    ) -> float:
        """检查响应的完整性。

        不完整响应特征：
        - 以问号结尾
        - 包含省略号
        - 句子被截断
        - 缺乏具体信息
        """
        if not response or not response.strip():
            return 0.0

        completeness = 1.0

        incomplete_patterns = ["？", "?", "..."]
        for pattern in incomplete_patterns:
            if response.rstrip().endswith(pattern):
                completeness -= 0.3

        truncated_markers = ["等等", "略", "等", "以下"]
        for marker in truncated_markers:
            if marker in response:
                completeness -= 0.15

        for unknown in self.UNKNOWN_PATTERNS:
            if unknown in response:
                completeness -= 0.25

        prompt_length = len(prompt.strip())
        response_length = len(response.strip())

        if prompt_length > 50 and response_length < 20:
            completeness -= 0.3
        elif prompt_length > 100 and response_length < 50:
            completeness -= 0.2

        return max(0.0, min(1.0, completeness))

    def _check_confidence(self, response: str) -> float:
        """检查响应的置信度。

        低置信度特征：
        - 包含"可能"、"也许"等不确定词汇
        - 语气犹豫
        - 使用模糊表达
        """
        if not response:
            return 0.0

        confidence = 1.0

        for pattern in self.LOW_CONFIDENCE_PATTERNS:
            if pattern in response:
                confidence -= 0.15

        uncertain_count = sum(1 for p in self.LOW_CONFIDENCE_PATTERNS if p in response)
        if uncertain_count > 2:
            confidence -= 0.2

        return max(0.0, min(1.0, confidence))

    def _check_tool_success(
        self,
        response: str,
        context: Dict[str, Any],
    ) -> float:
        """检查工具调用是否成功。

        工具调用失败的特征：
        - 响应中包含工具失败相关模式
        - context 中包含错误信息
        """
        tool_success = 1.0

        for pattern in self.TOOL_FAILURE_PATTERNS:
            if pattern in response:
                tool_success -= 0.4

        tool_result = context.get("tool_result")
        if tool_result is not None:
            if isinstance(tool_result, dict):
                if tool_result.get("error") or tool_result.get("success") is False:
                    tool_success -= 0.5
            elif isinstance(tool_result, str):
                if "error" in tool_result.lower() or "fail" in tool_result.lower():
                    tool_success -= 0.3

        if context.get("tool_called") and not tool_result:
            tool_success -= 0.3

        return max(0.0, min(1.0, tool_success))
