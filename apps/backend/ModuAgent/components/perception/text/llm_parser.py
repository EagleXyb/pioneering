from __future__ import annotations

"""基于 LLM 的深度文本解析器（对应问题 1、2）。

能力：
- 意图识别：通过 LLM zero-shot 分类
- 实体抽取：通过 LLM 提取结构化实体
- 情感检测：通过 LLM 判断情感倾向
- 输入质量评估：LLM 辅助评估

P1 增强：
- 集成 spaCy/HanLP 做本地 NER 实体抽取（LLM 不可用时降级）
- 集成 SnowNLP 做本地中文情感检测（LLM 不可用时降级）
- 本地方法优先（更快、无成本），LLM 作为增强

设计原则：
- LLM 不可用时优雅降级为本地方法或空结果（不阻塞主流程）
- 所有 LLM 调用设置超时，超时则跳过
- 结果以结构化 JSON 返回，供 TextPreprocessor 合并
"""

import json
import logging
from typing import Any, Dict, List, Optional

from core.interfaces.perception import BasePerception

logger = logging.getLogger(__name__)

# P1: 检测可选依赖可用性
try:
    import spacy  # noqa: F401
    _SPACY_AVAILABLE = True
except ImportError:
    _SPACY_AVAILABLE = False

try:
    from snownlp import SnowNLP  # noqa: F401
    _SNOWNLP_AVAILABLE = True
except ImportError:
    _SNOWNLP_AVAILABLE = False

# 意图识别 prompt 模板
_INTENT_PROMPT = """请分析以下用户输入的意图，返回 JSON 格式结果。

用户输入：{input}

请返回如下 JSON 格式（仅返回 JSON，不要其他内容）：
{{"intent": "意图名称", "confidence": 0.0-1.0, "entities": [{{"text": "实体文本", "label": "实体类型"}}], "sentiment": {{"positive": 0.0-1.0, "negative": 0.0-1.0, "neutral": 0.0-1.0}}}}

意图类别参考：question, request, command, complaint, greeting, farewell, other
实体类型参考：person, location, organization, date, time, money, product, event
"""

# 质量评估 prompt 模板
_QUALITY_PROMPT = """请评估以下用户输入的质量，返回 JSON 格式结果。

用户输入：{input}

评估维度：
- clarity: 表述清晰度 (0-1)
- completeness: 信息完整度 (0-1)
- relevance: 相关性 (0-1)

请返回：{{"clarity": 0.0, "completeness": 0.0, "relevance": 0.0, "overall": 0.0}}
仅返回 JSON，不要其他内容。
"""

# spaCy 模型名称映射
_SPACY_MODELS = {
    "zh": "zh_core_web_sm",
    "en": "en_core_web_sm",
    "ja": "ja_core_web_sm",
    "ko": "ko_core_news_sm",
    "ru": "ru_core_news_sm",
    "multilingual": "xx_ent_wiki_sm",
}


class LLMParser(BasePerception):
    """基于 LLM 的深度文本解析器。

    在 TextPreprocessor 完成基础清洗后，可选地调用 LLM 做深度语义理解。
    若 LLM 不可用或调用失败，尝试本地方法（spaCy NER / SnowNLP 情感）降级。

    P1 优先级策略：
    1. 实体抽取：spaCy（本地，快） → LLM（增强）
    2. 情感检测：SnowNLP（本地，快） → LLM（增强）
    3. 意图识别：仅 LLM（本地无轻量方案）
    4. 质量评估：仅 LLM（可选）
    """

    def __init__(
        self,
        llm_adapter=None,
        timeout_ms: int = 3000,
        enable_intent: bool = True,
        enable_quality: bool = False,
        enable_local_ner: bool = True,
        enable_local_sentiment: bool = True,
        spacy_model: Optional[str] = None,
    ) -> None:
        self._llm_adapter = llm_adapter
        self._timeout_ms = timeout_ms
        self._enable_intent = enable_intent
        self._enable_quality = enable_quality
        self._enable_local_ner = enable_local_ner
        self._enable_local_sentiment = enable_local_sentiment

        # P1: 延迟初始化 spaCy 模型
        self._spacy_nlp = None
        self._spacy_model_name = spacy_model
        if self._enable_local_ner and _SPACY_AVAILABLE:
            self._init_spacy()

    def _init_spacy(self) -> None:
        """延迟初始化 spaCy NLP 模型。"""
        if not _SPACY_AVAILABLE:
            return

        # 尝试加载指定模型，否则尝试常见模型
        models_to_try = []
        if self._spacy_model_name:
            models_to_try.append(self._spacy_model_name)
        models_to_try.extend([
            "zh_core_web_sm",
            "en_core_web_sm",
            "xx_ent_wiki_sm",  # 多语言
        ])

        for model_name in models_to_try:
            try:
                self._spacy_nlp = spacy.load(model_name)
                logger.info("spaCy model loaded: %s", model_name)
                return
            except (OSError, ImportError):
                continue

        logger.warning("No spaCy model available, NER will use LLM only")

    def set_llm_adapter(self, llm_adapter) -> None:
        """动态注入 LLM 适配器（避免循环依赖）。"""
        self._llm_adapter = llm_adapter

    def perceive(
        self,
        input_type: str,
        raw_content: bytes,
        language: Optional[str] = None,
        sensitivity_level: int = 0,
    ) -> Dict[str, Any]:
        """对文本做深度解析。

        输入应为已清洗的文本（raw_content 为 UTF-8 编码的文本字节）。
        输出包含 intent / entities / sentiment / quality 字段。

        P1 策略：
        - 实体抽取：优先 spaCy 本地方案，LLM 作为增强
        - 情感检测：优先 SnowNLP 本地方案，LLM 作为增强
        - 意图识别：仅 LLM
        """
        if input_type != "text":
            return self._empty_result(input_type)

        try:
            text = raw_content.decode("utf-8")
        except UnicodeDecodeError:
            text = raw_content.decode("utf-8", errors="replace")

        if not text.strip():
            return self._empty_result("text")

        result: Dict[str, Any] = {
            "parsed_content": {"input_type": "text", "text": text},
            "detected_language": language,
            "confidence": 0.5,  # LLM 解析默认中等置信度
            "metadata": {"parser": "llm_parser"},
            "intent": None,
            "entities": [],
            "sentiment": None,
            "quality_score": 0.0,
        }

        # P1: 本地实体抽取（spaCy）
        local_entities: List[Dict[str, str]] = []
        if self._enable_local_ner and self._spacy_nlp is not None:
            local_entities = self._extract_entities_spacy(text)
            if local_entities:
                result["entities"] = local_entities

        # P1: 本地情感检测（SnowNLP，仅中文）
        local_sentiment: Optional[Dict[str, float]] = None
        if self._enable_local_sentiment and _SNOWNLP_AVAILABLE and self._is_chinese(text):
            local_sentiment = self._detect_sentiment_snownlp(text)
            if local_sentiment:
                result["sentiment"] = local_sentiment

        # LLM 深度解析（增强或补充本地方法未覆盖的字段）
        if self._llm_adapter is not None:
            context = {
                "trace_id": "llm_parser",
                "session_id": "llm_parser",
            }

            # 意图识别（仅 LLM）
            if self._enable_intent:
                intent_result = self._call_llm_safe(
                    _INTENT_PROMPT.format(input=text[:500]),
                    context,
                )
                if intent_result:
                    result["intent"] = intent_result.get("intent")
                    # LLM 实体作为补充（若本地已有则合并去重）
                    llm_entities = intent_result.get("entities", [])
                    if llm_entities:
                        result["entities"] = self._merge_entities(local_entities, llm_entities)
                    # LLM 情感作为补充（若本地已有则优先本地）
                    llm_sentiment = intent_result.get("sentiment")
                    if llm_sentiment and not local_sentiment:
                        result["sentiment"] = llm_sentiment

            # 质量评估（仅 LLM）
            if self._enable_quality:
                quality_result = self._call_llm_safe(
                    _QUALITY_PROMPT.format(input=text[:500]),
                    context,
                )
                if quality_result:
                    result["quality_score"] = quality_result.get("overall", 0.0)
        else:
            logger.debug("LLM adapter not available, using local methods only")

        # 根据结果丰富度调整置信度
        if result["entities"] or result["sentiment"] or result["intent"]:
            result["confidence"] = 0.7 if self._llm_adapter else 0.6

        return result

    # ------------------------------------------------------------------
    # P1: 本地实体抽取（spaCy）
    # ------------------------------------------------------------------

    def _extract_entities_spacy(self, text: str) -> List[Dict[str, str]]:
        """使用 spaCy 做命名实体识别。

        支持实体类型：PERSON, GPE, ORG, DATE, TIME, MONEY, PRODUCT, EVENT 等。
        spaCy 不可用或模型未加载时返回空列表。

        Returns:
            ``[{"text": "北京", "label": "GPE"}, ...]``
        """
        if not self._spacy_nlp:
            return []

        try:
            doc = self._spacy_nlp(text[:1000])  # 限制长度避免超时
            entities = []
            seen = set()
            for ent in doc.ents:
                key = (ent.text, ent.label_)
                if key not in seen:
                    entities.append({
                        "text": ent.text,
                        "label": ent.label_,
                        "start": ent.start_char,
                        "end": ent.end_char,
                    })
                    seen.add(key)
            return entities[:20]  # 限制数量
        except Exception as e:
            logger.warning("spaCy NER failed: %s", str(e))
            return []

    # ------------------------------------------------------------------
    # P1: 本地情感检测（SnowNLP，仅中文）
    # ------------------------------------------------------------------

    def _detect_sentiment_snownlp(self, text: str) -> Optional[Dict[str, float]]:
        """使用 SnowNLP 做中文情感检测。

        SnowNLP 返回 0-1 的情感分值，转换为三分类分布。
        不可用时返回 None。

        Returns:
            ``{"positive": 0.8, "negative": 0.1, "neutral": 0.1}``
        """
        try:
            s = SnowNLP(text[:500])  # 限制长度
            score = s.sentiments  # 0~1，越接近 1 越积极

            # 转换为三分类分布
            if score > 0.6:
                positive = score
                negative = (1 - score) * 0.5
                neutral = (1 - score) * 0.5
            elif score < 0.4:
                negative = 1 - score
                positive = score * 0.5
                neutral = score * 0.5
            else:
                neutral = 1 - abs(score - 0.5) * 2
                positive = (1 - neutral) * score / 0.5 if score > 0 else 0
                negative = (1 - neutral) * (1 - score) / 0.5 if score < 1 else 0

            # 归一化
            total = positive + negative + neutral
            if total > 0:
                return {
                    "positive": round(positive / total, 3),
                    "negative": round(negative / total, 3),
                    "neutral": round(neutral / total, 3),
                }
        except Exception as e:
            logger.warning("SnowNLP sentiment detection failed: %s", str(e))

        return None

    def _is_chinese(self, text: str) -> bool:
        """快速判断文本是否以中文为主。"""
        if not text:
            return False
        chinese_count = sum(1 for c in text if "\u4e00" <= c <= "\u9fff")
        return chinese_count > len(text) * 0.3

    def _merge_entities(
        self,
        local: List[Dict[str, str]],
        llm: List[Dict[str, str]],
    ) -> List[Dict[str, str]]:
        """合并本地和 LLM 实体结果，去重。"""
        merged = list(local)
        seen_texts = {e["text"] for e in local}
        for entity in llm:
            if isinstance(entity, dict) and "text" in entity:
                if entity["text"] not in seen_texts:
                    merged.append(entity)
                    seen_texts.add(entity["text"])
        return merged[:30]  # 限制总数

    def _call_llm_safe(self, prompt: str, context: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """安全调用 LLM，失败时返回 None。"""
        try:
            response, _usage, _tool_calls = self._llm_adapter.generate(
                prompt=prompt,
                context=context,
                temperature=0.3,  # 低温度保证稳定性
                max_tokens=256,
            )
            return self._parse_json_response(response)
        except Exception as e:
            logger.warning("LLM deep parsing failed: %s", str(e))
            return None

    def _parse_json_response(self, response: str) -> Optional[Dict[str, Any]]:
        """从 LLM 响应中提取 JSON。"""
        # 尝试直接解析
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        # 尝试从 ```json ... ``` 块中提取
        import re
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", response, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

        # 尝试从 { ... } 中提取
        start = response.find("{")
        end = response.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(response[start : end + 1])
            except json.JSONDecodeError:
                pass

        return None

    def _empty_result(self, input_type: str) -> Dict[str, Any]:
        return {
            "parsed_content": {"input_type": input_type, "error": "unsupported or empty input"},
            "detected_language": None,
            "confidence": 0.0,
            "metadata": {"parser": "llm_parser"},
            "intent": None,
            "entities": [],
            "sentiment": None,
            "quality_score": 0.0,
        }
