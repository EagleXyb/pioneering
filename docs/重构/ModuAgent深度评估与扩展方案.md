# ModuAgent 深度评估与代码级扩展方案

> 分析范围：`apps/backend/ModuAgent/` 全量源码（95 个 Python 文件）
> 分析维度：感知—推理—记忆—行动—反馈 五大能力闭环 + 扩展升级 + Plan & Execute 架构
> 文档版本：v1.0
> 编制日期：2026-07-03

---

## 目录

1. [五大能力评估与优化](#1-五大能力评估与优化)
   - 1.1 [感知层](#11-感知层多模态接入解析)
   - 1.2 [推理层](#12-推理层复杂逻辑拆解与幻觉控制)
   - 1.3 [记忆层](#13-记忆层上下文管理及长短期记忆转换)
   - 1.4 [行动层](#14-行动层工具调用稳定性与异常处理)
   - 1.5 [反馈层](#15-反馈层结果校验与自我纠错进化)
2. [扩展升级方案](#2-扩展升级方案)
   - 2.1 [记忆升级](#21-记忆升级业务知识产品规则用户画像的结构化沉淀与精准召回)
   - 2.2 [执行升级](#22-执行升级业务系统对接多角色协作skills技能与mcp能力)
   - 2.3 [场景配置](#23-场景配置业务场景数据驱动配置库)
3. [Plan & Execute 架构扩展](#3-plan--execute-架构扩展)

---

## 1. 五大能力评估与优化

### 当前闭环全景

```
                         ┌──────────────────────────────────────────────────────┐
                         │                   LangGraph 主图                      │
                         │                                                      │
  输入 ──→ perception ──→ [熔断?]──→ memory_query ──→ agent ⇄ tools ──→ response │
              │                         │                       │           │    │
              │                         │                       │           ▼    │
              │                    knowledge注入            tool_results  feedback │
              │                         │                       │           │    │
              ▼                         ▼                       ▼           ▼    │
          SecurityGuard            ChromaStore             ToolNode    Evolution  │
          (injection/PII)        (向量检索长期记忆)        (LangChain)  Orchestrator│
                                                                              │    │
                                                                         memory_update│
                                                                              │    │
                                                                              ▼    │
                                                                             END  │
                         └──────────────────────────────────────────────────────┘
```

**闭环现状评分**：

| 能力层 | 成熟度 | 核心优势 | 关键缺陷数 |
|--------|--------|----------|------------|
| 感知层 | ★★★☆☆ | 多模态覆盖+安全检测+融合策略 | 6 |
| 推理层 | ★★☆☆☆ | 原生function calling+低置信保守模式 | 7 |
| 记忆层 | ★★☆☆☆ | Chroma三级降级embedding+Checkpointer | 8 |
| 行动层 | ★★☆☆☆ | 重试退避+StructuredTool适配 | 6 |
| 反馈层 | ★★★☆☆ | rule/llm/hybrid三模式+进化闭环 | 5 |

---

### 1.1 感知层：多模态接入解析

#### 1.1.1 现状评估

**已实现能力**：

| 组件 | 文件 | 能力 |
|------|------|------|
| `TextPreprocessor` | `components/perception/text/rule_based.py` | 文本清洗(控制字符/零宽/方向字符)、智能截断(JSON感知+句子边界)、语种检测(Unicode区间+langdetect融合)、敏感词6级分级+上下文降级、安全检测(Injection/PII/注入风险)、质量评估、置信度加权计算 |
| `LLMParser` | `components/perception/text/llm_parser.py` | LLM意图识别+实体抽取+情感检测+质量评估；本地降级(spaCy NER/SnowNLP情感) |
| `ImageProcessor` | `components/perception/vision/image_processor.py` | OCR(tesseract/easyocr)双引擎+Base64解码+图像缩放限制 |
| `AudioProcessor` | `components/perception/audio/asr_processor.py` | Whisper(本地)+SpeechRecognition(在线)双引擎+格式自动检测+pydub转码 |
| `PerceptionFusion` | `components/perception/fusion.py` | 加权平均/最高置信度/多数投票三种融合策略 |
| `SecurityGuard` | `components/perception/security/guard.py` | Prompt Injection正则库(14模式)+PII检测(手机/身份证/银行卡/邮箱/IP)+注入风险标记+安全评分 |
| `pipeline.py` | `components/perception/pipeline.py` | 配置驱动的感知器链+异步并行执行(`run_perception_pipeline_async`) |

**关键代码路径**：`perception_node`（`nodes.py:95-115`）→ `run_perception_pipeline_async`（`pipeline.py:108-183`）→ 融合 → `_build_perception_result`（`nodes.py:54-92`）

#### 1.1.2 缺陷分析

**缺陷 P-1：多模态融合是"伪融合"——仅文本拼接，无跨模态对齐**

```python
# fusion.py:110-115 — 当前融合输出
"parsed_content": {
    "input_type": "fused",
    "text": "\n".join(merged_text_parts),  # ← 仅拼接各模态转文本结果
    "modalities": [...],
}
```

问题：图像OCR文本与音频ASR文本拼接后丢失了时空对应关系。例如用户展示一张产品图片并口述"这个多少钱"，融合后无法建立"这个"→图片中产品的指代关系。

**缺陷 P-2：无流式感知——所有感知器为批量同步**

`perception_node` 等待整个感知管线完成后才返回。对于长音频（如会议录音），用户需等待完整ASR结束才能得到响应，延迟可达数十秒。

**缺陷 P-3：图像场景描述未实现**

```python
# image_processor.py:36
enable_scene_description: bool = False,  # ← 默认关闭，且代码中无实现
```

`ImageProcessor` 仅做OCR文字提取，无法描述"图中是一只猫坐在沙发上"这类无文字图像的语义内容。

**缺陷 P-4：无文档/结构化数据感知**

不支持PDF、Excel、Word等结构化文档输入。企业场景中大量信息以文档形式存在。

**缺陷 P-5：置信度标定为启发式，非学习型**

```python
# rule_based.py:827-861 — 置信度为固定权重线性组合
confidence = (
    lang_conf * 0.25
    + security_score * 0.30
    + quality_score * 0.25
    + sensitivity_factor * 0.10
    + decoding_factor * 0.10
)
```

权重为人工设定，无数据驱动的校准机制，不同业务场景下最优权重差异大。

**缺陷 P-6：感知错误不回流——无感知质量反馈闭环**

感知层的误判（如语种检测错误、敏感词误判）不会反馈到感知层改进。`feedback_node` 仅评估最终响应质量，不评估中间感知步骤。

#### 1.1.3 代码扩展方向

**扩展 P-EXT-1：跨模态对齐融合器**

```python
# components/perception/fusion/cross_modal_aligner.py  ★新增

from __future__ import annotations
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass


@dataclass
class ModalitySegment:
    """单模态语义片段。"""
    modality: str               # text / image / audio
    content: str                # 文本化内容
    timestamp: float            # 时间戳（音频/视频用）
    spatial_box: Optional[Tuple[int, int, int, int]] = None  # 图像区域框
    confidence: float = 0.0
    entities: List[Dict[str, Any]] = None


class CrossModalAligner:
    """跨模态对齐融合器：建立模态间的语义对应关系。

    策略：
    1. 时间对齐：音频片段与同时间段的图像帧关联
    2. 指代消解：文本中的"这个/那个"关联到图像中的实体
    3. 互补合并：不同模态的实体互为补充（如图片OCR+口述描述）
    """

    def __init__(
        self,
        llm_adapter: Any = None,       # 用于指代消解的 LLM
        time_window_ms: int = 3000,    # 时间对齐窗口
    ):
        self._llm = llm_adapter
        self._time_window = time_window_ms

    def align(
        self,
        segments: List[ModalitySegment],
    ) -> Dict[str, Any]:
        """对齐多模态片段，输出带跨模态引用的融合结果。"""
        if not segments:
            return self._empty_result()

        # 1. 按模态分组
        by_modality: Dict[str, List[ModalitySegment]] = {}
        for seg in segments:
            by_modality.setdefault(seg.modality, []).append(seg)

        # 2. 时间对齐（音频/视频场景）
        aligned_pairs = self._temporal_align(by_modality)

        # 3. 指代消解（文本"这个" → 图像实体）
        if self._llm and "text" in by_modality and "image" in by_modality:
            aligned_pairs = self._coreference_resolve(aligned_pairs, by_modality)

        # 4. 构建融合结果
        return self._build_fused_result(aligned_pairs, by_modality)

    def _temporal_align(
        self,
        by_modality: Dict[str, List[ModalitySegment]],
    ) -> List[Dict[str, Any]]:
        """时间窗口对齐：将相近时间戳的跨模态片段配对。"""
        pairs: List[Dict[str, Any]] = []
        audio_segs = by_modality.get("audio", [])
        image_segs = by_modality.get("image", [])

        for audio in audio_segs:
            for image in image_segs:
                if abs(audio.timestamp - image.timestamp) <= self._time_window:
                    pairs.append({
                        "audio": audio,
                        "image": image,
                        "alignment": "temporal",
                    })
        return pairs

    def _coreference_resolve(
        self,
        pairs: List[Dict[str, Any]],
        by_modality: Dict[str, List[ModalitySegment]],
    ) -> List[Dict[str, Any]]:
        """使用 LLM 消解文本中的指代词到图像实体。"""
        text_segs = by_modality.get("text", [])
        image_entities = []
        for seg in by_modality.get("image", []):
            if seg.entities:
                image_entities.extend(seg.entities)

        if not text_segs or not image_entities:
            return pairs

        # 构建 LLM 指代消解 prompt
        deictic_words = ["这个", "那个", "它", "这", "那", "上面", "下面"]
        for text_seg in text_segs:
            if any(word in text_seg.content for word in deictic_words):
                resolved = self._llm_resolve(
                    text_seg.content, image_entities
                )
                if resolved:
                    pairs.append({
                        "text": text_seg,
                        "image_entity": resolved,
                        "alignment": "coreference",
                    })
        return pairs

    def _llm_resolve(
        self,
        text: str,
        entities: List[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        """调用 LLM 进行指代消解。"""
        if self._llm is None:
            return None
        entity_list = "\n".join(
            f"- {e.get('text', '')} ({e.get('label', '')})"
            for e in entities[:10]
        )
        prompt = (
            f"用户说：'{text}'\n"
            f"图像中检测到的实体：\n{entity_list}\n"
            f"用户说的'这个/那个'最可能指哪个实体？仅返回实体文本，无其他内容。"
        )
        try:
            result, _, _ = self._llm.generate(
                prompt=prompt, context={}, temperature=0.1, max_tokens=50,
            )
            resolved_text = result.strip()
            for e in entities:
                if e.get("text", "") == resolved_text:
                    return e
        except Exception:
            pass
        return None

    def _build_fused_result(
        self,
        pairs: List[Dict[str, Any]],
        by_modality: Dict[str, List[ModalitySegment]],
    ) -> Dict[str, Any]:
        """构建带跨模态引用的融合结果。"""
        all_texts = []
        for segs in by_modality.values():
            for seg in segs:
                if seg.content:
                    all_texts.append(seg.content)

        return {
            "parsed_content": {
                "input_type": "cross_modal_fused",
                "text": "\n".join(all_texts),
                "modalities": list(by_modality.keys()),
                "cross_modal_references": [
                    {
                        "type": p.get("alignment"),
                        "audio": p.get("audio").content if p.get("audio") else None,
                        "image_entity": p.get("image_entity"),
                    }
                    for p in pairs
                ],
            },
            "confidence": min(
                (seg.confidence for segs in by_modality.values() for seg in segs),
                default=0.5,
            ),
            "metadata": {
                "fusion_strategy": "cross_modal_align",
                "alignment_count": len(pairs),
                "modality_count": len(by_modality),
            },
        }

    def _empty_result(self) -> Dict[str, Any]:
        return {
            "parsed_content": {"input_type": "empty", "text": ""},
            "confidence": 0.0,
            "metadata": {"fusion_strategy": "none"},
        }
```

**扩展 P-EXT-2：流式感知管线**

```python
# components/perception/pipeline_streaming.py  ★新增

from __future__ import annotations
import asyncio
import logging
from typing import Any, AsyncGenerator, Dict, Optional

logger = logging.getLogger(__name__)


async def stream_perception_pipeline(
    input_data: Dict[str, Any],
    config: Any,
    registry: Any,
) -> AsyncGenerator[Dict[str, Any], None]:
    """流式感知管线：逐步输出感知结果，支持增量响应。

    适用于长音频/长文本场景，先返回部分结果让用户感知进展。

    Yields:
        感知增量事件：
        - {"type": "partial", "modality": "audio", "text": "...", "progress": 0.3}
        - {"type": "partial", "modality": "text", "text": "...", "progress": 1.0}
        - {"type": "final", "fused": {...}}
    """
    input_type = input_data.get("input_type", "text")
    routing = config.get("perception.routing", {})
    pipeline_config = routing.get(input_type, {})
    pipeline = pipeline_config.get("pipeline", ["text_preprocessor"])

    partial_results: Dict[str, Any] = {}

    for i, processor_name in enumerate(pipeline):
        perception = registry.get_perception(processor_name)
        if perception is None:
            continue

        progress = (i + 1) / len(pipeline)

        # 音频/视频感知器支持流式输出
        if hasattr(perception, 'perceive_stream'):
            async for chunk in perception.perceive_stream(
                input_type=input_type,
                raw_content=input_data.get("prompt", "").encode("utf-8"),
            ):
                partial_results[processor_name] = chunk
                yield {
                    "type": "partial",
                    "modality": input_type,
                    "text": chunk.get("text", ""),
                    "progress": progress,
                    "processor": processor_name,
                }
        else:
            # 同步感知器包装为异步
            try:
                result = await asyncio.to_thread(
                    perception.perceive,
                    input_type=input_type,
                    raw_content=input_data.get("prompt", "").encode("utf-8"),
                )
                partial_results[processor_name] = result
                yield {
                    "type": "partial",
                    "modality": input_type,
                    "text": result.get("parsed_content", {}).get("text", ""),
                    "progress": progress,
                    "processor": processor_name,
                }
            except Exception as e:
                logger.error("Perception '%s' failed: %s", processor_name, e)

    # 最终融合
    from components.perception.fusion import PerceptionFusion
    fusion = PerceptionFusion(
        strategy=config.get("perception.fusion.strategy", "weighted_average"),
        weights=config.get("perception.fusion.weights"),
    )
    fused = fusion.fuse(list(partial_results.values()))
    yield {"type": "final", "fused": fused}
```

**扩展 P-EXT-3：感知质量反馈注入**

在 `feedback_node` 中增加对感知中间结果的评估，将感知误判信号注入进化闭环：

```python
# nodes.py — make_feedback_node 内部增强（示意）

async def _feedback_node(state: ModuAgentState) -> dict:
    # ... 现有评估逻辑 ...

    # ★ 新增：感知质量评估
    perception_result = state.get("perception_result")
    if perception_result:
        perception_quality = _evaluate_perception_quality(
            perception_result, state.get("response", "")
        )
        if perception_quality.get("issues"):
            # 发布感知问题事件 → EvolutionSignalCollector 采集
            event_bus = get_event_bus()
            await event_bus.publish(AgentEvent(
                trace_id=state.get("trace_id", ""),
                session_id=state.get("session_id", ""),
                domain=EventDomain.PERCEPTION,
                action=EventAction.ANALYZE,
                metadata={
                    "perception_issue": perception_quality["issues"],
                    "confidence": str(perception_result.get("confidence", 0)),
                },
            ))

    return {...}


def _evaluate_perception_quality(
    perception_result: Dict[str, Any],
    response: str,
) -> Dict[str, Any]:
    """评估感知结果是否导致响应偏差。"""
    issues = []
    detected_lang = perception_result.get("detected_language")
    sensitivity = perception_result.get("metadata", {}).get("sensitivity_level", 0)

    # 检测语种与响应语种是否一致
    if detected_lang and detected_lang != "zh" and not _is_chinese(response):
        issues.append("language_mismatch")

    # 检测敏感度误判（用户无敏感意图但被标记为敏感）
    if sensitivity >= 3:
        issues.append("possible_sensitivity_false_positive")

    return {"issues": issues, "score": 1.0 - len(issues) * 0.2}
```

---

### 1.2 推理层：复杂逻辑拆解与幻觉控制

#### 1.2.1 现状评估

**已实现能力**：

| 组件 | 文件 | 能力 |
|------|------|------|
| `BaseLLMReasoner` | `components/reasoning/llm/base_llm.py` | httpx连接池复用、同步/异步/流式推理、原生function calling解析、temperature/max_tokens配置化 |
| 4 Provider适配 | `components/reasoning/llm/{deepseek,gpt,qwen,glm}.py` | GLM/DeepSeek/GPT/Qwen 四模型适配 |
| `build_chat_model` | `langgraph/adapters/llm_adapter.py` | LangChain ChatOpenAI构建、provider环境变量映射、streaming=True |
| `apply_llm_retry` | `langgraph/adapters/retry.py` | LangChain with_retry指数退避、瞬时异常重试(429/5xx/Timeout/Connection) |
| `make_agent_node` | `langgraph/nodes.py:334-450` | bind_tools原生function calling、低置信度保守温度、config_overrides per-session覆盖、感知上下文注入、长期知识注入 |
| `BaseReasoningStrategy` | `core/interfaces/reasoning.py:32-43` | 推理策略抽象接口（select_engine/should_fallback）——**已定义但未实现** |

**关键代码路径**：`agent_node`（`nodes.py:365-448`）→ `bound_llm.invoke(messages)` → ReAct循环（`route_after_agent`）

#### 1.2.2 缺陷分析

**缺陷 R-1：无复杂逻辑拆解——纯ReAct模式，无任务分解**

当前推理模式为单轮ReAct（`agent → tools → agent`循环），LLM在一个prompt中同时完成"理解任务+制定策略+执行步骤+整合结果"。对于多步骤复杂任务（如"分析竞品并生成报告"），LLM容易在中间步骤迷失。

`BaseReasoningStrategy`接口已定义（`reasoning.py:32-43`）但**无任何实现类**，`select_engine`和`should_fallback`从未被调用。

**缺陷 R-2：无幻觉检测与控制——仅靠temperature被动抑制**

```python
# nodes.py:423-429 — 低置信度时降低温度
if confidence < confidence_threshold:
    effective_temperature = conservative_temperature
```

唯一防幻觉手段是低置信度时降低temperature（0.3），但：
- 不检查生成内容是否与知识库一致
- 不验证工具返回结果是否被正确引用
- 不检测"编造事实"（如虚构API返回值）

**缺陷 R-3：无推理轨迹持久化——推理过程不可追溯**

ReAct循环中每步推理的思考过程（为什么选择这个工具、如何解读结果）仅存在于`messages`中，随会话结束丢失。无法事后分析推理质量或训练改进。

**缺陷 R-4：无模型fallback链**

`BaseReasoningStrategy.should_fallback`已定义但未使用。当主LLM（如DeepSeek）不可用时，无自动切换到备用模型（如GLM）的机制。`apply_llm_retry`仅重试同一模型。

**缺陷 R-5：无token预算管理**

```python
# base_llm.py:64-75 — max_tokens 固定值
def _resolve_max_tokens(self, kwargs):
    if "max_tokens" in kwargs:
        return kwargs["max_tokens"]
    return get_config().get("llm.max_tokens", 512)  # ← 固定512
```

不根据任务复杂度动态调整token预算。简单问候浪费512 tokens上限，复杂分析又可能被截断。

**缺陷 R-6：系统提示词硬编码——无模板管理**

```python
# nodes.py:380-381 — system_prompt 为字符串字面量
if system_prompt and (not messages or not isinstance(messages[0], SystemMessage)):
    messages.insert(0, SystemMessage(content=system_prompt))
```

系统提示词通过`create_agent(system_prompt=...)`传入，为纯字符串。无变量插值、无场景化模板、无A/B测试能力。

**缺陷 R-7：无思维链验证**

LLM输出的推理过程（如"因为A所以B因此C"）不被验证逻辑链是否自洽。可能出现"因为用户问天气→所以调用计算器"这类逻辑断裂。

#### 1.2.3 代码扩展方向

**扩展 R-EXT-1：幻觉检测守卫器**

```python
# components/reasoning/guardrails/hallucination_guard.py  ★新增

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


class HallucinationGuard:
    """幻觉检测守卫器：多维度验证生成内容的可靠性。

    检测维度：
    1. 事实一致性：生成内容是否与工具返回结果/知识库一致
    2. 数字准确性：响应中的数字是否与工具返回匹配
    3. 引用真实性：引用的来源是否真实存在
    4. 逻辑自洽性：推理链是否自洽
    """

    # 不确定语言模式（幻觉信号）
    _HALLUCINATION_SIGNALS = [
        r"据我(?:所知|了解|记忆)",        # 可能编造知识
        r"(?:根据|按照)(?:我的)?(?:经验|理解)",  # 无依据推断
        r"(?:大概|可能|也许)(?:是|有)(?:一个|一些)",  # 模糊编造
        r"(?:在|据)(?:某|某些|一个)(?:研究|报告|调查)(?:中|显示)",  # 虚构引用
    ]

    def __init__(
        self,
        llm_adapter: Any = None,
        enable_llm_verification: bool = False,
        max_verification_tokens: int = 128,
    ):
        self._llm = llm_adapter
        self._enable_llm_verify = enable_llm_verification
        self._max_verify_tokens = max_verification_tokens
        self._signal_patterns = [
            re.compile(p) for p in self._HALLUCINATION_SIGNALS
        ]

    def check(
        self,
        response: str,
        tool_results: List[Dict[str, Any]],
        knowledge: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """执行幻觉检测。

        Returns:
            {
                "hallucination_score": float,  # 0=安全, 1=高风险
                "issues": List[str],           # 检测到的问题
                "verified": bool,              # 是否通过验证
                "suggestions": List[str],      # 修正建议
            }
        """
        issues: List[str] = []
        score = 0.0

        # 1. 信号词检测
        signal_count = sum(
            1 for p in self._signal_patterns if p.search(response)
        )
        if signal_count > 0:
            issues.append(f"幻觉信号词命中 {signal_count} 处")
            score += 0.2 * signal_count

        # 2. 数字一致性检查
        number_issues = self._check_number_consistency(response, tool_results)
        if number_issues:
            issues.extend(number_issues)
            score += 0.3 * len(number_issues)

        # 3. 知识来源验证
        unverified_claims = self._check_knowledge_coverage(
            response, knowledge, tool_results
        )
        if unverified_claims:
            issues.append(f"{len(unverified_claims)} 处声明无知识库支撑")
            score += 0.15 * min(len(unverified_claims), 3)

        # 4. LLM 交叉验证（可选）
        if self._enable_llm_verify and self._llm and score > 0.3:
            llm_verify = self._llm_verify(response, tool_results, knowledge)
            if llm_verify:
                issues.append(f"LLM验证: {llm_verify.get('reason', '')}")
                score = max(score, llv_verify.get("score", score))

        score = min(1.0, score)
        return {
            "hallucination_score": round(score, 3),
            "issues": issues,
            "verified": score < 0.5,
            "suggestions": self._generate_suggestions(issues),
        }

    def _check_number_consistency(
        self,
        response: str,
        tool_results: List[Dict[str, Any]],
    ) -> List[str]:
        """检查响应中的数字是否与工具返回一致。"""
        issues = []
        # 提取响应中的数字
        response_numbers = set(re.findall(r'\b\d+(?:\.\d+)?\b', response))

        # 提取工具返回的数字
        tool_numbers = set()
        for tr in tool_results:
            result = tr.get("result", {})
            result_str = str(result)
            tool_numbers.update(re.findall(r'\b\d+(?:\.\d+)?\b', result_str))

        # 检查响应中的关键数字是否在工具结果中
        for num in response_numbers:
            if num not in tool_numbers and float(num) > 0:
                # 排除常见无害数字（如"1个"、"2步"）
                if float(num) > 10:  # 大数字更可能是事实性数据
                    issues.append(f"数字 '{num}' 未在工具结果中找到")

        return issues[:5]  # 限制报告数量

    def _check_knowledge_coverage(
        self,
        response: str,
        knowledge: List[Dict[str, Any]],
        tool_results: List[Dict[str, Any]],
    ) -> List[str]:
        """检查响应中的关键声明是否有知识库支撑。"""
        if not knowledge and not tool_results:
            return []

        # 合并所有可用知识文本
        knowledge_text = " ".join(
            item.get("content", "") for item in knowledge if isinstance(item, dict)
        )
        for tr in tool_results:
            knowledge_text += " " + str(tr.get("result", {}))

        # 提取响应中的关键名词短语（简化版）
        # 实际可用 spaCy 做 NP 提取
        claims = re.findall(r'[\u4e00-\u9fff]{2,8}', response)

        unverified = []
        for claim in claims:
            if len(claim) >= 3 and claim not in knowledge_text:
                unverified.append(claim)

        return unverified[:5]

    def _llm_verify(
        self,
        response: str,
        tool_results: List[Dict[str, Any]],
        knowledge: List[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        """使用 LLM 交叉验证响应可靠性。"""
        context_parts = []
        for tr in tool_results:
            context_parts.append(f"工具结果: {tr.get('result', {})}")
        for k in knowledge:
            context_parts.append(f"知识: {k.get('content', '')}")

        prompt = (
            f"请验证以下回复是否与给定事实一致。\n\n"
            f"事实依据：\n{' '.join(context_parts[:5])}\n\n"
            f"待验证回复：{response[:500]}\n\n"
            f"回复中是否有与事实矛盾的内容？返回JSON："
            f'{{"consistent": true/false, "score": 0.0-1.0, "reason": "简述"}}'
        )
        try:
            result, _, _ = self._llm.generate(
                prompt=prompt, context={}, temperature=0.0,
                max_tokens=self._max_verify_tokens,
            )
            import json
            # 尝试解析JSON
            start = result.find("{")
            end = result.rfind("}")
            if start != -1 and end != -1:
                return json.loads(result[start:end+1])
        except Exception as e:
            logger.warning("LLM verification failed: %s", e)
        return None

    @staticmethod
    def _generate_suggestions(issues: List[str]) -> List[str]:
        """根据问题生成修正建议。"""
        suggestions = []
        if any("幻觉信号词" in i for i in issues):
            suggestions.append("移除不确定语言，使用工具返回的确切数据")
        if any("数字" in i for i in issues):
            suggestions.append("核对响应中的数字与工具返回值")
        if any("无知识库支撑" in i for i in issues):
            suggestions.append("为关键声明添加来源引用或标注不确定性")
        return suggestions
```

**扩展 R-EXT-2：模型fallback策略实现**

```python
# components/reasoning/strategy/fallback_strategy.py  ★新增

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from core.interfaces.reasoning import BaseReasoningEngine, BaseReasoningStrategy

logger = logging.getLogger(__name__)


class FallbackReasoningStrategy(BaseReasoningStrategy):
    """模型 fallback 策略：主模型失败时自动切换备用模型。

    fallback 链配置示例：
        primary: deepseek
        fallback_chain: [glm, qwen, gpt]
    """

    def __init__(
        self,
        primary_engine: BaseReasoningEngine,
        fallback_engines: List[BaseReasoningEngine],
        max_retries_per_engine: int = 1,
    ):
        self._primary = primary_engine
        self._fallbacks = fallback_engines
        self._max_retries = max_retries_per_engine
        self._failure_counts: Dict[str, int] = {}

    def name(self) -> str:
        return "fallback_strategy"

    def select_engine(self, context: Dict[str, Any]) -> BaseReasoningEngine:
        """选择推理引擎：优先主引擎，失败次数过多则切换。"""
        # 主引擎失败次数未超阈值，使用主引擎
        if self._failure_counts.get("primary", 0) < self._max_retries:
            return self._primary

        # 选择失败次数最少的备用引擎
        for i, engine in enumerate(self._fallbacks):
            if self._failure_counts.get(f"fallback_{i}", 0) < self._max_retries:
                logger.info("Falling back to engine %d", i)
                return engine

        # 所有引擎都失败过，返回主引擎兜底
        return self._primary

    def should_fallback(self, error: Optional[Exception] = None) -> bool:
        """判断是否应 fallback。"""
        if error is None:
            return False

        # 瞬时错误 → fallback
        from langgraph.adapters.retry import _is_retryable_exception
        return _is_retryable_exception(error)

    def reason(
        self,
        prompt: str,
        context: Dict[str, Any],
        **kwargs: Any,
    ):
        """带 fallback 的推理调用。"""
        engines = [("primary", self._primary)] + [
            (f"fallback_{i}", e) for i, e in enumerate(self._fallbacks)
        ]

        last_error = None
        for name, engine in engines:
            try:
                result = engine.reason(prompt, context, **kwargs)
                # 成功则重置该引擎失败计数
                self._failure_counts[name] = 0
                return result
            except Exception as e:
                self._failure_counts[name] = self._failure_counts.get(name, 0) + 1
                last_error = e
                logger.warning(
                    "Engine '%s' failed (%s), trying next: %s",
                    name, type(e).__name__, str(e)[:200],
                )
                if not self.should_fallback(e):
                    raise  # 不可重试错误直接抛出

        raise last_error or RuntimeError("All engines failed")
```

**扩展 R-EXT-3：推理轨迹持久化**

```python
# components/reasoning/trace/reasoning_trace.py  ★新增

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class ReasoningStep:
    """单步推理轨迹。"""
    step_index: int
    step_type: str               # "think" / "act" / "observe" / "conclude"
    content: str
    tool_name: Optional[str] = None
    tool_params: Optional[Dict[str, Any]] = None
    tool_result: Optional[Any] = None
    timestamp: float = field(default_factory=time.time)
    tokens_used: int = 0


@dataclass
class ReasoningTrace:
    """完整推理轨迹。"""
    trace_id: str
    session_id: str
    user_id: str
    prompt: str
    steps: List[ReasoningStep] = field(default_factory=list)
    final_response: str = ""
    total_tokens: int = 0
    duration_ms: float = 0.0
    success: bool = True
    error: Optional[str] = None

    def add_step(self, step: ReasoningStep) -> None:
        self.steps.append(step)
        self.total_tokens += step.tokens_used

    def to_dict(self) -> Dict[str, Any]:
        return {
            "trace_id": self.trace_id,
            "session_id": self.session_id,
            "user_id": self.user_id,
            "prompt": self.prompt[:500],
            "steps": [
                {
                    "index": s.step_index,
                    "type": s.step_type,
                    "content": s.content[:200],
                    "tool": s.tool_name,
                    "tokens": s.tokens_used,
                    "timestamp": s.timestamp,
                }
                for s in self.steps
            ],
            "final_response": self.final_response[:500],
            "total_tokens": self.total_tokens,
            "duration_ms": self.duration_ms,
            "success": self.success,
            "error": self.error,
        }


class ReasoningTraceCollector:
    """推理轨迹收集器：从 LangGraph 消息流提取推理步骤。"""

    def __init__(self, store: Any = None):
        self._store = store  # 可选持久化存储
        self._current_trace: Optional[ReasoningTrace] = None

    def start_trace(
        self,
        trace_id: str,
        session_id: str,
        user_id: str,
        prompt: str,
    ) -> ReasoningTrace:
        """开始新的推理轨迹。"""
        self._current_trace = ReasoningTrace(
            trace_id=trace_id,
            session_id=session_id,
            user_id=user_id,
            prompt=prompt,
        )
        return self._current_trace

    def record_step(self, step: ReasoningStep) -> None:
        """记录推理步骤。"""
        if self._current_trace:
            self._current_trace.add_step(step)

    def finish_trace(
        self,
        final_response: str,
        duration_ms: float,
        success: bool = True,
        error: Optional[str] = None,
    ) -> Optional[ReasoningTrace]:
        """完成推理轨迹并持久化。"""
        if not self._current_trace:
            return None

        self._current_trace.final_response = final_response
        self._current_trace.duration_ms = duration_ms
        self._current_trace.success = success
        self._current_trace.error = error

        if self._store:
            try:
                self._store.put(
                    namespace=(self._current_trace.user_id, "traces"),
                    key=self._current_trace.trace_id,
                    value=self._current_trace.to_dict(),
                )
            except Exception as e:
                logger.warning("Failed to persist trace: %s", e)

        trace = self._current_trace
        self._current_trace = None
        return trace
```

**扩展 R-EXT-4：提示词模板管理器**

```python
# components/reasoning/prompt/template_manager.py  ★新增

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, Optional
import json

logger = logging.getLogger(__name__)


class PromptTemplateManager:
    """提示词模板管理器：支持变量插值、场景化模板、A/B测试。

    模板格式（JSON文件）：
    {
        "name": "customer_service",
        "version": "v1",
        "system_prompt": "你是{role}，负责{domain}。用户画像：{user_profile}",
        "variables": {
            "role": {"default": "客服助手", "type": "string"},
            "domain": {"default": "通用咨询", "type": "string"},
            "user_profile": {"default": "", "type": "string"}
        },
        "ab_variants": {
            "v2": {
                "system_prompt": "作为{role}，你的职责是{domain}。记住：{user_profile}",
            }
        }
    }
    """

    def __init__(self, template_dir: str = "config/prompts"):
        self._template_dir = Path(template_dir)
        self._cache: Dict[str, Dict[str, Any]] = {}

    def load_template(self, name: str) -> Dict[str, Any]:
        """加载模板定义。"""
        if name in self._cache:
            return self._cache[name]

        template_path = self._template_dir / f"{name}.json"
        if not template_path.exists():
            logger.warning("Template '%s' not found at %s", name, template_path)
            return {}

        with open(template_path, "r", encoding="utf-8") as f:
            template = json.load(f)

        self._cache[name] = template
        return template

    def render(
        self,
        template_name: str,
        variables: Optional[Dict[str, Any]] = None,
        variant: Optional[str] = None,
    ) -> str:
        """渲染提示词模板。

        Args:
            template_name: 模板名称
            variables: 变量值覆盖
            variant: A/B测试变体名（None=默认版本）

        Returns:
            渲染后的提示词字符串
        """
        template = self.load_template(template_name)
        if not template:
            return ""

        # 选择变体
        if variant and variant in template.get("ab_variants", {}):
            prompt_template = template["ab_variants"][variant].get(
                "system_prompt", template["system_prompt"]
            )
        else:
            prompt_template = template["system_prompt"]

        # 合并变量：默认值 < 传入变量
        merged_vars = {}
        for key, spec in template.get("variables", {}).items():
            merged_vars[key] = spec.get("default", "")
        if variables:
            merged_vars.update(variables)

        # 渲染
        try:
            return prompt_template.format(**merged_vars)
        except KeyError as e:
            logger.warning("Missing variable in template '%s': %s", template_name, e)
            return prompt_template

    def list_templates(self) -> List[str]:
        """列出所有可用模板。"""
        if not self._template_dir.exists():
            return []
        return [
            f.stem for f in self._template_dir.glob("*.json")
        ]
```

---

### 1.3 记忆层：上下文管理及长短期记忆转换

#### 1.3.1 现状评估

**已实现能力**：

| 组件 | 文件 | 能力 |
|------|------|------|
| `MemorySaver`/`SqliteSaver` | LangGraph内置 | 短期记忆：按thread_id自动持久化整个State |
| `ChromaLongTermMemory` | `components/memory/vector/chroma.py` | 长期记忆：三级embedding降级(SentenceTransformer→ONNX→hash)、cosine相似度检索、metadata富化(source_type/created_at/user_id) |
| `ChromaStore` | `langgraph/adapters/store_adapter.py` | 包装ChromaLongTermMemory为LangGraph BaseStore，支持get/search/put/delete/batch |
| `InMemoryStoreAdapter` | `langgraph/adapters/store_adapter.py:228-302` | 轻量级内存Store（测试用） |
| `make_memory_query_node` | `nodes.py:149-180` | 从Store检索长期知识，注入agent_node |
| `make_memory_update_node` | `nodes.py:196-265` | 将对话历史写入长期记忆 |
| `InMemoryShortTermMemory` | `components/memory/cache/short_term_memory.py` | 纯内存短期记忆（已退化为demo用，Checkpointer接管） |

**关键代码路径**：`memory_query_node`（`nodes.py:149-180`）→ `store.search((user_id, "knowledge"), query=cleaned_text, limit=5)` → `agent_node`注入knowledge → `memory_update_node`（`nodes.py:196-265`）→ `store.put((user_id, "history"), key, value)`

#### 1.3.2 缺陷分析

**缺陷 M-1：无长短期记忆转换机制——短期记忆不会自动沉淀为长期记忆**

```python
# nodes.py:226-256 — memory_update_node 仅存储原始对话文本
history_text = "\n".join(history_parts)
store.put(
    namespace=(user_id, "history"),
    key=f"{session_id}_{int(time.time())}",
    value={"content": history_text, ...},  # ← 原始文本，无信息提取
)
```

对话历史以原始文本存入向量库，无摘要、无实体提取、无重要性筛选。短期记忆（Checkpointer管理的messages）随session结束可能被清理，但不会自动提取关键信息沉淀为长期记忆。

**缺陷 M-2：无结构化知识存储——业务知识、产品规则无法沉淀**

ChromaDB仅支持文本向量检索，无法存储结构化业务知识（如"产品A的价格是X元"、"用户B的会员等级是VIP"）。这些信息需要精确匹配而非相似度检索。

**缺陷 M-3：无用户画像存储**

```python
# store_adapter.py:69-73 — user_id 仅用于命名空间隔离
def _resolve_user_id(self, namespace: Tuple[str, ...]) -> str:
    if namespace and len(namespace) > 0:
        return namespace[0]
    return "default"
```

user_id仅作为向量库的collection后缀，无独立的用户画像表（偏好、历史行为、特征标签）。

**缺陷 M-4：无相似度阈值过滤**

```python
# nodes.py:168-173 — 检索结果无阈值过滤
items = store.search(
    (user_id, "knowledge"),
    query=cleaned_text,
    limit=5,  # ← 仅限制数量，无score过滤
)
for item in items:
    knowledge.append(item.value)  # ← 全部注入，含低相关度结果
```

低相关度记忆被注入prompt，浪费token且可能误导推理。

**缺陷 M-5：无主动遗忘机制**

ChromaDB数据只增不减，无基于时间/频率/重要性的遗忘策略。长期运行后向量库膨胀，检索质量和性能下降。

**缺陷 M-6：记忆检索无重排序**

`store.search`返回的结果按向量相似度排序，但无cross-encoder重排序、无query扩展、无hybrid检索（向量+关键词）。

**缺陷 M-7：上下文窗口管理粗放**

```python
# config: memory.context_window = "last_5_turns"
```

固定取最近5轮对话，不根据对话内容重要性动态调整。关键信息可能在第6轮被截断丢失。

**缺陷 M-8：无记忆访问统计**

```python
# chroma.py:232-234 — metadata 无访问统计字段
enriched_meta["source_type"] = ...
enriched_meta["created_at"] = ...
enriched_meta["user_id"] = ...
# 缺少: last_accessed_at, access_count, importance_score
```

无法基于访问频率判断记忆价值，无法实现"常访问的记忆优先保留"。

#### 1.3.3 代码扩展方向

**扩展 M-EXT-1：记忆固化管线（短期→长期转换）**

```python
# components/memory/consolidation/memory_consolidator.py  ★新增

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class MemoryConsolidator:
    """记忆固化器：将短期对话历史提取为结构化长期记忆。

    固化流程：
    1. 收集session对话历史
    2. LLM提取关键信息（事实、偏好、决策、实体关系）
    3. 按类型分类存储到长期记忆
    4. 生成对话摘要

    触发时机：
    - session结束时
    - 对话轮次达到阈值（如20轮）
    - 显式调用
    """

    # 信息提取 prompt 模板
    _EXTRACTION_PROMPT = """请从以下对话中提取关键信息，返回JSON格式。

对话内容：
{conversation}

请提取：
1. facts: 用户提及的事实信息（如姓名、职业、位置等）
2. preferences: 用户偏好（如语言、风格、兴趣等）
3. decisions: 对话中达成的决策或结论
4. entities: 关键实体及其关系
5. summary: 对话摘要（100字以内）

返回格式：
{{"facts": [{{"key": "...", "value": "...", "confidence": 0.9}}], "preferences": [{{"key": "...", "value": "..."}}], "decisions": [{{"content": "...", "context": "..."}}], "entities": [{{"name": "...", "type": "...", "relation": "..."}}], "summary": "..."}}
仅返回JSON，无其他内容。"""

    def __init__(
        self,
        llm_adapter: Any = None,
        store: Any = None,
        trigger_interval: int = 20,  # 每20轮触发一次
    ):
        self._llm = llm_adapter
        self._store = store
        self._trigger_interval = trigger_interval

    async def consolidate(
        self,
        user_id: str,
        session_id: str,
        messages: List[Any],
    ) -> Dict[str, Any]:
        """执行记忆固化。

        Args:
            user_id: 用户标识
            session_id: 会话标识
            messages: 对话消息列表

        Returns:
            固化结果统计
        """
        if not messages or not self._llm:
            return {"consolidated": False, "reason": "no_messages_or_llm"}

        # 1. 构建对话文本
        conversation = self._messages_to_text(messages)
        if len(conversation) < 50:
            return {"consolidated": False, "reason": "conversation_too_short"}

        # 2. LLM 提取关键信息
        try:
            extracted = await self._extract_information(conversation)
        except Exception as e:
            logger.error("Information extraction failed: %s", e)
            return {"consolidated": False, "reason": f"extraction_failed: {e}"}

        # 3. 分类存储到长期记忆
        stats = {"facts": 0, "preferences": 0, "decisions": 0, "entities": 0}

        if self._store:
            # 存储事实
            for fact in extracted.get("facts", []):
                self._store_to_memory(
                    user_id, "facts", fact, session_id
                )
                stats["facts"] += 1

            # 存储偏好
            for pref in extracted.get("preferences", []):
                self._store_to_memory(
                    user_id, "preferences", pref, session_id
                )
                stats["preferences"] += 1

            # 存储决策
            for decision in extracted.get("decisions", []):
                self._store_to_memory(
                    user_id, "decisions", decision, session_id
                )
                stats["decisions"] += 1

            # 存储摘要
            summary = extracted.get("summary", "")
            if summary:
                self._store.put(
                    namespace=(user_id, "summaries"),
                    key=f"{session_id}_{int(time.time())}",
                    value={
                        "content": summary,
                        "session_id": session_id,
                        "type": "conversation_summary",
                        "created_at": int(time.time()),
                    },
                )
                stats["summary"] = summary

        stats["consolidated"] = True
        return stats

    async def _extract_information(
        self, conversation: str
    ) -> Dict[str, Any]:
        """使用 LLM 从对话中提取结构化信息。"""
        prompt = self._EXTRACTION_PROMPT.format(
            conversation=conversation[:4000]  # 限制长度
        )
        result, _, _ = self._llm.generate(
            prompt=prompt,
            context={},
            temperature=0.1,
            max_tokens=512,
        )

        # 解析JSON
        import json
        start = result.find("{")
        end = result.rfind("}")
        if start != -1 and end != -1:
            return json.loads(result[start:end+1])
        return {}

    def _store_to_memory(
        self,
        user_id: str,
        memory_type: str,
        data: Dict[str, Any],
        session_id: str,
    ) -> None:
        """将提取的信息存入长期记忆。"""
        content = data.get("value") or data.get("content") or str(data)
        self._store.put(
            namespace=(user_id, memory_type),
            key=f"{session_id}_{memory_type}_{int(time.time()*1000)}",
            value={
                "content": content,
                "type": memory_type,
                "session_id": session_id,
                "confidence": data.get("confidence", 1.0),
                "created_at": int(time.time()),
                "raw": data,
            },
        )

    @staticmethod
    def _messages_to_text(messages: List[Any]) -> str:
        """将消息列表转为对话文本。"""
        parts = []
        for msg in messages:
            role = "未知"
            content = ""
            if hasattr(msg, "type"):
                if msg.type == "human":
                    role = "用户"
                elif msg.type == "ai":
                    role = "助手"
                elif msg.type == "tool":
                    role = "工具"
                content = getattr(msg, "content", "")
            if content:
                parts.append(f"{role}: {content}")
        return "\n".join(parts)
```

**扩展 M-EXT-2：相似度阈值过滤器**

```python
# components/memory/threshold/similarity_filter.py  ★新增

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class SimilarityThresholdFilter:
    """向量检索相似度阈值过滤器。

    策略：
    1. 过滤 score < threshold 的结果
    2. 若过滤后为空且 fallback_enabled=True，返回 top_k（避免零召回）
    3. 可选：对过滤后结果按 score 降序重排序
    """

    def __init__(
        self,
        threshold: float = 0.65,
        fallback_top_k: int = 3,
        fallback_enabled: bool = True,
    ):
        self._threshold = threshold
        self._fallback_top_k = fallback_top_k
        self._fallback_enabled = fallback_enabled

    def filter(
        self,
        items: List[Any],
        query: Optional[str] = None,
    ) -> List[Any]:
        """过滤检索结果。

        Args:
            items: 检索结果列表（需有 score 属性或字段）
            query: 原始查询（用于日志）

        Returns:
            过滤后的结果列表
        """
        if not items:
            return []

        # 提取 score
        scored_items = []
        for item in items:
            score = self._extract_score(item)
            scored_items.append((score, item))

        # 按score降序
        scored_items.sort(key=lambda x: x[0], reverse=True)

        # 阈值过滤
        filtered = [
            item for score, item in scored_items
            if score >= self._threshold
        ]

        if filtered:
            return filtered

        # fallback：返回 top_k
        if self._fallback_enabled and self._fallback_top_k > 0:
            logger.debug(
                "No items above threshold %.2f, returning top %d (query=%s)",
                self._threshold, self._fallback_top_k,
                query[:100] if query else "N/A",
            )
            return [
                item for _, item in scored_items[:self._fallback_top_k]
            ]

        return []

    @staticmethod
    def _extract_score(item: Any) -> float:
        """从检索结果中提取相似度分数。"""
        if hasattr(item, "score"):
            return item.score
        if isinstance(item, dict):
            return item.get("score", item.get("relevance_score", 0.0))
        return 0.0
```

**扩展 M-EXT-3：记忆遗忘管理器**

```python
# components/memory/forgetting/forgetting_manager.py  ★新增

from __future__ import annotations

import logging
import math
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class ForgettingManager:
    """记忆遗忘管理器：基于艾宾浩斯遗忘曲线 + 访问频率管理记忆生命周期。

    遗忘决策因子：
    1. 时间衰减：记忆创建时间越久，保留优先级越低
    2. 访问频率：频繁访问的记忆保留优先级高
    3. 重要性评分：高重要性记忆保留优先级高
    4. 软删除策略：先标记 forgotten=True，保留期后物理删除
    """

    def __init__(
        self,
        store: Any = None,
        halflife_days: float = 30.0,        # 半衰期
        min_importance: float = 0.3,        # 低于此分数遗忘
        retention_days: int = 7,            # 软删除保留期
        gc_batch_size: int = 100,           # GC批量大小
    ):
        self._store = store
        self._halflife = halflife_days
        self._min_importance = min_importance
        self._retention_seconds = retention_days * 86400
        self._gc_batch = gc_batch_size

    def decay_score(
        self,
        created_at: float,
        access_count: int = 0,
        importance: float = 1.0,
        current_time: Optional[float] = None,
    ) -> float:
        """计算记忆的衰减后分数。

        基于改良的艾宾浩斯曲线：
        score = importance * exp(-ln(2) * age_days / halflife) * (1 + log(1 + access_count))

        Returns:
            0.0 ~ importance 的浮点数，越高越应保留
        """
        now = current_time or time.time()
        age_seconds = now - created_at
        age_days = age_seconds / 86400.0

        # 时间衰减因子
        decay_factor = math.exp(-math.log(2) * age_days / self._halflife)

        # 访问增强因子（访问越多越重要）
        access_boost = 1.0 + math.log(1 + access_count)

        return importance * decay_factor * access_boost

    def should_forget(
        self,
        memory_item: Dict[str, Any],
        current_time: Optional[float] = None,
    ) -> bool:
        """判断记忆是否应被遗忘。"""
        now = current_time or time.time()

        # 已标记软删除且超过保留期 → 物理删除
        if memory_item.get("forgotten"):
            forgotten_at = memory_item.get("forgotten_at", 0)
            if now - forgotten_at > self._retention_seconds:
                return True
            return False

        # 计算衰减分数
        created_at = memory_item.get("created_at", now)
        access_count = memory_item.get("access_count", 0)
        importance = memory_item.get("importance_score", 1.0)

        score = self.decay_score(
            created_at, access_count, importance, now
        )

        return score < self._min_importance

    async def gc_run(
        self,
        user_id: str,
        namespace: str = "knowledge",
    ) -> Dict[str, int]:
        """执行垃圾回收：扫描记忆并遗忘低分项。

        Returns:
            {"scanned": N, "soft_deleted": N, "hard_deleted": N}
        """
        if not self._store:
            return {"scanned": 0, "soft_deleted": 0, "hard_deleted": 0}

        stats = {"scanned": 0, "soft_deleted": 0, "hard_deleted": 0}

        try:
            # 获取该用户的所有记忆（无查询条件）
            items = self._store.search(
                namespace=(user_id, namespace),
                query=None,
                limit=self._gc_batch,
            )

            for item in items:
                stats["scanned"] += 1
                value = item.value if hasattr(item, "value") else item

                if self.should_forget(value):
                    if value.get("forgotten"):
                        # 物理删除
                        self._store.delete(
                            (user_id, namespace), item.key
                        )
                        stats["hard_deleted"] += 1
                    else:
                        # 软删除：标记 forgotten
                        value["forgotten"] = True
                        value["forgotten_at"] = time.time()
                        self._store.put(
                            (user_id, namespace),
                            item.key,
                            value,
                        )
                        stats["soft_deleted"] += 1

        except Exception as e:
            logger.error("Memory GC failed: %s", e)

        logger.info(
            "Memory GC for user %s: scanned=%d soft_deleted=%d hard_deleted=%d",
            user_id, stats["scanned"], stats["soft_deleted"], stats["hard_deleted"],
        )
        return stats
```

**扩展 M-EXT-4：记忆访问统计与metadata增强**

```python
# 修改 chroma.py 的 update 方法，增加访问统计字段

# chroma.py — update() 增强后
def update(self, user_id, new_data, metadata):
    # ... 现有逻辑 ...
    enriched_meta = dict(metadata)
    enriched_meta["source_type"] = enriched_meta.get("source_type", "conversation")
    enriched_meta["created_at"] = enriched_meta.get("created_at", int(time.time()))
    enriched_meta["user_id"] = user_id
    # ★ 新增字段
    enriched_meta["last_accessed_at"] = enriched_meta.get("created_at")
    enriched_meta["access_count"] = 0
    enriched_meta["importance_score"] = enriched_meta.get("importance_score", 1.0)
    # ...


# 修改 chroma.py 的 query 方法，更新访问统计
def query(self, user_id, context_window, required_fields):
    # ... 检索逻辑 ...
    for doc, meta, dist in zip(documents, metadatas, distances):
        item = {"content": doc, "relevance_score": round(1 - dist, 4)}
        # ★ 更新访问统计
        try:
            collection.update(
                ids=[item_id],
                metadatas=[{
                    **meta,
                    "last_accessed_at": int(time.time()),
                    "access_count": meta.get("access_count", 0) + 1,
                }],
            )
        except Exception:
            pass  # 统计更新失败不影响检索
    # ...
```

---

### 1.4 行动层：工具调用稳定性与异常处理

#### 1.4.1 现状评估

**已实现能力**：

| 组件 | 文件 | 能力 |
|------|------|------|
| `CalculatorTool` | `components/action/tools/calculator.py` | 数学计算（eval沙箱） |
| `SearchTool` | `components/action/tools/search.py` | DuckDuckGo(免费)+Tavily(需key)双引擎搜索 |
| `SyncActionExecutor` | `components/action/executors/synchronous.py` | 同步工具执行器（**LangGraph流程未使用**） |
| `ToolNode` | langgraph.prebuilt | LangGraph原生工具执行节点 |
| `wrap_modu_tool` | `langgraph/adapters/tool_adapter.py:79-123` | ModuAgent BaseTool → LangChain StructuredTool |
| `with_tool_retry` | `langgraph/adapters/retry.py:75-136` | 指数退避重试（仅重试瞬时异常） |
| `make_tool_result_processor` | `nodes.py:457-494` | 提取ToolMessage为tool_results |

**关键代码路径**：`agent_node` → `route_after_agent`（有tool_calls→tools）→ `ToolNode` → `tool_result_processor` → `agent_node`（ReAct循环）

#### 1.4.2 缺陷分析

**缺陷 A-1：工具仅2个——无业务系统对接能力**

现有工具仅Calculator和Search，无法对接企业业务系统（CRM/ERP/数据库/API）。Agent无法查询订单、管理库存、操作工单。

**缺陷 A-2：无MCP（Model Context Protocol）支持**

MCP已成为工具生态标准协议，当前架构不支持MCP。无法接入MCP市场中的现成工具集（如GitHub/Slack/数据库连接器）。

**缺陷 A-3：无Skills技能系统——工具无法组合复用**

多个工具的常见组合模式（如"搜索→分析→生成报告"）无法封装为可复用的Skill。每次都需要LLM自行规划工具调用序列。

**缺陷 A-4：工具结果无验证——直接信任工具返回**

```python
# tool_adapter.py:107-112 — 工具结果直接JSON序列化返回
def _invoke(**kwargs: Any) -> str:
    result = modu_tool.invoke(params=kwargs, context={})
    return json.dumps(result, ensure_ascii=False)
```

工具返回结果不经验证直接注入LLM context。工具返回错误数据（如API超时返回空对象）会导致LLM基于错误数据推理。

**缺陷 A-5：无异步工具执行**

```python
# tool_adapter.py:107 — _invoke 为同步函数
def _invoke(**kwargs: Any) -> str:
    result = modu_tool.invoke(params=kwargs, context={})
    return json.dumps(result, ensure_ascii=False)
```

`StructuredTool.from_function`接收同步函数，所有工具调用阻塞事件循环。对于IO密集型工具（如HTTP请求），应支持异步执行。

**缺陷 A-6：无工具权限控制**

所有注册的工具对所有用户可用，无基于角色/场景的工具访问控制。敏感工具（如删除数据、执行代码）无审批机制。

#### 1.4.3 代码扩展方向

**扩展 A-EXT-1：MCP协议适配器**

```python
# components/action/mcp/mcp_adapter.py  ★新增

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from core.interfaces.action import BaseTool

logger = logging.getLogger(__name__)


class MCPToolAdapter(BaseTool):
    """MCP（Model Context Protocol）工具适配器。

    将 MCP server 暴露的工具适配为 ModuAgent BaseTool，
    使 Agent 可接入 MCP 生态工具集。

    MCP 协议要点：
    - MCP server 通过 JSON-RPC 暴露 tools/list 和 tools/call 方法
    - 工具定义含 name/description/inputSchema
    - 调用通过 tools/call 传 name + arguments
    """

    def __init__(
        self,
        mcp_client: Any,       # MCP 客户端实例
        tool_name: str,
        tool_description: str,
        input_schema: Dict[str, Any],
    ):
        self._client = mcp_client
        self._name = tool_name
        self._description = tool_description
        self._schema = input_schema

    def name(self) -> str:
        return self._name

    def description(self) -> str:
        return self._description

    def parameters_schema(self) -> Dict:
        return self._schema

    def invoke(
        self,
        params: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """通过 MCP 协议调用工具。"""
        try:
            result = self._client.call_tool(
                tool_name=self._name,
                arguments=params,
            )
            return {
                "status": "success",
                "error_code": "",
                "data": result,
            }
        except Exception as e:
            logger.error("MCP tool '%s' failed: %s", self._name, e)
            return {
                "status": "error",
                "error_code": "MCP_001",
                "data": {"message": str(e)},
            }


class MCPRegistry:
    """MCP server 注册管理器。"""

    def __init__(self):
        self._servers: Dict[str, Any] = {}
        self._tools: Dict[str, MCPToolAdapter] = {}

    def register_server(
        self,
        name: str,
        mcp_client: Any,
    ) -> List[str]:
        """注册 MCP server 并发现其工具。

        Returns:
            注册成功的工具名列表
        """
        self._servers[name] = mcp_client

        # 发现工具
        try:
            tools_info = mcp_client.list_tools()
            registered = []
            for tool_info in tools_info:
                adapter = MCPToolAdapter(
                    mcp_client=mcp_client,
                    tool_name=tool_info["name"],
                    tool_description=tool_info.get("description", ""),
                    input_schema=tool_info.get("inputSchema", {}),
                )
                self._tools[tool_info["name"]] = adapter
                registered.append(tool_info["name"])

            logger.info(
                "MCP server '%s' registered with %d tools: %s",
                name, len(registered), registered,
            )
            return registered
        except Exception as e:
            logger.error("Failed to discover tools from MCP '%s': %s", name, e)
            return []

    def get_tool(self, name: str) -> Optional[MCPToolAdapter]:
        return self._tools.get(name)

    def list_tools(self) -> List[str]:
        return list(self._tools.keys())
```

**扩展 A-EXT-2：Skills技能组合系统**

```python
# components/action/skills/skill_manager.py  ★新增

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class SkillStep:
    """技能步骤定义。"""
    tool_name: str
    params_template: Dict[str, Any]       # 参数模板（支持变量引用）
    depends_on: Optional[str] = None       # 依赖的前置步骤名
    condition: Optional[str] = None        # 执行条件（表达式）


@dataclass
class Skill:
    """可复用技能：多个工具的组合调用模式。"""
    name: str
    description: str
    steps: List[SkillStep] = field(default_factory=list)
    input_schema: Dict[str, Any] = field(default_factory=dict)
    output_template: Optional[str] = None  # 输出格式模板

    def get_execution_order(self) -> List[SkillStep]:
        """按依赖关系排序步骤。"""
        ordered: List[SkillStep] = []
        remaining = list(self.steps)

        while remaining:
            ready = [
                s for s in remaining
                if s.depends_on is None
                or s.depends_on in [o.tool_name for o in ordered]
            ]
            if not ready:
                # 依赖循环，按原顺序添加
                ready = remaining
            ordered.extend(ready)
            remaining = [s for s in remaining if s not in ready]

        return ordered


class SkillExecutor:
    """技能执行器：按步骤执行技能。"""

    def __init__(self, registry: Any):
        self._registry = registry

    def execute(
        self,
        skill: Skill,
        inputs: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """执行技能。

        Args:
            skill: 技能定义
            inputs: 技能输入参数
            context: 执行上下文

        Returns:
            技能执行结果，含各步骤输出
        """
        step_results: Dict[str, Any] = {}
        ordered_steps = skill.get_execution_order()

        for step in ordered_steps:
            # 检查执行条件
            if step.condition:
                try:
                    if not eval(step.condition, {"results": step_results, "inputs": inputs}):
                        continue
                except Exception:
                    logger.warning("Condition eval failed for step %s", step.tool_name)
                    continue

            # 渲染参数模板
            params = self._render_params(
                step.params_template, inputs, step_results
            )

            # 获取并调用工具
            tool = self._registry.get_tool(step.tool_name)
            if tool is None:
                logger.error("Tool '%s' not found for skill step", step.tool_name)
                step_results[step.tool_name] = {
                    "status": "error",
                    "error_code": "TOOL_NOT_FOUND",
                }
                continue

            try:
                result = tool.invoke(params=params, context=context)
                step_results[step.tool_name] = result
            except Exception as e:
                logger.error("Skill step '%s' failed: %s", step.tool_name, e)
                step_results[step.tool_name] = {
                    "status": "error",
                    "error_code": "SKILL_STEP_FAILED",
                    "data": {"message": str(e)},
                }
                # 可配置：是否终止后续步骤
                break

        # 生成最终输出
        final_output = step_results
        if skill.output_template:
            try:
                final_output = self._render_output(
                    skill.output_template, step_results
                )
            except Exception as e:
                logger.warning("Output rendering failed: %s", e)

        return {
            "status": "success" if all(
                r.get("status") != "error" for r in step_results.values()
            ) else "partial",
            "data": final_output,
            "step_results": step_results,
        }

    def _render_params(
        self,
        template: Dict[str, Any],
        inputs: Dict[str, Any],
        results: Dict[str, Any],
    ) -> Dict[str, Any]:
        """渲染参数模板，替换变量引用。

        变量引用格式：${inputs.field} 或 ${results.tool_name.data.field}
        """
        import re
        rendered = {}
        var_pattern = re.compile(r'\$\{(\w+)\.([\w.]+)\}')

        for key, value in template.items():
            if isinstance(value, str):
                def replace_var(m):
                    source = m.group(1)   # inputs / results
                    path = m.group(2)     # field.subfield
                    if source == "inputs":
                        obj = inputs
                    elif source == "results":
                        obj = results
                    else:
                        return m.group(0)
                    for part in path.split("."):
                        if isinstance(obj, dict):
                            obj = obj.get(part, "")
                        else:
                            return ""
                    return str(obj)

                rendered[key] = var_pattern.sub(replace_var, value)
            else:
                rendered[key] = value

        return rendered

    def _render_output(
        self,
        template: str,
        results: Dict[str, Any],
    ) -> str:
        """渲染输出模板。"""
        import re
        var_pattern = re.compile(r'\$\{results\.([\w.]+)\}')

        def replace_var(m):
            path = m.group(1)
            obj = results
            for part in path.split("."):
                if isinstance(obj, dict):
                    obj = obj.get(part, "")
                else:
                    return ""
            return str(obj)

        return var_pattern.sub(replace_var, template)


class SkillRegistry:
    """技能注册中心。"""

    def __init__(self):
        self._skills: Dict[str, Skill] = {}

    def register_skill(self, skill: Skill) -> None:
        self._skills[skill.name] = skill
        logger.info("Registered skill: %s (%d steps)", skill.name, len(skill.steps))

    def get_skill(self, name: str) -> Optional[Skill]:
        return self._skills.get(name)

    def list_skills(self) -> List[str]:
        return list(self._skills.keys())
```

**扩展 A-EXT-3：工具结果验证器**

```python
# components/action/validation/result_validator.py  ★新增

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class ToolResultValidator:
    """工具结果验证器：在工具返回后、注入LLM前验证结果可靠性。

    验证维度：
    1. 结构验证：返回是否符合预期schema
    2. 空值检测：关键字段是否为空
    3. 超时检测：工具是否因超时返回默认值
    4. 错误传播：工具内部错误是否被正确标记
    """

    def __init__(self, custom_validators: Optional[Dict[str, Any]] = None):
        self._custom_validators = custom_validators or {}

    def validate(
        self,
        tool_name: str,
        result: Dict[str, Any],
        expected_schema: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """验证工具返回结果。

        Returns:
            {
                "valid": bool,
                "result": Dict,      # 验证后的结果（可能被修正）
                "warnings": List[str],
                "errors": List[str],
            }
        """
        warnings: List[str] = []
        errors: List[str] = []

        if not isinstance(result, dict):
            return {
                "valid": False,
                "result": {"raw": result},
                "warnings": [],
                "errors": ["Tool result is not a dict"],
            }

        # 1. 错误状态检测
        if result.get("status") == "error":
            return {
                "valid": False,
                "result": result,
                "warnings": [],
                "errors": [result.get("data", {}).get("message", "Tool error")],
            }

        data = result.get("data", {})

        # 2. 空值检测
        if not data:
            warnings.append("Tool returned empty data")
        elif isinstance(data, dict):
            for key, value in data.items():
                if value is None or value == "":
                    warnings.append(f"Field '{key}' is empty")

        # 3. Schema 验证
        if expected_schema:
            schema_errors = self._validate_schema(data, expected_schema)
            errors.extend(schema_errors)

        # 4. 自定义验证器
        if tool_name in self._custom_validators:
            try:
                custom_result = self._custom_validators[tool_name](data)
                if custom_result.get("errors"):
                    errors.extend(custom_result["errors"])
                if custom_result.get("warnings"):
                    warnings.extend(custom_result["warnings"])
            except Exception as e:
                warnings.append(f"Custom validator failed: {e}")

        # 5. 超时默认值检测
        if isinstance(data, dict):
            if data.get("source") == "timeout_fallback":
                warnings.append("Tool result may be a timeout fallback value")

        return {
            "valid": len(errors) == 0,
            "result": result,
            "warnings": warnings,
            "errors": errors,
        }

    def _validate_schema(
        self,
        data: Any,
        schema: Dict[str, Any],
    ) -> List[str]:
        """简单的schema验证。"""
        errors = []
        properties = schema.get("properties", {})
        required = schema.get("required", [])

        if not isinstance(data, dict):
            errors.append("Data is not a dict, cannot validate schema")
            return errors

        for field in required:
            if field not in data:
                errors.append(f"Missing required field: {field}")

        return errors
```

---

### 1.5 反馈层：结果校验与自我纠错进化

#### 1.5.1 现状评估

**已实现能力**：

| 组件 | 文件 | 能力 |
|------|------|------|
| `QualityMonitor` | `feedback/quality_monitor.py` | rule/llm/hybrid三模式评估、5维度(relevance/completeness/accuracy/confidence/tool_success)、LLM Judge带超时fallback |
| `FeedbackLoop` | `feedback/loop_controller.py` | 异步评估、累积样本统计、should_evolve门控(60%低于阈值→触发) |
| `EvolutionSignalCollector` | `feedback/evolution_signal.py` | EventBus订阅、信号采集、report_interval控制采样 |
| `EvolutionOrchestrator` | `evolution/evolution_orchestrator.py` | evaluate_and_evolve闭环、session_id作用域、config_overrides注入 |
| `ParameterTuneStrategy` | `evolution/strategy/parameter_tune.py` | temperature/max_iterations参数调优、config_overrides返回(非直接修改全局) |
| `RollbackMechanism` | `evolution/registry/rollback_mechanism.py` | 质量阈值回滚、稳定版本查找、回滚计数 |
| `VersionedComponentStore` | `evolution/registry/versioned_store.py` | 组件版本快照、序列化/反序列化、版本索引 |

**关键代码路径**：`feedback_node`（`nodes.py:548-623`）→ `EvolutionOrchestrator.evaluate_and_evolve` → `FeedbackLoop.evaluate` → `QualityMonitor.evaluate_async` → `should_evolve` → `ParameterTuneStrategy.analyze_and_adjust` → `config_overrides` → state

#### 1.5.2 缺陷分析

**缺陷 F-1：反馈仅事后——无过程中纠错**

`feedback_node`位于`response`之后、`memory_update`之前，仅评估最终响应。推理过程中的中间错误（如工具调用参数错误）不会被实时纠正，必须等整个流程结束才能发现问题。

**缺陷 F-2：无结果校验——不验证响应是否正确解决了用户问题**

`QualityMonitor`评估的是响应质量（相关性/完整性/置信度），但不验证响应是否**正确**。例如用户问"2+2等于几"，响应"等于5"可能获得高relevance和completeness分数（格式正确、切题），但事实错误。

**缺陷 F-3：参数调优仅2个参数——进化能力有限**

```python
# parameter_tune.py:39-41 — 仅调优 temperature 和 max_iterations
# 调优参数：
# - temperature：温度参数（影响创造性）
# - max_iterations：最大迭代次数（影响深度）
```

进化策略仅调整temperature和max_iterations，不优化：
- 系统提示词
- 工具选择策略
- 感知器配置
- 记忆检索参数
- 模型选择

**缺陷 F-4：无用户反馈采集——进化仅依赖自动评估**

进化信号完全来自`QualityMonitor`的自动评估和`EvolutionSignalCollector`的事件采集，无用户显式反馈（点赞/点踩/纠正）。用户反馈是最可靠的进化信号源。

**缺陷 F-5：RollbackMechanism未接入图流程**

```python
# rollback_mechanism.py — 独立组件，未被 graph/nodes/factory 引用
```

`RollbackMechanism`和`VersionedComponentStore`已实现但未接入LangGraph图流程。回滚不会自动触发，需要手动调用。

**缺陷 F-6：无成功经验学习——仅从失败进化**

`should_evolve`仅在quality_score低于阈值时触发进化。高质量响应（成功经验）不会被学习推广。例如某次temperature=0.5产生了高质量响应，系统不会自动记录并复用这个参数。

#### 1.5.3 代码扩展方向

**扩展 F-EXT-1：过程中纠错——工具调用前验证**

```python
# langgraph/nodes.py — 新增工具调用验证节点

def make_tool_validation_node(
    validator: Any,
    strict_mode: bool = False,
) -> Callable[[ModuAgentState], dict]:
    """创建工具调用验证节点。

    在 ToolNode 之前执行，验证 LLM 生成的 tool_calls 参数是否合理。
    若验证失败：
    - strict_mode=True：阻断执行，返回错误给 LLM 重新生成
    - strict_mode=False：注入警告，允许执行
    """

    def _validation_node(state: ModuAgentState) -> dict:
        messages = state.get("messages", [])
        if not messages:
            return {}

        last_msg = messages[-1]
        if not hasattr(last_msg, "tool_calls") or not last_msg.tool_calls:
            return {}

        issues = []
        for tc in last_msg.tool_calls:
            tool_name = tc.get("name", "")
            params = tc.get("args", {})

            # 参数完整性检查
            if not params:
                issues.append(f"Tool '{tool_name}' called with empty params")

            # 危险参数检查
            if tool_name in ("code_executor", "sql_query"):
                if not params.get("code") and not params.get("query"):
                    issues.append(f"Sensitive tool '{tool_name}' missing required param")

        if issues and strict_mode:
            # 阻断执行，返回 ToolMessage 让 LLM 重新规划
            from langchain_core.messages import ToolMessage
            return {
                "messages": [
                    ToolMessage(
                        content=f"Tool call validation failed: {'; '.join(issues)}. Please revise.",
                        tool_call_id=tc.get("id", ""),
                        name="validator",
                    )
                    for tc in last_msg.tool_calls
                ]
            }

        return {}

    return _validation_node
```

**扩展 F-EXT-2：用户反馈采集与注入**

```python
# feedback/user_feedback/feedback_collector.py  ★新增

from __future__ import annotations

import logging
import time
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


class UserFeedbackCollector:
    """用户反馈采集器：收集显式反馈作为进化信号。

    反馈类型：
    - thumbs_up / thumbs_down: 点赞/点踩
    - correction: 用户纠正（正确答案）
    - rating: 1-5 星评分
    - comment: 文字反馈
    """

    def __init__(self, store: Any = None):
        self._store = store
        self._pending: Dict[str, Dict[str, Any]] = {}  # 待反馈的响应

    def register_response(
        self,
        trace_id: str,
        session_id: str,
        user_id: str,
        response: str,
        context: Dict[str, Any],
    ) -> None:
        """注册待反馈的响应。"""
        self._pending[trace_id] = {
            "session_id": session_id,
            "user_id": user_id,
            "response": response,
            "context": context,
            "timestamp": time.time(),
        }

    def submit_feedback(
        self,
        trace_id: str,
        feedback_type: str,
        feedback_value: Any,
        comment: Optional[str] = None,
    ) -> Dict[str, Any]:
        """提交用户反馈。

        Returns:
            处理结果，含是否触发进化信号
        """
        pending = self._pending.pop(trace_id, None)
        if pending is None:
            return {"status": "error", "message": "trace_id not found"}

        feedback_record = {
            "trace_id": trace_id,
            "session_id": pending["session_id"],
            "user_id": pending["user_id"],
            "response": pending["response"],
            "feedback_type": feedback_type,
            "feedback_value": feedback_value,
            "comment": comment,
            "context": pending["context"],
            "timestamp": time.time(),
        }

        # 持久化
        if self._store:
            try:
                self._store.put(
                    namespace=(pending["user_id"], "feedback"),
                    key=trace_id,
                    value=feedback_record,
                )
            except Exception as e:
                logger.warning("Failed to persist feedback: %s", e)

        # 计算反馈分数
        score = self._feedback_to_score(feedback_type, feedback_value)

        return {
            "status": "success",
            "feedback_score": score,
            "should_trigger_evolution": score < 0.4,
        }

    @staticmethod
    def _feedback_to_score(feedback_type: str, value: Any) -> float:
        """将反馈转为 0-1 分数。"""
        if feedback_type == "thumbs_up":
            return 1.0 if value else 0.0
        if feedback_type == "thumbs_down":
            return 0.0 if value else 1.0
        if feedback_type == "rating":
            try:
                return float(value) / 5.0
            except (TypeError, ValueError):
                return 0.5
        if feedback_type == "correction":
            return 0.2  # 用户纠正表示原回答有误
        return 0.5
```

**扩展 F-EXT-3：成功经验学习器**

```python
# evolution/strategy/success_reinforcement.py  ★新增

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
from collections import defaultdict

logger = logging.getLogger(__name__)


class SuccessReinforcementStrategy:
    """成功经验强化策略：从高质量响应中学习最优参数。

    与 ParameterTuneStrategy（从失败学习）互补：
    - ParameterTuneStrategy: quality < threshold → 降低 temperature
    - SuccessReinforcement: quality > threshold → 记录当前参数为"成功参数"

    当累积足够的成功样本后，自动推荐最优参数组合。
    """

    def __init__(
        self,
        store: Any = None,
        success_threshold: float = 0.8,
        min_samples: int = 5,
    ):
        self._store = store
        self._success_threshold = success_threshold
        self._min_samples = min_samples
        self._success_records: List[Dict[str, Any]] = []

    def record_success(
        self,
        quality_score: float,
        config_overrides: Dict[str, Any],
        context: Dict[str, Any],
    ) -> None:
        """记录成功响应的参数组合。"""
        if quality_score < self._success_threshold:
            return

        record = {
            "quality_score": quality_score,
            "temperature": config_overrides.get("temperature"),
            "max_iterations": config_overrides.get("max_reasoning_iterations"),
            "context_features": self._extract_features(context),
            "timestamp": __import__("time").time(),
        }
        self._success_records.append(record)

        # 持久化
        if self._store:
            try:
                self._store.put(
                    namespace=("global", "success_records"),
                    key=f"success_{len(self._success_records)}",
                    value=record,
                )
            except Exception as e:
                logger.warning("Failed to persist success record: %s", e)

    def recommend_params(
        self,
        context: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """基于历史成功记录推荐参数。

        使用最近邻匹配：找到上下文特征最相似的成功记录，
        推荐其参数组合。

        Returns:
            推荐参数字典，无足够样本时返回 None
        """
        if len(self._success_records) < self._min_samples:
            return None

        current_features = self._extract_features(context)
        best_match = None
        best_similarity = -1.0

        for record in self._success_records:
            similarity = self._compute_similarity(
                current_features, record.get("context_features", {})
            )
            if similarity > best_similarity:
                best_similarity = similarity
                best_match = record

        if best_match and best_similarity > 0.5:
            return {
                "temperature": best_match.get("temperature"),
                "max_reasoning_iterations": best_match.get("max_iterations"),
                "confidence": best_similarity,
                "source": "success_reinforcement",
            }

        return None

    @staticmethod
    def _extract_features(context: Dict[str, Any]) -> Dict[str, Any]:
        """从上下文提取特征用于匹配。"""
        perception = context.get("perception_result", {})
        return {
            "input_type": perception.get("parsed_content", {}).get("input_type"),
            "detected_language": perception.get("detected_language"),
            "sensitivity_level": perception.get("metadata", {}).get("sensitivity_level", 0),
            "confidence": perception.get("confidence", 1.0),
            "has_entities": len(perception.get("entities", [])) > 0,
        }

    @staticmethod
    def _compute_similarity(
        features_a: Dict[str, Any],
        features_b: Dict[str, Any],
    ) -> float:
        """计算两个特征向量的相似度（Jaccard + 数值差异）。"""
        if not features_a or not features_b:
            return 0.0

        matches = 0
        total = 0

        for key in set(features_a.keys()) | set(features_b.keys()):
            total += 1
            va = features_a.get(key)
            vb = features_b.get(key)
            if va == vb:
                matches += 1
            elif isinstance(va, (int, float)) and isinstance(vb, (int, float)):
                # 数值特征：差异越小越相似
                diff = abs(va - vb)
                if diff < 0.2:
                    matches += 1 - diff

        return matches / total if total > 0 else 0.0
```

**扩展 F-EXT-4：RollbackMechanism接入图流程**

```python
# 修改 nodes.py — make_feedback_node 增强，接入 RollbackMechanism

def make_feedback_node(
    orchestrator: Any,
    rollback_mechanism: Any = None,  # ★ 新增参数
) -> Callable[[ModuAgentState], dict]:

    async def _feedback_node(state: ModuAgentState) -> dict:
        # ... 现有评估逻辑 ...
        result = await orchestrator.evaluate_and_evolve(output, context, session_id=session_id)

        # ★ 新增：回滚检查
        if rollback_mechanism and result.get("evaluation"):
            quality_score = result["evaluation"].get("quality_score", 1.0)
            # record_and_check 会自动判断是否需要回滚
            rollback_occurred = rollback_mechanism.record_and_check(
                component_name="reasoning_engine",
                version=str(state.get("config_overrides", {}).get("temperature", "default")),
                quality_score=quality_score,
            )
            if rollback_occurred:
                logger.warning("Rollback triggered due to low quality: %.3f", quality_score)
                # 重置 config_overrides 以使用回滚后的参数
                return {
                    **result,
                    "config_overrides": {},  # 清除覆盖，使用回滚后默认值
                    "rollback_triggered": True,
                }

        return result

    return _feedback_node
```

---

## 2. 扩展升级方案

### 2.1 记忆升级：业务知识、产品规则、用户画像的结构化沉淀与精准召回

#### 2.1.1 架构设计

```
memory/
├── cache/short_term_memory.py          # 现有（Checkpointer接管）
├── vector/chroma.py                    # 现有（增强metadata+阈值过滤）
├── relational/                         # ★ 新增：结构化记忆
│   ├── relational_store.py             # SQLite BaseStore 实现
│   ├── models.py                       # ORM 模型
│   ├── knowledge_repository.py         # 业务知识/产品规则仓库
│   └── user_profile_store.py           # 用户画像存储
├── consolidation/                      # ★ 新增：记忆固化
│   └── memory_consolidator.py          # 短期→长期转换（见 M-EXT-1）
├── forgetting/                         # ★ 新增：遗忘管理
│   └── forgetting_manager.py           # 艾宾浩斯曲线 GC（见 M-EXT-3）
├── threshold/                          # ★ 新增：检索过滤
│   └── similarity_filter.py            # 阈值过滤（见 M-EXT-2）
└── recall/                             # ★ 新增：精准召回
    ├── hybrid_retriever.py             # 向量+关键词混合检索
    ├── reranker.py                     # Cross-encoder 重排序
    └── query_expander.py               # 查询扩展
```

#### 2.1.2 结构化知识仓库实现

```python
# components/memory/relational/knowledge_repository.py  ★新增

from __future__ import annotations

import json
import logging
import sqlite3
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class KnowledgeRepository:
    """业务知识与产品规则仓库（SQLite实现）。

    支持的知识类型：
    - product_rules: 产品规则（价格、规格、流程）
    - business_faq: 业务FAQ（常见问题标准答案）
    - domain_concepts: 领域概念（术语定义、关系）
    - policies: 策略规范（合规要求、操作规范）
    """

    _SCHEMA_SQL = """
    CREATE TABLE IF NOT EXISTS knowledge_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        knowledge_type TEXT NOT NULL,         -- product_rules/business_faq/domain_concepts/policies
        key TEXT NOT NULL,                    -- 唯一键
        title TEXT,
        content TEXT NOT NULL,                -- 知识正文
        metadata TEXT,                        -- JSON 元数据
        tags TEXT,                            -- 逗号分隔标签
        priority INTEGER DEFAULT 0,           -- 优先级（高优先级优先召回）
        created_at INTEGER,
        updated_at INTEGER,
        UNIQUE(key)
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_type
        ON knowledge_items(knowledge_type);
    CREATE INDEX IF NOT EXISTS idx_knowledge_tags
        ON knowledge_items(tags);
    CREATE INDEX IF NOT EXISTS idx_knowledge_priority
        ON knowledge_items(priority DESC);
    """

    def __init__(self, db_path: str = "modu_knowledge.db"):
        self._db_path = db_path
        self._init_db()

    def _init_db(self) -> None:
        """初始化数据库。"""
        conn = sqlite3.connect(self._db_path)
        try:
            conn.executescript(self._SCHEMA_SQL)
            conn.commit()
        finally:
            conn.close()

    def add_knowledge(
        self,
        knowledge_type: str,
        key: str,
        content: str,
        title: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        tags: Optional[List[str]] = None,
        priority: int = 0,
    ) -> bool:
        """添加或更新知识条目。"""
        conn = sqlite3.connect(self._db_path)
        try:
            now = int(time.time())
            conn.execute(
                """INSERT OR REPLACE INTO knowledge_items
                   (knowledge_type, key, title, content, metadata, tags, priority, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    knowledge_type, key, title, content,
                    json.dumps(metadata or {}, ensure_ascii=False),
                    ",".join(tags or []),
                    priority,
                    now, now,
                ),
            )
            conn.commit()
            logger.info("Knowledge added: type=%s key=%s", knowledge_type, key)
            return True
        except Exception as e:
            logger.error("Failed to add knowledge: %s", e)
            return False
        finally:
            conn.close()

    def query(
        self,
        query_text: str,
        knowledge_type: Optional[str] = None,
        tags: Optional[List[str]] = None,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """关键词检索知识。

        使用 SQLite FTS（全文搜索）进行关键词匹配。
        """
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        try:
            sql = "SELECT * FROM knowledge_items WHERE content LIKE ?"
            params: list = [f"%{query_text}%"]

            if knowledge_type:
                sql += " AND knowledge_type = ?"
                params.append(knowledge_type)

            if tags:
                tag_conditions = " OR ".join(["tags LIKE ?" for _ in tags])
                sql += f" AND ({tag_conditions})"
                params.extend([f"%{tag}%" for tag in tags])

            sql += " ORDER BY priority DESC, updated_at DESC LIMIT ?"
            params.append(limit)

            rows = conn.execute(sql, params).fetchall()
            return [self._row_to_dict(row) for row in rows]
        finally:
            conn.close()

    def get_by_key(self, key: str) -> Optional[Dict[str, Any]]:
        """精确查找知识条目。"""
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        try:
            row = conn.execute(
                "SELECT * FROM knowledge_items WHERE key = ?", (key,)
            ).fetchone()
            return self._row_to_dict(row) if row else None
        finally:
            conn.close()

    def list_by_type(
        self,
        knowledge_type: str,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """按类型列出知识条目。"""
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                "SELECT * FROM knowledge_items WHERE knowledge_type = ? ORDER BY priority DESC LIMIT ?",
                (knowledge_type, limit),
            ).fetchall()
            return [self._row_to_dict(row) for row in rows]
        finally:
            conn.close()

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "knowledge_type": row["knowledge_type"],
            "key": row["key"],
            "title": row["title"],
            "content": row["content"],
            "metadata": json.loads(row["metadata"] or "{}"),
            "tags": row["tags"].split(",") if row["tags"] else [],
            "priority": row["priority"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
```

#### 2.1.3 用户画像存储实现

```python
# components/memory/relational/user_profile_store.py  ★新增

from __future__ import annotations

import json
import logging
import sqlite3
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class UserProfileStore:
    """用户画像存储：结构化管理用户特征、偏好、历史行为。

    表结构：
    - user_profiles: 用户基本信息与偏好
    - user_facts: 用户事实（姓名/职业/位置等）
    - user_events: 用户行为事件
    """

    _SCHEMA_SQL = """
    CREATE TABLE IF NOT EXISTS user_profiles (
        user_id TEXT PRIMARY KEY,
        name TEXT,
        language TEXT DEFAULT 'zh',
        timezone TEXT,
        preferences TEXT,                    -- JSON 偏好键值对
        persona_tags TEXT,                   -- JSON 标签列表
        interaction_count INTEGER DEFAULT 0,
        created_at INTEGER,
        updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS user_facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        fact_type TEXT,                      -- personal/preference/skill/relationship
        fact_key TEXT,
        fact_value TEXT,
        confidence REAL DEFAULT 1.0,
        source TEXT DEFAULT 'conversation',  -- conversation/inferred/explicit
        created_at INTEGER,
        last_accessed_at INTEGER,
        access_count INTEGER DEFAULT 0,
        UNIQUE(user_id, fact_type, fact_key)
    );

    CREATE INDEX IF NOT EXISTS idx_user_facts
        ON user_facts(user_id, fact_type);

    CREATE TABLE IF NOT EXISTS user_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        event_type TEXT,
        event_data TEXT,                     -- JSON
        trace_id TEXT,
        created_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_user_events
        ON user_events(user_id, created_at DESC);
    """

    def __init__(self, db_path: str = "modu_knowledge.db"):
        self._db_path = db_path
        self._init_db()

    def _init_db(self) -> None:
        conn = sqlite3.connect(self._db_path)
        try:
            conn.executescript(self._SCHEMA_SQL)
            conn.commit()
        finally:
            conn.close()

    def get_or_create_profile(
        self,
        user_id: str,
        default_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """获取或创建用户画像。"""
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        try:
            row = conn.execute(
                "SELECT * FROM user_profiles WHERE user_id = ?", (user_id,)
            ).fetchone()

            if row:
                return self._profile_row_to_dict(row)

            # 创建新画像
            now = int(time.time())
            conn.execute(
                """INSERT INTO user_profiles
                   (user_id, name, language, preferences, persona_tags,
                    interaction_count, created_at, updated_at)
                   VALUES (?, ?, 'zh', '{}', '[]', 0, ?, ?)""",
                (user_id, default_name, now, now),
            )
            conn.commit()
            return {
                "user_id": user_id,
                "name": default_name,
                "language": "zh",
                "preferences": {},
                "persona_tags": [],
                "interaction_count": 0,
            }
        finally:
            conn.close()

    def update_preference(
        self,
        user_id: str,
        key: str,
        value: Any,
    ) -> bool:
        """更新用户偏好。"""
        conn = sqlite3.connect(self._db_path)
        try:
            profile = self.get_or_create_profile(user_id)
            preferences = profile.get("preferences", {})
            preferences[key] = value

            conn.execute(
                "UPDATE user_profiles SET preferences = ?, updated_at = ? WHERE user_id = ?",
                (json.dumps(preferences, ensure_ascii=False), int(time.time()), user_id),
            )
            conn.commit()
            return True
        except Exception as e:
            logger.error("Failed to update preference: %s", e)
            return False
        finally:
            conn.close()

    def store_fact(
        self,
        user_id: str,
        fact_type: str,
        fact_key: str,
        fact_value: str,
        confidence: float = 1.0,
        source: str = "conversation",
    ) -> bool:
        """存储用户事实。"""
        conn = sqlite3.connect(self._db_path)
        try:
            now = int(time.time())
            conn.execute(
                """INSERT OR REPLACE INTO user_facts
                   (user_id, fact_type, fact_key, fact_value, confidence, source,
                    created_at, last_accessed_at, access_count)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)""",
                (user_id, fact_type, fact_key, fact_value, confidence, source, now, now),
            )
            conn.commit()
            return True
        except Exception as e:
            logger.error("Failed to store fact: %s", e)
            return False
        finally:
            conn.close()

    def query_facts(
        self,
        user_id: str,
        fact_type: Optional[str] = None,
        fact_key: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """查询用户事实。"""
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        try:
            sql = "SELECT * FROM user_facts WHERE user_id = ?"
            params: list = [user_id]

            if fact_type:
                sql += " AND fact_type = ?"
                params.append(fact_type)
            if fact_key:
                sql += " AND fact_key = ?"
                params.append(fact_key)

            sql += " ORDER BY confidence DESC, created_at DESC"

            rows = conn.execute(sql, params).fetchall()
            results = []
            for row in rows:
                results.append({
                    "fact_type": row["fact_type"],
                    "fact_key": row["fact_key"],
                    "fact_value": row["fact_value"],
                    "confidence": row["confidence"],
                    "source": row["source"],
                })
                # 更新访问统计
                conn.execute(
                    "UPDATE user_facts SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?",
                    (int(time.time()), row["id"]),
                )
            conn.commit()
            return results
        finally:
            conn.close()

    def record_event(
        self,
        user_id: str,
        event_type: str,
        event_data: Dict[str, Any],
        trace_id: Optional[str] = None,
    ) -> None:
        """记录用户行为事件。"""
        conn = sqlite3.connect(self._db_path)
        try:
            conn.execute(
                """INSERT INTO user_events
                   (user_id, event_type, event_data, trace_id, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (user_id, event_type, json.dumps(event_data, ensure_ascii=False),
                 trace_id, int(time.time())),
            )
            # 增加交互计数
            conn.execute(
                "UPDATE user_profiles SET interaction_count = interaction_count + 1, updated_at = ? WHERE user_id = ?",
                (int(time.time()), user_id),
            )
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def _profile_row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "user_id": row["user_id"],
            "name": row["name"],
            "language": row["language"],
            "timezone": row["timezone"],
            "preferences": json.loads(row["preferences"] or "{}"),
            "persona_tags": json.loads(row["persona_tags"] or "[]"),
            "interaction_count": row["interaction_count"],
        }
```

#### 2.1.4 混合检索与精准召回

```python
# components/memory/recall/hybrid_retriever.py  ★新增

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class HybridRetriever:
    """混合检索器：向量检索 + 关键词检索 + 知识库检索。

    融合策略：
    1. 向量检索（ChromaStore）：语义相似度
    2. 关键词检索（KnowledgeRepository）：精确匹配
    3. 用户画像注入（UserProfileStore）：个性化上下文

    最终结果经 reranker 重排序后返回。
    """

    def __init__(
        self,
        vector_store: Any = None,
        knowledge_repo: Any = None,
        user_profile_store: Any = None,
        reranker: Any = None,
        similarity_threshold: float = 0.65,
    ):
        self._vector_store = vector_store
        self._knowledge_repo = knowledge_repo
        self._user_profile_store = user_profile_store
        self._reranker = reranker
        self._threshold = similarity_threshold

    async def retrieve(
        self,
        query: str,
        user_id: str,
        top_k: int = 5,
        include_user_profile: bool = True,
    ) -> Dict[str, Any]:
        """执行混合检索。

        Returns:
            {
                "knowledge": List[Dict],     # 业务知识
                "memories": List[Dict],      # 长期记忆
                "user_profile": Dict,        # 用户画像
                "facts": List[Dict],         # 用户事实
            }
        """
        results: Dict[str, Any] = {
            "knowledge": [],
            "memories": [],
            "user_profile": {},
            "facts": [],
        }

        # 1. 向量检索（长期记忆）
        if self._vector_store:
            try:
                items = self._vector_store.search(
                    namespace=(user_id, "knowledge"),
                    query=query,
                    limit=top_k * 2,  # 多检索一些用于重排序
                )
                results["memories"] = [
                    {"content": item.value.get("content", ""),
                     "score": item.score,
                     "metadata": item.value}
                    for item in items
                    if hasattr(item, "score") and item.score >= self._threshold
                ]
            except Exception as e:
                logger.warning("Vector retrieval failed: %s", e)

        # 2. 知识库检索（业务规则/FAQ）
        if self._knowledge_repo:
            try:
                knowledge_items = self._knowledge_repo.query(
                    query_text=query,
                    limit=top_k,
                )
                results["knowledge"] = knowledge_items
            except Exception as e:
                logger.warning("Knowledge retrieval failed: %s", e)

        # 3. 用户画像注入
        if include_user_profile and self._user_profile_store:
            try:
                profile = self._user_profile_store.get_or_create_profile(user_id)
                results["user_profile"] = profile
                facts = self._user_profile_store.query_facts(user_id)
                results["facts"] = facts[:10]  # 限制数量
            except Exception as e:
                logger.warning("User profile retrieval failed: %s", e)

        # 4. 重排序
        if self._reranker and results["memories"]:
            results["memories"] = self._reranker.rerank(
                query, results["memories"], top_k=top_k
            )

        return results
```

#### 2.1.5 记忆升级集成到图流程

```python
# langgraph/nodes.py — 增强 memory_query_node

def make_enhanced_memory_query_node(
    hybrid_retriever: Any,
) -> Callable[[ModuAgentState], dict]:
    """创建增强版记忆查询节点（混合检索）。"""

    async def _memory_query_node(state: ModuAgentState) -> dict:
        user_id = state.get("user_id", "")
        cleaned_text = state.get("cleaned_text", "")

        if not cleaned_text:
            return {"knowledge": []}

        try:
            results = await hybrid_retriever.retrieve(
                query=cleaned_text,
                user_id=user_id,
                top_k=5,
            )

            # 构建注入 LLM 的知识文本
            knowledge_parts = []

            # 业务知识
            for item in results.get("knowledge", []):
                knowledge_parts.append(
                    f"[业务知识] {item.get('title', '')}: {item.get('content', '')}"
                )

            # 长期记忆
            for mem in results.get("memories", []):
                knowledge_parts.append(
                    f"[历史记忆] {mem.get('content', '')}"
                )

            # 用户事实
            for fact in results.get("facts", []):
                knowledge_parts.append(
                    f"[用户信息] {fact.get('fact_key')}: {fact.get('fact_value')}"
                )

            # 用户画像摘要
            profile = results.get("user_profile", {})
            if profile:
                knowledge_parts.append(
                    f"[用户画像] 语言:{profile.get('language','zh')} "
                    f"交互次数:{profile.get('interaction_count',0)}"
                )

            return {
                "knowledge": knowledge_parts,
                "retrieval_details": results,
            }
        except Exception as e:
            logger.warning("Enhanced memory query failed: %s", e)
            return {"knowledge": []}

    return _memory_query_node
```

---

### 2.2 执行升级：业务系统对接、多角色协作、Skills技能与MCP能力

#### 2.2.1 业务系统对接工具

```python
# components/action/tools/business_api.py  ★新增

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import httpx

from core.interfaces.action import BaseTool

logger = logging.getLogger(__name__)


class BusinessAPITool(BaseTool):
    """业务系统 API 调用工具。

    可配置对接任意 RESTful API 业务系统（CRM/ERP/订单/工单等）。
    通过配置文件定义 API 端点，运行时动态调用。

    配置示例（config/business_apis.yaml）：
        order_system:
          base_url: https://api.example.com/orders
          api_key_env: ORDER_API_KEY
          endpoints:
            query_order:
              method: GET
              path: /{order_id}
              params: [order_id]
            create_order:
              method: POST
              path: /
              body: [product_id, quantity, customer_id]
    """

    def __init__(
        self,
        system_name: str,
        base_url: str,
        endpoints: Dict[str, Any],
        api_key_env: str = "",
        timeout: float = 30.0,
    ):
        self._system = system_name
        self._base_url = base_url.rstrip("/")
        self._endpoints = endpoints
        self._api_key_env = api_key_env
        self._timeout = timeout

    def name(self) -> str:
        return f"business_api_{self._system}"

    def description(self) -> str:
        endpoint_list = ", ".join(self._endpoints.keys())
        return f"调用 {self._system} 业务系统，支持操作: {endpoint_list}"

    def parameters_schema(self) -> Dict:
        return {
            "type": "object",
            "properties": {
                "operation": {
                    "type": "string",
                    "description": f"操作名称，可选: {list(self._endpoints.keys())}",
                    "enum": list(self._endpoints.keys()),
                },
                "params": {
                    "type": "object",
                    "description": "操作参数",
                },
            },
            "required": ["operation", "params"],
        }

    def invoke(
        self,
        params: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        operation = params.get("operation")
        op_params = params.get("params", {})

        endpoint = self._endpoints.get(operation)
        if not endpoint:
            return {
                "status": "error",
                "error_code": "BIZ_001",
                "data": {"message": f"Unknown operation: {operation}"},
            }

        method = endpoint.get("method", "GET")
        path = endpoint.get("path", "/")

        # 路径参数替换
        for param_name in endpoint.get("params", []):
            if param_name in op_params:
                path = path.replace(f"{{{param_name}}}", str(op_params[param_name]))

        url = f"{self._base_url}{path}"
        headers = {"Content-Type": "application/json"}
        api_key = os.getenv(self._api_key_env, "") if self._api_key_env else ""
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        try:
            with httpx.Client(timeout=self._timeout) as client:
                if method == "GET":
                    response = client.get(url, headers=headers, params=op_params)
                elif method == "POST":
                    body_params = endpoint.get("body", [])
                    body = {k: op_params.get(k) for k in body_params}
                    response = client.post(url, headers=headers, json=body)
                elif method == "PUT":
                    body = {k: op_params.get(k) for k in endpoint.get("body", [])}
                    response = client.put(url, headers=headers, json=body)
                elif method == "DELETE":
                    response = client.delete(url, headers=headers)
                else:
                    return {
                        "status": "error",
                        "error_code": "BIZ_002",
                        "data": {"message": f"Unsupported method: {method}"},
                    }

                response.raise_for_status()
                return {
                    "status": "success",
                    "error_code": "",
                    "data": response.json(),
                }
        except httpx.HTTPStatusError as e:
            logger.error("Business API HTTP error: %s", e)
            return {
                "status": "error",
                "error_code": f"BIZ_{e.response.status_code}",
                "data": {"message": f"HTTP {e.response.status_code}: {e.response.text[:200]}"},
            }
        except Exception as e:
            logger.error("Business API error: %s", e)
            return {
                "status": "error",
                "error_code": "BIZ_500",
                "data": {"message": str(e)},
            }
```

#### 2.2.2 多角色协作框架

```python
# orchestration/roles/role_orchestrator.py  ★新增

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class AgentRole:
    """Agent 角色定义。"""
    name: str                                   # 角色名（如 "researcher"）
    system_prompt: str                          # 角色系统提示词
    tools: List[str] = field(default_factory=list)  # 可用工具名列表
    model: Optional[str] = None                 # 指定模型（None=默认）
    temperature: float = 0.7
    max_iterations: int = 3
    can_delegate: bool = False                  # 是否可以委派子任务
    max_delegations: int = 0                    # 最大委派次数


class RoleOrchestrator:
    """多角色协作编排器。

    管理多个具有不同职责的 Agent 角色，支持：
    - 角色间任务委派
    - 角色专属工具集
    - 角色专属系统提示词
    - 协作流程编排

    使用方式：
    1. 注册角色定义
    2. 主角色接收任务
    3. 主角色可委派子任务给其他角色
    4. 各角色结果汇总为最终响应
    """

    def __init__(self, registry: Any = None):
        self._roles: Dict[str, AgentRole] = {}
        self._registry = registry

    def register_role(self, role: AgentRole) -> None:
        """注册角色。"""
        self._roles[role.name] = role
        logger.info("Registered role: %s (tools=%s)", role.name, role.tools)

    def get_role(self, name: str) -> Optional[AgentRole]:
        return self._roles.get(name)

    def list_roles(self) -> List[str]:
        return list(self._roles.keys())

    def build_role_config(
        self,
        role_name: str,
        base_config: Any,
    ) -> Dict[str, Any]:
        """构建角色专属配置。

        Returns:
            角色专属的 configurable 字典，用于 create_agent
        """
        role = self._roles.get(role_name)
        if not role:
            return {}

        config = {
            "system_prompt": role.system_prompt,
            "tools": role.tools,
        }
        if role.model:
            config["llm_provider"] = role.model
        config["temperature"] = role.temperature

        return config

    def plan_delegation(
        self,
        task: str,
        primary_role: str,
        available_roles: List[str],
    ) -> List[Dict[str, Any]]:
        """规划任务委派（简化版：基于关键词匹配角色）。

        实际场景应使用 LLM 做任务分解与角色分配。

        Returns:
            委派计划列表：[{"role": "...", "subtask": "...", "depends_on": "..."}]
        """
        # 简化：将任务分配给所有可用角色
        # 实际应由 primary_role 的 LLM 决定
        plan = []
        for role_name in available_roles:
            if role_name == primary_role:
                continue
            role = self._roles.get(role_name)
            if role and role.can_delegate:
                plan.append({
                    "role": role_name,
                    "subtask": task,
                    "depends_on": None,
                })
        return plan


# 角色定义示例
DEFAULT_ROLES = {
    "coordinator": AgentRole(
        name="coordinator",
        system_prompt=(
            "你是任务协调员。分析用户请求，决定需要哪些角色协作，"
            "分配子任务，汇总各角色结果。不直接执行具体任务。"
        ),
        tools=[],
        temperature=0.3,
        can_delegate=True,
        max_delegations=5,
    ),
    "researcher": AgentRole(
        name="researcher",
        system_prompt=(
            "你是信息研究员。负责搜索、收集、整理信息。"
            "使用搜索工具获取实时信息，使用知识库查询业务规则。"
        ),
        tools=["search_engine", "knowledge_query"],
        temperature=0.5,
        can_delegate=False,
    ),
    "analyst": AgentRole(
        name="analyst",
        system_prompt=(
            "你是数据分析师。负责分析数据、计算指标、生成洞察。"
            "使用计算器和数据分析工具。"
        ),
        tools=["calculator", "business_api_analytics"],
        temperature=0.3,
        can_delegate=False,
    ),
    "writer": AgentRole(
        name="writer",
        system_prompt=(
            "你是内容撰写员。负责将分析和研究结果整理为用户友好的回复。"
            "注重表达清晰、结构完整。"
        ),
        tools=[],
        temperature=0.7,
        can_delegate=False,
    ),
}
```

#### 2.2.3 Skills技能注册与调用

将前面定义的 `SkillExecutor` 和 `SkillRegistry` 集成到工具系统：

```python
# components/action/skills/skill_tool_adapter.py  ★新增

from __future__ import annotations

import logging
from typing import Any, Dict

from components.action.skills.skill_manager import Skill, SkillExecutor
from core.interfaces.action import BaseTool

logger = logging.getLogger(__name__)


class SkillToolAdapter(BaseTool):
    """将 Skill 适配为 BaseTool，使 LLM 可以选择调用整个技能。"""

    def __init__(self, skill: Skill, executor: SkillExecutor):
        self._skill = skill
        self._executor = executor

    def name(self) -> str:
        return f"skill_{self._skill.name}"

    def description(self) -> str:
        return f"[技能] {self._skill.description}"

    def parameters_schema(self) -> Dict:
        return self._skill.input_schema

    def invoke(
        self,
        params: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """执行技能。"""
        try:
            result = self._executor.execute(
                skill=self._skill,
                inputs=params,
                context=context,
            )
            return result
        except Exception as e:
            logger.error("Skill '%s' failed: %s", self._skill.name, e)
            return {
                "status": "error",
                "error_code": "SKILL_001",
                "data": {"message": str(e)},
            }
```

---

### 2.3 场景配置：业务场景数据驱动配置库

#### 2.3.1 问题分析

当前系统的场景逻辑硬编码在多处：

```python
# 硬编码示例1: 感知路由（runtime_config.py:62-73）
"routing": {
    "text": {"pipeline": ["text_preprocessor", "llm_parser"]},
    "image": {"pipeline": ["image_processor", "text_preprocessor"]},
    "audio": {"pipeline": ["audio_processor", "text_preprocessor"]},
}

# 硬编码示例2: 系统提示词（factory.py:239）
effective_system_prompt = configurable.get("system_prompt", system_prompt)

# 硬编码示例3: 工具集选择（factory.py:221-222）
tool_names = configurable.get("tools")
tools = build_langchain_tools(tool_names=tool_names, config=runtime_config)

# 硬编码示例4: 敏感词规则（rule_based.py:34-54）
SENSITIVITY_PATTERNS: Dict[int, List[re.Pattern]] = {
    5: [re.compile(r"\b(?:password|passwd)\s*[=:]\s*\S+", re.IGNORECASE), ...],
    ...
}
```

不同业务场景（如客服/技术支持/销售/内部助手）需要不同的：
- 系统提示词
- 工具集
- 感知管线配置
- 敏感词规则
- LLM参数
- 记忆策略

#### 2.3.2 场景配置库架构

```python
# config/scenario/scenario_config.py  ★新增

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class ScenarioConfig:
    """单个业务场景的配置定义。"""

    def __init__(
        self,
        name: str,
        display_name: str = "",
        description: str = "",
        system_prompt: str = "",
        tools: Optional[List[str]] = None,
        skills: Optional[List[str]] = None,
        llm_config: Optional[Dict[str, Any]] = None,
        perception_config: Optional[Dict[str, Any]] = None,
        memory_config: Optional[Dict[str, Any]] = None,
        sensitivity_rules: Optional[Dict[str, Any]] = None,
        roles: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        self.name = name
        self.display_name = display_name or name
        self.description = description
        self.system_prompt = system_prompt
        self.tools = tools or []
        self.skills = skills or []
        self.llm_config = llm_config or {}
        self.perception_config = perception_config or {}
        self.memory_config = memory_config or {}
        self.sensitivity_rules = sensitivity_rules or {}
        self.roles = roles or []
        self.metadata = metadata or {}

    def to_configurable(self) -> Dict[str, Any]:
        """转为 LangGraph configurable 字段。"""
        configurable: Dict[str, Any] = {}

        if self.system_prompt:
            configurable["system_prompt"] = self.system_prompt
        if self.tools:
            configurable["tools"] = self.tools

        configurable.update(self.llm_config)

        return configurable

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ScenarioConfig":
        return cls(
            name=data["name"],
            display_name=data.get("display_name", ""),
            description=data.get("description", ""),
            system_prompt=data.get("system_prompt", ""),
            tools=data.get("tools", []),
            skills=data.get("skills", []),
            llm_config=data.get("llm_config", {}),
            perception_config=data.get("perception_config", {}),
            memory_config=data.get("memory_config", {}),
            sensitivity_rules=data.get("sensitivity_rules", {}),
            roles=data.get("roles", []),
            metadata=data.get("metadata", {}),
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "display_name": self.display_name,
            "description": self.description,
            "system_prompt": self.system_prompt,
            "tools": self.tools,
            "skills": self.skills,
            "llm_config": self.llm_config,
            "perception_config": self.perception_config,
            "memory_config": self.memory_config,
            "sensitivity_rules": self.sensitivity_rules,
            "roles": self.roles,
            "metadata": self.metadata,
        }


class ScenarioRegistry:
    """场景配置注册中心：数据驱动的场景管理。

    配置文件目录结构：
    config/scenarios/
    ├── customer_service.json
    ├── tech_support.json
    ├── sales_assistant.json
    └── internal_helper.json

    场景配置文件示例（customer_service.json）：
    {
        "name": "customer_service",
        "display_name": "客服助手",
        "description": "处理客户咨询、投诉、工单查询",
        "system_prompt": "你是专业客服助手。遵循服务规范，语气友善...",
        "tools": ["search_engine", "business_api_crm", "knowledge_query"],
        "skills": ["complaint_handling", "order_tracking"],
        "llm_config": {
            "llm_provider": "glm",
            "temperature": 0.3,
            "max_tokens": 1024
        },
        "perception_config": {
            "sensitivity_threshold": 3,
            "enable_deep_parsing": true,
            "fusion": {"strategy": "weighted_average", "weights": {"text": 0.7, "image": 0.2, "audio": 0.1}}
        },
        "memory_config": {
            "context_window": "last_10_turns",
            "similarity_threshold": 0.7,
            "enable_consolidation": true
        },
        "sensitivity_rules": {
            "custom_patterns": {"5": ["投诉.*领导", "曝光.*媒体"]},
            "context_reduction": true
        },
        "roles": ["coordinator", "researcher"]
    }
    """

    def __init__(self, config_dir: str = "config/scenarios"):
        self._config_dir = Path(config_dir)
        self._scenarios: Dict[str, ScenarioConfig] = {}
        self._load_all()

    def _load_all(self) -> None:
        """加载所有场景配置。"""
        if not self._config_dir.exists():
            logger.warning("Scenario config dir not found: %s", self._config_dir)
            return

        for config_file in self._config_dir.glob("*.json"):
            try:
                with open(config_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                scenario = ScenarioConfig.from_dict(data)
                self._scenarios[scenario.name] = scenario
                logger.info("Loaded scenario: %s", scenario.name)
            except Exception as e:
                logger.error("Failed to load scenario %s: %s", config_file, e)

    def get_scenario(self, name: str) -> Optional[ScenarioConfig]:
        """获取场景配置。"""
        return self._scenarios.get(name)

    def list_scenarios(self) -> List[str]:
        """列出所有场景名。"""
        return list(self._scenarios.keys())

    def register_scenario(self, scenario: ScenarioConfig) -> None:
        """注册场景配置。"""
        self._scenarios[scenario.name] = scenario
        # 持久化到文件
        config_path = self._config_dir / f"{scenario.name}.json"
        self._config_dir.mkdir(parents=True, exist_ok=True)
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(scenario.to_dict(), f, ensure_ascii=False, indent=2)
        logger.info("Registered scenario: %s", scenario.name)

    def apply_scenario(
        self,
        scenario_name: str,
        runtime_config: Any,
    ) -> Dict[str, Any]:
        """将场景配置应用到运行时配置。

        Returns:
            场景的 configurable 字典，用于 create_agent
        """
        scenario = self._scenarios.get(scenario_name)
        if not scenario:
            logger.warning("Scenario '%s' not found, using defaults", scenario_name)
            return {}

        # 应用感知配置
        if scenario.perception_config:
            for key, value in scenario.perception_config.items():
                runtime_config.set(f"perception.{key}", value)

        # 应用记忆配置
        if scenario.memory_config:
            for key, value in scenario.memory_config.items():
                runtime_config.set(f"memory.{key}", value)

        # 应用 LLM 配置
        for key, value in scenario.llm_config.items():
            runtime_config.set(f"llm.{key}", value)

        logger.info("Applied scenario '%s' to runtime config", scenario_name)

        return scenario.to_configurable()
```

#### 2.3.3 场景配置集成到工厂

```python
# langgraph/factory.py — 增强 create_agent

def create_agent(
    config: Optional[RunnableConfig] = None,
    runtime_config: Optional[RuntimeConfig] = None,
    system_prompt: Optional[str] = None,
    scenario_name: Optional[str] = None,  # ★ 新增：场景名
) -> ModuGraph:
    """根据配置创建 ModuAgent LangGraph 实例。

    P3 增强：支持场景配置驱动。
    当 scenario_name 提供时，从 ScenarioRegistry 加载场景配置，
    覆盖 runtime_config 并生成 configurable。
    """
    if runtime_config is None:
        runtime_config = get_config()

    configurable: Dict[str, Any] = {}

    # ★ 场景配置加载
    if scenario_name:
        from config.scenario.scenario_config import ScenarioRegistry
        registry = ScenarioRegistry()
        scenario_configurable = registry.apply_scenario(
            scenario_name, runtime_config
        )
        configurable.update(scenario_configurable)

    # 用户 config 覆盖（优先级最高）
    if config and "configurable" in config:
        configurable.update(config["configurable"])

    # ... 后续现有逻辑（build_chat_model / build_langchain_tools 等）...
```

---

## 3. Plan & Execute 架构扩展

### 3.1 现状评估：为何需要 Plan & Execute

**当前 ReAct 模式的局限**：

```
当前流程：agent → [有tool_calls] → tools → agent → [无tool_calls] → response
```

ReAct 模式中，LLM 在每一步都"边想边做"（Think-Act-Observe），存在以下问题：

1. **无全局规划**：LLM 每步只看到上一步结果，缺乏对整体任务的全局视角。对于"调研竞品→分析优势→生成报告"这类多步骤任务，容易在中间步骤偏离目标。

2. **工具调用短视**：LLM 选择工具时仅基于当前观察，不考虑后续步骤。可能先调用搜索工具找到信息后，才发现需要计算工具，但此时上下文已很长。

3. **不可中断/不可重规划**：一旦开始执行，无法根据中间结果调整计划。如果第2步发现第1步的假设错误，只能继续走完或直接结束。

4. **推理深度受限**：ReAct 的 `max_reasoning_iterations=3` 限制总循环次数。复杂任务可能需要5-10步，但增加迭代次数又会导致上下文膨胀。

**Plan & Execute 模式优势**：

```
Plan & Execute 流程：
  planner → [生成步骤计划] → executor(逐步执行) → [检查] → replanner(按需调整) → ... → response
```

- **先规划后执行**：Planner 先生成完整步骤计划，Executor 按计划逐步执行
- **可重规划**：每步执行后检查结果，必要时 Replanner 调整后续计划
- **上下文效率高**：Executor 每步只需"当前步骤+前步结果"，不需完整历史
- **可并行**：无依赖的步骤可并行执行

### 3.2 架构设计

#### 3.2.1 图结构

```
                          START
                            │
                            ▼
                      ┌───────────┐
                      │  planner  │  ← 分析任务，生成步骤计划
                      └─────┬─────┘
                            │
                            ▼
                    [route_after_plan]
                     ├─ plan_empty → response (无需工具，直接回答)
                     ├─ plan_ready → executor
                     └─ plan_error → response (规划失败)
                            │
                            ▼
                      ┌───────────┐
                      │ executor  │  ← 执行当前步骤（可能调用工具）
                      └─────┬─────┘
                            │
                            ▼
                      ┌───────────┐
                      │  checker  │  ← 检查执行结果
                      └─────┬─────┘
                            │
                            ▼
                    [route_after_check]
                     ├─ step_success_more_steps → executor (继续下一步)
                     ├─ step_success_plan_done → response (所有步骤完成)
                     ├─ step_failed_retry → executor (重试当前步骤)
                     ├─ step_failed_replan → replanner (重新规划)
                     └─ step_failed_abort → response (放弃)
                            │ (replan)
                            ▼
                      ┌───────────┐
                      │ replanner │  ← 基于已有结果调整计划
                      └─────┬─────┘
                            │
                            ▼
                        executor (继续执行新计划)
                            │
                            ▼
                          ...
                            │
                            ▼
                        response → feedback → memory_update → END
```

#### 3.2.2 State 扩展

```python
# langgraph/state.py — 新增 Plan & Execute 字段

class ModuAgentState(TypedDict, total=False):
    # ... 现有字段保持不变 ...

    # === Plan & Execute ===
    # 任务计划
    plan: Optional[Dict[str, Any]]
    # 计划步骤列表
    plan_steps: List[Dict[str, Any]]
    # 当前执行步骤索引
    current_step_index: int
    # 各步骤执行结果
    step_results: List[Dict[str, Any]]
    # 规划模式（react / plan_execute）
    reasoning_mode: str
    # 重规划次数
    replan_count: int
    # 最大重规划次数
    max_replans: int


# 计划步骤结构
# {
#     "step_id": "step_1",
#     "description": "搜索竞品A的产品信息",
#     "tool": "search_engine",          # 预期使用的工具（可选）
#     "params": {"query": "竞品A 产品"}, # 预期参数（可选）
#     "depends_on": [],                 # 依赖的前置步骤
#     "status": "pending",              # pending / executing / done / failed
#     "result": None,                   # 执行结果
# }
```

#### 3.2.3 Planner 节点实现

```python
# langgraph/nodes_plan_execute.py  ★新增

from __future__ import annotations

import json
import logging
from typing import Any, Callable, Dict, List, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from langgraph.state import ModuAgentState

logger = logging.getLogger(__name__)


# ============================================================
# Planner 节点
# ============================================================

_PLANNER_SYSTEM_PROMPT = """你是一个任务规划专家。分析用户请求，将其分解为可执行的步骤计划。

规划原则：
1. 每个步骤应该是一个清晰的、可执行的动作
2. 步骤之间可以有依赖关系（一个步骤可能需要另一个步骤的结果）
3. 优先使用可用的工具来完成步骤
4. 如果任务简单到不需要分步，返回空计划
5. 通常 2-6 个步骤为宜，避免过度拆分

可用工具：
{tools_description}

请返回 JSON 格式的计划：
{{
    "needs_plan": true/false,
    "reasoning": "为什么需要/不需要计划",
    "steps": [
        {{
            "step_id": "step_1",
            "description": "步骤描述",
            "tool": "工具名（可选，如不确定则留空）",
            "params": {{}},
            "depends_on": []
        }}
    ]
}}

仅返回 JSON，不要其他内容。"""


def make_planner_node(
    llm: Any,
    tools: List[Any],
) -> Callable[[ModuAgentState], dict]:
    """创建 Planner 节点。

    分析用户请求，生成步骤计划。

    Args:
        llm: LLM 实例（不绑定工具，纯文本推理）
        tools: 可用工具列表（用于生成工具描述）

    Returns:
        Planner 节点函数
    """
    # 构建工具描述
    tools_desc = "\n".join(
        f"- {t.name}: {t.description}" for t in tools
    ) if tools else "（无可用工具）"

    system_prompt = _PLANNER_SYSTEM_PROMPT.format(tools_description=tools_desc)

    def _planner_node(state: ModuAgentState) -> dict:
        """规划节点：分析任务，生成步骤计划。"""
        cleaned_text = state.get("cleaned_text") or state.get("input_data", {}).get("prompt", "")

        if not cleaned_text:
            return {
                "plan": None,
                "plan_steps": [],
                "current_step_index": 0,
                "step_results": [],
                "reasoning_mode": "plan_execute",
            }

        # 构建规划 prompt
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"用户请求：{cleaned_text}"),
        ]

        # 注入感知上下文
        perception_result = state.get("perception_result")
        if perception_result:
            perception_ctx = {
                "intent": perception_result.get("intent"),
                "entities": perception_result.get("entities", []),
                "detected_language": perception_result.get("detected_language"),
            }
            messages.insert(
                1,
                SystemMessage(content=f"感知上下文: {json.dumps(perception_ctx, ensure_ascii=False)}"),
            )

        # 注入长期知识
        knowledge = state.get("knowledge", [])
        if knowledge:
            knowledge_text = "\n".join(str(k) for k in knowledge[:3])
            messages.insert(
                1,
                SystemMessage(content=f"相关知识:\n{knowledge_text}"),
            )

        try:
            response = llm.invoke(messages)
            plan_data = _parse_plan_response(response.content if hasattr(response, "content") else str(response))

            if not plan_data.get("needs_plan", False):
                # 简单任务，不需要计划，回退到 ReAct 模式
                logger.info("Planner decided no plan needed: %s", plan_data.get("reasoning", ""))
                return {
                    "plan": plan_data,
                    "plan_steps": [],
                    "current_step_index": 0,
                    "step_results": [],
                    "reasoning_mode": "react",  # 回退到 ReAct
                }

            steps = plan_data.get("steps", [])
            logger.info("Plan generated: %d steps", len(steps))

            return {
                "plan": plan_data,
                "plan_steps": steps,
                "current_step_index": 0,
                "step_results": [],
                "reasoning_mode": "plan_execute",
            }

        except Exception as e:
            logger.error("Planner failed: %s", e)
            # 规划失败，回退到 ReAct
            return {
                "plan": None,
                "plan_steps": [],
                "current_step_index": 0,
                "step_results": [],
                "reasoning_mode": "react",
            }

    return _planner_node


def _parse_plan_response(content: str) -> Dict[str, Any]:
    """解析 Planner 返回的 JSON 计划。"""
    # 尝试直接解析
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass

    # 尝试从代码块提取
    import re
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", content, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # 尝试提取 { ... }
    start = content.find("{")
    end = content.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(content[start:end + 1])
        except json.JSONDecodeError:
            pass

    # 解析失败，返回不需要计划的默认值
    return {"needs_plan": False, "reasoning": "Failed to parse plan", "steps": []}


# ============================================================
# 路由：Plan 后
# ============================================================

def route_after_plan(state: ModuAgentState) -> str:
    """规划后路由。

    - reasoning_mode == "react" → agent (回退到 ReAct)
    - plan_steps 为空 → agent (简单任务，直接回答)
    - plan_steps 非空 → executor
    """
    reasoning_mode = state.get("reasoning_mode", "react")
    if reasoning_mode == "react":
        return "agent"

    plan_steps = state.get("plan_steps", [])
    if not plan_steps:
        return "agent"

    return "executor"


# ============================================================
# Executor 节点
# ============================================================

def make_executor_node(
    bound_llm: Any,
    tools: List[Any],
) -> Callable[[ModuAgentState], dict]:
    """创建 Executor 节点。

    执行计划中的当前步骤。Executor 使用绑定工具的 LLM，
    但系统提示词聚焦于"执行单个步骤"而非"完成整个任务"。
    """
    from langgraph.prebuilt import ToolNode

    executor_prompt = """你正在执行一个多步骤计划的第 {step_index}/{total_steps} 步。

当前步骤：{step_description}

前序步骤结果：
{previous_results}

请执行当前步骤。如果需要使用工具，调用合适的工具。
完成后给出该步骤的结果总结。"""

    def _executor_node(state: ModuAgentState) -> dict:
        """执行节点：执行当前计划步骤。"""
        plan_steps = state.get("plan_steps", [])
        current_idx = state.get("current_step_index", 0)
        step_results = state.get("step_results", [])

        if current_idx >= len(plan_steps):
            # 所有步骤已完成
            return {}

        current_step = plan_steps[current_idx]
        step_description = current_step.get("description", "")

        # 构建前序结果摘要
        previous_results = "无" if not step_results else "\n".join(
            f"步骤{i+1}: {r.get('summary', r.get('result', '完成'))}"
            for i, r in enumerate(step_results)
        )

        # 构建执行 prompt
        prompt = executor_prompt.format(
            step_index=current_idx + 1,
            total_steps=len(plan_steps),
            step_description=step_description,
            previous_results=previous_results,
        )

        messages: List[BaseMessage] = [
            SystemMessage(content="你是任务执行器。专注执行单个步骤，使用工具获取信息或执行操作。"),
            HumanMessage(content=prompt),
        ]

        # 注入用户原始问题作为上下文
        original_prompt = state.get("cleaned_text") or state.get("input_data", {}).get("prompt", "")
        if original_prompt:
            messages.insert(1, SystemMessage(content=f"用户原始请求: {original_prompt}"))

        try:
            response = bound_llm.invoke(messages)

            # 检查是否有 tool_calls
            has_tool_calls = (
                hasattr(response, "tool_calls") and response.tool_calls
            )

            if has_tool_calls:
                # 有工具调用，返回 messages 让 ToolNode 执行
                return {"messages": [response]}

            # 无工具调用，提取步骤结果
            step_result = {
                "step_id": current_step.get("step_id"),
                "step_index": current_idx,
                "description": step_description,
                "result": response.content if hasattr(response, "content") else str(response),
                "summary": _summarize_step_result(response.content if hasattr(response, "content") else ""),
                "status": "done",
            }

            new_step_results = list(step_results)
            new_step_results.append(step_result)

            return {
                "step_results": new_step_results,
                "messages": [response],
            }

        except Exception as e:
            logger.error("Executor step %d failed: %s", current_idx, e)
            error_result = {
                "step_id": current_step.get("step_id"),
                "step_index": current_idx,
                "description": step_description,
                "result": "",
                "error": str(e),
                "status": "failed",
            }
            new_step_results = list(step_results)
            new_step_results.append(error_result)
            return {"step_results": new_step_results}

    return _executor_node


def _summarize_step_result(content: str, max_length: int = 200) -> str:
    """简单摘要：取前N字。实际可用LLM做摘要。"""
    if not content:
        return ""
    content = content.strip()
    if len(content) <= max_length:
        return content
    return content[:max_length] + "..."


# ============================================================
# Checker 节点
# ============================================================

def make_checker_node(
    llm: Any,
    max_retries_per_step: int = 1,
) -> Callable[[ModuAgentState], dict]:
    """创建 Checker 节点。

    检查 Executor 的执行结果，决定：
    - 成功且有后续步骤 → 继续执行下一步
    - 成功且无后续步骤 → 计划完成
    - 失败且可重试 → 重试当前步骤
    - 失败且不可重试 → 需要重规划
    """

    checker_prompt = """请评估步骤执行结果。

步骤目标：{step_description}
执行结果：{step_result}

评估：
1. 步骤是否完成？（completed / partial / failed）
2. 结果质量如何？（1-5分）
3. 是否需要重试？（yes / no）
4. 是否需要重新规划后续步骤？（yes / no）

返回JSON：{{"status": "completed/partial/failed", "quality": 1-5, "retry": true/false, "replan": true/false, "reason": "..."}}
仅返回JSON。"""

    def _checker_node(state: ModuAgentState) -> dict:
        """检查节点：评估步骤执行结果。"""
        plan_steps = state.get("plan_steps", [])
        current_idx = state.get("current_step_index", 0)
        step_results = state.get("step_results", [])

        if not step_results:
            return {}

        latest_result = step_results[-1]
        step_description = latest_result.get("description", "")
        step_result_text = latest_result.get("result", "")[:500]
        step_status = latest_result.get("status", "done")

        # 简单规则检查（不调用LLM，减少延迟）
        if step_status == "failed":
            retry_count = latest_result.get("retry_count", 0)
            if retry_count < max_retries_per_step:
                latest_result["retry_count"] = retry_count + 1
                latest_result["status"] = "retrying"
                return {
                    "step_results": step_results,
                    "_check_action": "retry",
                }
            else:
                return {"_check_action": "replan"}

        # 检查是否有更多步骤
        has_more_steps = current_idx + 1 < len(plan_steps)

        if has_more_steps:
            return {
                "current_step_index": current_idx + 1,
                "_check_action": "next",
            }
        else:
            return {"_check_action": "done"}

    return _checker_node


# ============================================================
# 路由：Check 后
# ============================================================

def route_after_check(state: ModuAgentState) -> str:
    """检查后路由。"""
    action = state.get("_check_action", "done")

    if action == "next":
        return "executor"
    elif action == "retry":
        return "executor"
    elif action == "replan":
        replan_count = state.get("replan_count", 0)
        max_replans = state.get("max_replans", 2)
        if replan_count < max_replans:
            return "replanner"
        else:
            return "response"  # 超过重规划上限，直接返回
    else:  # done
        return "response"


# ============================================================
# Replanner 节点
# ============================================================

_REPLANNER_PROMPT = """你在执行一个多步骤计划时遇到了问题，需要重新规划。

原始任务：{original_task}
原始计划：
{original_plan}

已完成的步骤结果：
{completed_results}

失败的步骤：
{failed_step}

请基于已有结果重新规划后续步骤。保留已成功完成的步骤结果。

返回JSON：
{{
    "new_steps": [
        {{"step_id": "step_new_1", "description": "...", "tool": "...", "params": {{}}, "depends_on": []}}
    ],
    "reasoning": "重规划原因和思路"
}}
仅返回JSON。"""


def make_replanner_node(
    llm: Any,
    tools: List[Any],
) -> Callable[[ModuAgentState], dict]:
    """创建 Replanner 节点。"""

    tools_desc = "\n".join(f"- {t.name}: {t.description}" for t in tools) if tools else ""

    def _replanner_node(state: ModuAgentState) -> dict:
        """重规划节点：基于已有结果调整计划。"""
        original_task = state.get("cleaned_text") or state.get("input_data", {}).get("prompt", "")
        plan_steps = state.get("plan_steps", [])
        step_results = state.get("step_results", [])
        current_idx = state.get("current_step_index", 0)

        # 已完成的步骤
        completed = [
            r for r in step_results if r.get("status") == "done"
        ]
        completed_text = "\n".join(
            f"步骤{r.get('step_index', 0)+1}: {r.get('summary', '完成')}"
            for r in completed
        )

        # 失败的步骤
        failed = step_results[-1] if step_results else {}
        failed_text = f"步骤{current_idx+1}: {failed.get('description', '')} - 错误: {failed.get('error', '未知')}"

        # 原始计划
        original_plan = "\n".join(
            f"{i+1}. {s.get('description', '')}"
            for i, s in enumerate(plan_steps)
        )

        prompt = _REPLANNER_PROMPT.format(
            original_task=original_task[:500],
            original_plan=original_plan,
            completed_results=completed_text or "无",
            failed_step=failed_text,
        )

        messages = [
            SystemMessage(content=f"你是任务重规划专家。可用工具:\n{tools_desc}"),
            HumanMessage(content=prompt),
        ]

        try:
            response = llm.invoke(messages)
            new_plan = _parse_plan_response(
                response.content if hasattr(response, "content") else str(response)
            )

            new_steps = new_plan.get("steps", new_plan.get("new_steps", []))

            # 保留已完成步骤的结果，替换后续步骤
            remaining_results = step_results[:current_idx]  # 保留已完成

            logger.info(
                "Replan: %d new steps (replan_count=%d)",
                len(new_steps),
                state.get("replan_count", 0) + 1,
            )

            return {
                "plan_steps": new_steps,
                "current_step_index": 0,
                "step_results": remaining_results,
                "replan_count": state.get("replan_count", 0) + 1,
            }

        except Exception as e:
            logger.error("Replanner failed: %s", e)
            return {"_check_action": "done"}  # 重规划失败，直接返回已有结果

    return _replanner_node


# ============================================================
# Plan & Execute 图构建
# ============================================================

def build_plan_execute_graph(
    tools: List[Any],
    llm: Any,
    planner_llm: Any = None,       # 规划用 LLM（可使用更强模型）
    checkpointer: Any = None,
    store: Any = None,
    system_prompt: Optional[str] = None,
    recursion_limit: Optional[int] = None,
    orchestrator: Any = None,
    enable_plan_execute: bool = True,
) -> Any:
    """构建支持 Plan & Execute 模式的 ModuAgent LangGraph。

    当 enable_plan_execute=True 时：
        START → perception → planner → [route_after_plan]
                                              ├─ executor → checker → [route_after_check]
                                              │                    ├─ executor (循环)
                                              │                    ├─ replanner → executor
                                              │                    └─ response
                                              └─ agent (回退ReAct) → response
        → feedback → memory_update → END

    当 enable_plan_execute=False 时：
        回退到现有 ReAct 模式图结构
    """
    from langgraph.graph import END, START, StateGraph
    from langgraph.prebuilt import ToolNode
    from langgraph.nodes import (
        make_agent_node,
        make_feedback_node,
        make_memory_query_node,
        make_memory_update_node,
        make_tool_result_processor,
        perception_node,
        response_node,
        route_after_agent,
        route_after_perception,
    )
    from langgraph.state import ModuAgentState

    if not enable_plan_execute:
        # 回退到现有图结构
        from langgraph.graph import build_modu_graph
        return build_modu_graph(
            tools=tools, llm=llm, checkpointer=checkpointer,
            store=store, system_prompt=system_prompt,
            orchestrator=orchestrator,
        )

    # Plan & Execute 模式
    bound_llm = llm.bind_tools(tools) if tools else llm
    planner_llm = planner_llm or llm  # 默认使用同一 LLM

    graph = StateGraph(ModuAgentState)

    # 创建节点
    agent_node = make_agent_node(bound_llm, system_prompt=system_prompt)
    memory_node = make_memory_query_node(store) if store else None
    memory_update = make_memory_update_node(store) if store else None
    tool_result_processor = make_tool_result_processor()
    feedback_node = make_feedback_node(orchestrator) if orchestrator else None

    # Plan & Execute 节点
    planner_node = make_planner_node(planner_llm, tools)
    executor_node = make_executor_node(bound_llm, tools)
    checker_node = make_checker_node(planner_llm)
    replanner_node = make_replanner_node(planner_llm, tools)

    # 添加节点
    graph.add_node("perception", perception_node)
    if memory_node:
        graph.add_node("memory_query", memory_node)
    else:
        from langgraph.nodes import memory_query_node as _empty
        graph.add_node("memory_query", _empty)

    graph.add_node("planner", planner_node)
    graph.add_node("agent", agent_node)  # ReAct 回退
    graph.add_node("executor", executor_node)
    graph.add_node("checker", checker_node)
    graph.add_node("replanner", replanner_node)
    graph.add_node("tools", ToolNode(tools) if tools else _noop_tools_node)
    graph.add_node("tool_processor", tool_result_processor)
    graph.add_node("response", response_node)
    if feedback_node:
        graph.add_node("feedback", feedback_node)
    if memory_update:
        graph.add_node("memory_update", memory_update)

    # 添加边
    graph.add_edge(START, "perception")
    graph.add_conditional_edges(
        "perception", route_after_perception,
        {"memory_query": "memory_query", "__end__": "response"},
    )
    graph.add_edge("memory_query", "planner")

    # Plan 后路由
    graph.add_conditional_edges(
        "planner", route_after_plan,
        {"executor": "executor", "agent": "agent"},
    )

    # Agent (ReAct 回退) 路由
    graph.add_conditional_edges(
        "agent", route_after_agent,
        {"tools": "tools", "__end__": "response"},
    )

    # Executor 执行后可能有 tool_calls
    # Executor → tools (如果有 tool_calls) 或 → checker (如果无 tool_calls)
    graph.add_conditional_edges(
        "executor",
        _route_after_executor,
        {"tools": "tools", "checker": "checker"},
    )

    # Tools → tool_processor → executor (工具结果返回给 executor)
    graph.add_edge("tools", "tool_processor")
    graph.add_edge("tool_processor", "executor")

    # Checker 后路由
    graph.add_conditional_edges(
        "checker", route_after_check,
        {
            "executor": "executor",
            "replanner": "replanner",
            "response": "response",
        },
    )

    # Replanner → executor
    graph.add_edge("replanner", "executor")

    # Response → feedback → memory_update → END
    if feedback_node:
        graph.add_edge("response", "feedback")
        graph.add_edge("feedback", "memory_update" if memory_update else END)
    elif memory_update:
        graph.add_edge("response", "memory_update")
    else:
        graph.add_edge("response", END)
    if memory_update:
        graph.add_edge("memory_update", END)

    # 编译
    compile_kwargs: dict = {}
    if checkpointer:
        compile_kwargs["checkpointer"] = checkpointer
    if store:
        compile_kwargs["store"] = store

    compiled = graph.compile(**compile_kwargs)

    # 递归限制（Plan & Execute 需要更多预算）
    if recursion_limit:
        compiled.recursion_limit = recursion_limit
    else:
        # 每个步骤约 3 个节点（executor→checker→next），6 步 + planner + response + feedback + memory
        compiled.recursion_limit = 30

    logger.info("Plan & Execute graph built: tools=%d recursion_limit=%d", len(tools), compiled.recursion_limit)

    return compiled


def _route_after_executor(state: ModuAgentState) -> str:
    """Executor 后路由：有 tool_calls → tools，无 → checker。"""
    messages = state.get("messages", [])
    if not messages:
        return "checker"

    last_msg = messages[-1]
    if hasattr(last_msg, "tool_calls") and last_msg.tool_calls:
        return "tools"
    return "checker"


def _noop_tools_node(state: ModuAgentState) -> dict:
    """空工具节点。"""
    return {}
```

### 3.3 集成到工厂

```python
# langgraph/factory.py — 增强 create_agent 支持 Plan & Execute

def create_agent(
    config: Optional[RunnableConfig] = None,
    runtime_config: Optional[RuntimeConfig] = None,
    system_prompt: Optional[str] = None,
    scenario_name: Optional[str] = None,
) -> ModuGraph:
    """根据配置创建 ModuAgent LangGraph 实例。

    P3 增强：
    - 支持场景配置驱动（scenario_name）
    - 支持 Plan & Execute 模式（reasoning.plan_execute.enabled）
    """
    if runtime_config is None:
        runtime_config = get_config()

    # ... 场景配置加载逻辑 ...

    # 构建 LLM 和工具
    llm = build_chat_model(...)
    llm = apply_llm_retry(llm, runtime_config)
    tools = build_langchain_tools(...)

    # ★ 判断是否启用 Plan & Execute
    enable_pe = runtime_config.get("reasoning.plan_execute.enabled", False)

    if enable_pe:
        from langgraph.nodes_plan_execute import build_plan_execute_graph
        planner_llm = build_chat_model(
            provider=configurable.get("planner_llm_provider"),
            config=runtime_config,
            temperature=0.3,  # Planner 用低温度确保规划稳定
        )
        compiled = build_plan_execute_graph(
            tools=tools,
            llm=llm,
            planner_llm=planner_llm,
            checkpointer=checkpointer,
            store=store,
            system_prompt=effective_system_prompt,
            orchestrator=orchestrator,
            enable_plan_execute=True,
        )
    else:
        compiled = build_modu_graph(
            tools=tools, llm=llm, checkpointer=checkpointer,
            store=store, system_prompt=effective_system_prompt,
            orchestrator=orchestrator,
        )

    return ModuGraph(compiled=compiled, orchestrator=orchestrator)
```

### 3.4 配置项扩展

```python
# config/runtime_config.py — 新增 Plan & Execute 配置

_DEFAULT_CONFIG = {
    # ... 现有配置 ...

    "reasoning": {
        "plan_execute": {
            "enabled": False,                  # 默认关闭，保持向后兼容
            "planner_temperature": 0.3,        # Planner 低温度
            "executor_temperature": 0.7,       # Executor 标准温度
            "max_steps": 8,                    # 最大计划步骤数
            "max_replans": 2,                  # 最大重规划次数
            "max_retries_per_step": 1,         # 每步最大重试次数
            "planner_model": None,             # Planner 专用模型（None=复用默认）
            "enable_llm_checker": False,       # 是否启用 LLM Checker（否则用规则检查）
        },
        "hallucination_guard": {
            "enabled": False,
            "enable_llm_verification": False,
            "threshold": 0.5,
        },
        "fallback": {
            "enabled": False,
            "fallback_chain": [],              # ["glm", "qwen", "gpt"]
        },
    },
}
```

### 3.5 Plan & Execute vs ReAct 模式选择策略

```python
# langgraph/mode_selector.py  ★新增

from __future__ import annotations

import logging
from typing import Any, Dict

logger = logging.getLogger(__name__)


class ReasoningModeSelector:
    """推理模式选择器：根据任务特征自动选择 ReAct 或 Plan & Execute。

    选择策略：
    - 简单问答（如"你好"、"2+2=?"）→ ReAct（快速响应）
    - 多步骤任务（如"分析竞品并生成报告"）→ Plan & Execute
    - 需要工具链组合（如"搜索→计算→总结"）→ Plan & Execute
    - 单工具查询（如"搜索XX"）→ ReAct

    可通过配置 reasoning.plan_execute.auto_select 启用自动选择。
    """

    # Plan & Execute 信号词
    _PE_SIGNALS = [
        "分析", "调研", "报告", "总结", "对比", "评估", "规划",
        "步骤", "流程", "计划", "方案", "设计", "实施",
        "多", "综合", "系统", "全面", "深入",
    ]

    def __init__(
        self,
        auto_select: bool = False,
        signal_threshold: int = 2,
    ):
        self._auto_select = auto_select
        self._threshold = signal_threshold

    def should_use_plan_execute(
        self,
        user_input: str,
        perception_result: Dict[str, Any],
        available_tools: int = 0,
    ) -> bool:
        """判断是否应使用 Plan & Execute 模式。"""
        if not self._auto_select:
            return False

        signal_count = sum(
            1 for signal in self._PE_SIGNALS if signal in user_input
        )

        # 信号词超过阈值 → Plan & Execute
        if signal_count >= self._threshold:
            logger.debug("Plan & Execute selected: %d signals", signal_count)
            return True

        # 输入长度较长 + 有多个工具可用 → Plan & Execute
        if len(user_input) > 100 and available_tools >= 3:
            return True

        return False
```

---

## 附录：扩展方案实施优先级

| 优先级 | 扩展项 | 模块 | 风险 | 预期收益 |
|--------|--------|------|------|----------|
| P0 | 相似度阈值过滤 (M-EXT-2) | memory/threshold | 低 | 检索质量提升 |
| P0 | 工具结果验证 (A-EXT-3) | action/validation | 低 | 幻觉减少 |
| P0 | 场景配置库 (2.3) | config/scenario | 低 | 解耦硬编码 |
| P1 | 记忆固化管线 (M-EXT-1) | memory/consolidation | 中 | 长期记忆质量 |
| P1 | 结构化知识仓库 (2.1.2) | memory/relational | 中 | 业务知识沉淀 |
| P1 | 业务API工具 (2.2.1) | action/tools | 低 | 业务系统对接 |
| P1 | Plan & Execute (3.x) | langgraph/nodes_plan_execute | 中 | 复杂任务能力 |
| P2 | 幻觉检测守卫 (R-EXT-1) | reasoning/guardrails | 中 | 响应可靠性 |
| P2 | 用户画像存储 (2.1.3) | memory/relational | 中 | 个性化能力 |
| P2 | Skills技能系统 (A-EXT-2) | action/skills | 中 | 工具组合复用 |
| P2 | 模型fallback (R-EXT-2) | reasoning/strategy | 低 | 可用性提升 |
| P2 | 记忆遗忘管理 (M-EXT-3) | memory/forgetting | 中 | 存储效率 |
| P3 | MCP协议支持 (A-EXT-1) | action/mcp | 中 | 工具生态接入 |
| P3 | 多角色协作 (2.2.2) | orchestration/roles | 高 | 协作能力 |
| P3 | 跨模态对齐 (P-EXT-1) | perception/fusion | 高 | 多模态质量 |
| P3 | 成功经验学习 (F-EXT-3) | evolution/strategy | 中 | 进化效率 |
| P3 | 提示词模板管理 (R-EXT-4) | reasoning/prompt | 低 | 提示词可维护性 |
| P3 | 用户反馈采集 (F-EXT-2) | feedback/user_feedback | 低 | 进化信号源 |

---

> 本方案基于 2026-07-03 对 `apps/backend/ModuAgent/` 全量源码的逐文件深度分析编制。
> 所有扩展均设计为通过 `RuntimeConfig` 开关控制，默认关闭，确保向后兼容。
> 建议按 P0→P1→P2→P3 顺序渐进实施，每阶段配套单元测试与集成测试。
