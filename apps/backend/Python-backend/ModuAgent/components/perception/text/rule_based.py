from __future__ import annotations

import json
import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

from components.perception.security.guard import SecurityGuard
from core.interfaces.perception import BasePerception

# ---------------------------------------------------------------------------
# 敏感词分级模式（对应问题 4：细粒度分级 + 词边界匹配）
# ---------------------------------------------------------------------------

# 敏感度分级定义
# 0: safe          无敏感内容
# 1: notice        含可能敏感词，但上下文安全
# 2: sensitive     含敏感词，需标记
# 3: high_risk     高风险，需降级处理
# 4: review        需人工审核
# 5: block         直接拒绝
SENSITIVITY_LEVELS = {
    0: "safe",
    1: "notice",
    2: "sensitive",
    3: "high_risk",
    4: "review",
    5: "block",
}

# 多层正则分类：级别 → 模式列表
# 注意：Python 3 中 \w 匹配 Unicode 字符（含中文），故中文关键词不使用 \w 边界
# 中文关键词直接匹配（中文无词边界概念），英文关键词使用 \b 边界
SENSITIVITY_PATTERNS: Dict[int, List[re.Pattern]] = {
    5: [  # 直接拒绝级：密码明文泄露
        re.compile(r"\b(?:password|passwd)\s*[=:]\s*\S+", re.IGNORECASE),
        re.compile(r"(?:密码|口令)\s*[=：:]\s*\S+"),
    ],
    4: [  # 需人工审核级：身份证号明文
        re.compile(r"(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)"),
    ],
    3: [  # 高风险级：敏感实体词
        re.compile(r"(?:银行卡|身份证)", re.IGNORECASE),
        re.compile(r"\b(?:passport|credit\s*card)\b", re.IGNORECASE),
    ],
    2: [  # 敏感级：敏感操作词
        re.compile(r"(?:转账|汇款|支付)"),
        re.compile(r"\b(?:payment|transfer)\b", re.IGNORECASE),
    ],
    1: [  # 注意级：可能敏感词
        re.compile(r"(?:密码|口令)"),
        re.compile(r"\b(?:password|passwd|secret)\b", re.IGNORECASE),
    ],
}

# ---------------------------------------------------------------------------
# P1: 上下文关键词规则（降低误伤率）
# ---------------------------------------------------------------------------
# 当敏感词命中时，若同时出现"安全上下文关键词"，则降低敏感级别
# 格式: {敏感词模式索引: (安全上下文关键词列表, 降级幅度)}
# 例如: "银行卡" 命中 level=3，但若同时出现 "丢了/被盗/挂失/找不到"，降为 level=1
_CONTEXT_SAFE_KEYWORDS: List[Tuple[re.Pattern, List[str], int]] = [
    # 银行卡 + 求助场景 → 降 2 级（3 → 1）
    (
        re.compile(r"(?:银行卡|身份证)"),
        ["丢了", "被盗", "挂失", "找不到", "丢失", "不见了", "忘带", "过期", "补办"],
        2,
    ),
    # 密码 + 求助场景 → 降 1 级（1 → 0）
    (
        re.compile(r"(?:密码|口令)"),
        ["忘记", "忘了", "重置", "找回", "修改", "重设", "reset", "forgot"],
        1,
    ),
    # 转账 + 询问场景 → 降 1 级（2 → 1）
    (
        re.compile(r"(?:转账|汇款)"),
        ["怎么", "如何", "能不能", "可以吗", "需要", "流程", "手续费", "限额"],
        1,
    ),
]

# P1: 白名单短语（完全跳过敏感检测）
_WHITELIST_PHRASES: List[str] = [
    "密码学",
    "密码算法",
    "加密算法",
    "password policy",
    "password strength",
    "password security",
]

# ---------------------------------------------------------------------------
# 文本清洗常量（对应问题 10：编码与清洗细节）
# ---------------------------------------------------------------------------

# 需过滤的字符类别：控制字符(Cc)、格式字符(Cf)、私有区(Co)、代理区(Cs)
_STRIP_CATEGORIES = {"Cc", "Cf", "Co", "Cs"}
# 保留的空白控制字符
_KEEP_CHARS = {"\t", "\n", "\r"}
# 双向控制字符区间（U+202A-U+202E, U+2066-U+2069）
_BIDI_RANGES = ((0x202A, 0x202E), (0x2066, 0x2069))

# ---------------------------------------------------------------------------
# 语言检测 Unicode 区间（对应问题 3：扩展覆盖范围）
# ---------------------------------------------------------------------------

_LANG_RANGES: Dict[str, List[Tuple[int, int]]] = {
    "zh": [
        (0x4E00, 0x9FFF),  # CJK 统一汉字
        (0x3400, 0x4DBF),  # CJK 扩展 A
        (0x3000, 0x303F),  # CJK 标点
        (0xF900, 0xFAFF),  # CJK 兼容汉字
    ],
    "ja": [
        (0x3040, 0x309F),  # 平假名
        (0x30A0, 0x30FF),  # 片假名
    ],
    "ko": [
        (0xAC00, 0xD7AF),  # 谚文音节
        (0x1100, 0x11FF),  # 谚文兼容
    ],
    "ar": [(0x0600, 0x06FF), (0x0750, 0x077F)],  # 阿拉伯文
    "ru": [(0x0400, 0x04FF)],  # 西里尔文
    "th": [(0x0E00, 0x0E7F)],  # 泰文
    "en": [
        (0x0041, 0x005A),  # 基本拉丁大写
        (0x0061, 0x007A),  # 基本拉丁小写
        (0x00C0, 0x024F),  # 拉丁扩展
    ],
}

# Emoji 区间（粗略过滤，避免干扰语种统计）
_EMOJI_RANGES = [
    (0x1F600, 0x1F64F),  # 表情
    (0x1F300, 0x1F5FF),  # 符号
    (0x1F680, 0x1F6FF),  # 交通
    (0x1F900, 0x1F9FF),  # 补充
    (0x2600, 0x26FF),    # 杂项符号
    (0x2700, 0x27BF),    # 装饰符号
]


def _in_ranges(cp: int, ranges: List[Tuple[int, int]]) -> bool:
    return any(lo <= cp <= hi for lo, hi in ranges)


def _is_emoji(cp: int) -> bool:
    return _in_ranges(cp, _EMOJI_RANGES)


# P1: 检测 langdetect 是否可用（可选依赖）
try:
    import langdetect  # noqa: F401
    _LANGDETECT_AVAILABLE = True
except ImportError:
    _LANGDETECT_AVAILABLE = False


class TextPreprocessor(BasePerception):
    """文本预处理器（感知层核心组件）。

    优化后能力（对应感知层优化方案 P0）：
    - 文本清洗：控制字符 / 零宽字符 / 方向控制字符过滤
    - 智能截断：句子边界感知 + 截断元数据
    - 鲁棒语种检测：扩展 Unicode 区间 + Emoji 过滤 + 语种分布
    - 细粒度敏感词分级：0-5 级 + 词边界匹配
    - 安全检测：Prompt Injection / PII / 注入风险
    - 真实置信度计算：加权平均
    - 输入质量评估：启发式规则
    """

    def __init__(
        self,
        language: str = "zh",
        max_length: int = 2048,
        sensitivity_patterns: Optional[List[str]] = None,
        enable_security_guard: bool = True,
        enable_quality_assessment: bool = True,
    ) -> None:
        self._language = language
        self._max_length = max_length
        self._security_guard = SecurityGuard() if enable_security_guard else None
        self._enable_quality = enable_quality_assessment

        # 兼容旧参数：若传入 sensitivity_patterns，作为 level=5 的补充模式
        self._extra_patterns: List[re.Pattern] = []
        if sensitivity_patterns:
            self._extra_patterns = [re.compile(p, re.IGNORECASE) for p in sensitivity_patterns]

    def perceive(
        self,
        input_type: str,
        raw_content: bytes,
        language: Optional[str] = None,
        sensitivity_level: int = 0,
    ) -> Dict[str, Any]:
        if input_type != "text":
            return {
                "parsed_content": {"input_type": input_type, "error": "unsupported input type"},
                "detected_language": None,
                "confidence": 0.0,
                "metadata": {"sensitivity_level": 0},
            }

        # 1. 解码 + 智能截断
        text, truncation_info, decoding_errors = self._decode_and_truncate(raw_content)

        # 2. 文本清洗（控制字符 / 零宽字符 / 方向控制字符）
        text, sanitization_warnings = self._sanitize_text(text)

        # 3. 语种检测（返回分布）
        lang_dist = self._detect_language_robust(text)
        detected_lang = language or self._pick_dominant_language(lang_dist)
        language_mixed = self._is_language_mixed(lang_dist)

        # 4. 敏感词检测（细粒度分级）
        detected_sensitivity = self._detect_sensitivity(text)
        final_sensitivity = max(sensitivity_level, detected_sensitivity)

        # 5. 安全检测
        security_result: Dict[str, Any] = {}
        security_score = 1.0
        if self._security_guard:
            security_result = self._security_guard.detect_all(text, final_sensitivity)
            security_score = security_result.get("security_score", 1.0)

        # 6. 输入质量评估
        quality_score = 1.0
        if self._enable_quality:
            quality_score = self._assess_quality(text, detected_lang)

        # 7. 置信度计算（加权平均）
        confidence = self._compute_confidence(
            lang_dist, final_sensitivity, security_score, quality_score, decoding_errors
        )

        metadata: Dict[str, Any] = {
            "sensitivity_level": final_sensitivity,
            "sensitivity_label": SENSITIVITY_LEVELS.get(final_sensitivity, "unknown"),
            "truncated": truncation_info.get("truncated", False),
            "original_length": len(raw_content),
            "truncation_info": truncation_info,
            "decoding_errors": decoding_errors,
            "sanitization_warnings": sanitization_warnings,
            "security_score": security_score,
        }
        if security_result:
            metadata["injection_detected"] = security_result.get("injection_detected", False)
            metadata["pii_detected"] = security_result.get("pii_detected", False)
            metadata["security_details"] = security_result

        return {
            "parsed_content": {
                "input_type": "text",
                "text": text,
            },
            "detected_language": detected_lang,
            "confidence": confidence,
            "metadata": metadata,
            "language_distribution": lang_dist,
            "language_mixed": language_mixed,
            "quality_score": quality_score,
            "security_score": security_score,
            "intent": None,      # P1：集成 Sentence-BERT 后填充
            "entities": [],      # P1：集成 spaCy/HanLP 后填充
            "sentiment": None,  # P1：集成 SnowNLP 后填充
        }

    # ------------------------------------------------------------------
    # 解码 + 智能截断（对应问题 6）
    # ------------------------------------------------------------------

    def _decode_and_truncate(self, raw_content: bytes) -> Tuple[str, Dict[str, Any], int]:
        """解码 + 智能截断。

        Returns:
            (text, truncation_info, decoding_errors)
        """
        decoding_errors = 0
        try:
            text = raw_content.decode("utf-8")
        except UnicodeDecodeError:
            text = raw_content.decode("utf-8", errors="replace")
            decoding_errors = text.count("\ufffd")

        text = unicodedata.normalize("NFKC", text)
        text = text.strip()

        truncation_info = self._truncate_smart(text, self._max_length)
        if truncation_info["truncated"]:
            text = text[: truncation_info["truncated_length"]]

        return text, truncation_info, decoding_errors

    def _truncate_smart(self, text: str, max_length: int) -> Dict[str, Any]:
        """智能截断：在句子边界截断，避免语义断裂。

        P1 增强：
        - JSON 感知截断：检测 JSON 输入，按 key-value 边界截断并补全闭合括号

        Returns:
            ``{"truncated": bool, "original_length": int, "truncated_length": int,
               "truncation_ratio": float, "method": str}``
        """
        original_length = len(text)
        if original_length <= max_length:
            return {
                "truncated": False,
                "original_length": original_length,
                "truncated_length": original_length,
                "truncation_ratio": 1.0,
                "method": "none",
            }

        # P1: JSON 感知截断
        stripped = text.lstrip()
        if stripped and stripped[0] in ("{", "["):
            json_result = self._truncate_json(text, max_length)
            if json_result is not None:
                return json_result

        # 在 max_length 附近寻找最近的句子边界
        truncated_prefix = text[:max_length]
        sentence_boundaries = ["。", "！", "？", ". ", "! ", "? ", "\n", "\r\n", "；", "; "]

        best_pos = max_length
        for boundary in sentence_boundaries:
            pos = truncated_prefix.rfind(boundary)
            if pos > max_length * 0.8:  # 至少保留 80%
                candidate = pos + len(boundary)
                if candidate < best_pos:
                    best_pos = candidate

        truncated_length = best_pos
        return {
            "truncated": True,
            "original_length": original_length,
            "truncated_length": truncated_length,
            "truncation_ratio": round(truncated_length / original_length, 2),
            "method": "sentence_boundary",
        }

    def _truncate_json(self, text: str, max_length: int) -> Optional[Dict[str, Any]]:
        """JSON 感知截断。

        策略：
        1. 若完整 JSON 且长度超限：逐个移除末尾 key-value 对直到长度合适
        2. 若截断的 JSON（不完整）：找到最后一个完整 key-value，补全闭合括号

        Returns:
            截断信息字典；若非 JSON 或处理失败返回 None
        """
        original_length = len(text)
        stripped = text.lstrip()
        leading_ws = len(text) - len(stripped)
        is_array = stripped[0] == "["

        # 尝试完整解析
        try:
            parsed = json.loads(text)
        except (json.JSONDecodeError, ValueError):
            parsed = None

        if parsed is not None:
            # 完整 JSON，但长度超限：逐个移除末尾元素
            if isinstance(parsed, dict):
                items = list(parsed.items())
                while items:
                    truncated_dict = dict(items)
                    candidate = json.dumps(truncated_dict, ensure_ascii=False)
                    if len(candidate) <= max_length:
                        return {
                            "truncated": True,
                            "original_length": original_length,
                            "truncated_length": len(candidate),
                            "truncation_ratio": round(len(candidate) / original_length, 2),
                            "method": "json_key_boundary",
                            "removed_keys": len(parsed) - len(items),
                        }
                    items.pop()
                # 所有 key 移除后仍超限（单 key 值过大），降级为句子截断
                return None

            if isinstance(parsed, list):
                items = list(parsed)
                while items:
                    candidate = json.dumps(items, ensure_ascii=False)
                    if len(candidate) <= max_length:
                        return {
                            "truncated": True,
                            "original_length": original_length,
                            "truncated_length": len(candidate),
                            "truncation_ratio": round(len(candidate) / original_length, 2),
                            "method": "json_array_boundary",
                            "removed_items": len(parsed) - len(items),
                        }
                    items.pop()
                return None

            return None

        # 截断的 JSON：找最后一个完整 key-value / array element
        # 寻找最后一个逗号位置（在 max_length 内）
        search_end = min(max_length, len(text))
        last_comma = text.rfind(",", leading_ws, search_end)
        if last_comma <= leading_ws:
            return None  # 找不到分隔点

        # 截断到逗号位置，补全闭合括号
        truncated = text[:last_comma]
        # 移除末尾可能的空白和未完成的 token
        truncated = truncated.rstrip()
        # 移除末尾不完整的字符串（如 "key": "valu 未闭合）
        truncated = self._fix_incomplete_json_tail(truncated)

        # 补全闭合括号
        open_char = "[" if is_array else "{"
        close_char = "]" if is_array else "}"
        truncated = truncated + close_char

        if len(truncated) > max_length:
            # 补全后仍超限，再向前找逗号
            return None

        return {
            "truncated": True,
            "original_length": original_length,
            "truncated_length": len(truncated),
            "truncation_ratio": round(len(truncated) / original_length, 2),
            "method": "json_repair",
            "repaired": True,
        }

    def _fix_incomplete_json_tail(self, text: str) -> str:
        """修复 JSON 尾部不完整的 token。

        处理情况：
        - 字符串值未闭合："key": "valu → "key": ""
        - key 未闭合："ke → 移除该 key-value 对
        - 冒号后无值："key": → 移除该 key-value 对
        """
        # 找最后一个引号位置
        last_quote = text.rfind('"')
        if last_quote == -1:
            return text

        # 统计引号数量，奇数表示字符串未闭合
        quote_count = text.count('"')
        if quote_count % 2 == 0:
            return text  # 引号配对正常

        # 找到未闭合字符串的起始引号
        # 从最后一个引号向前找前一个引号
        prev_quote = text.rfind('"', 0, last_quote)
        if prev_quote == -1:
            return text

        # 判断是 key 还是 value
        between = text[prev_quote:last_quote]
        # 检查 last_quote 之前是否有冒号（判断是 key 还是 value）
        colon_pos = text.rfind(":", 0, last_quote)

        if colon_pos == -1 or colon_pos < prev_quote:
            # 未闭合的是 key：移除整个 key-value 对
            # 找到 key 前的逗号
            comma_pos = text.rfind(",", 0, prev_quote)
            if comma_pos != -1:
                return text[:comma_pos].rstrip()
            return text[:prev_quote].rstrip()
        else:
            # 未闭合的是 value：截断到 value 起始引号并闭合
            return text[: last_quote + 1]

    # ------------------------------------------------------------------
    # 文本清洗（对应问题 10）
    # ------------------------------------------------------------------

    def _sanitize_text(self, text: str) -> Tuple[str, Dict[str, Any]]:
        """清洗文本中的控制字符、零宽字符、方向控制字符。

        P1 增强：
        - 重复字符压缩（连续 >5 次压缩为最多 3 次）
        - 过度大写检测（大写占比 >70% 标记）

        Returns:
            (sanitized_text, warnings)
        """
        sanitized: List[str] = []
        warnings = {
            "stripped_control_chars": 0,
            "stripped_zero_width": 0,
            "stripped_bidi_chars": 0,
            "compressed_repeats": 0,
            "excessive_uppercase": False,
        }

        # 第一遍：过滤控制字符 / 零宽字符 / 方向控制字符
        for char in text:
            cp = ord(char)
            cat = unicodedata.category(char)

            # 保留的空白控制字符
            if char in _KEEP_CHARS:
                sanitized.append(char)
                continue

            # 过滤控制字符/格式字符
            if cat in _STRIP_CATEGORIES:
                if cat == "Cf":
                    warnings["stripped_zero_width"] += 1
                else:
                    warnings["stripped_control_chars"] += 1
                continue

            # 过滤双向控制字符
            if any(lo <= cp <= hi for lo, hi in _BIDI_RANGES):
                warnings["stripped_bidi_chars"] += 1
                continue

            sanitized.append(char)

        cleaned = "".join(sanitized)

        # 第二遍：重复字符压缩（连续 >5 次压缩为最多 3 次）
        cleaned, repeat_count = self._compress_repeats(cleaned)
        warnings["compressed_repeats"] = repeat_count

        # 第三遍：过度大写检测（仅对含拉丁字母的文本）
        warnings["excessive_uppercase"] = self._detect_excessive_uppercase(cleaned)

        return cleaned, warnings

    def _compress_repeats(self, text: str, threshold: int = 5, max_keep: int = 3) -> Tuple[str, int]:
        """压缩连续重复字符。

        当同一字符连续出现 > threshold 次时，保留前 max_keep 个。
        仅压缩可打印字符，不影响空白字符。

        Returns:
            (compressed_text, compressed_count)
        """
        if len(text) <= threshold:
            return text, 0

        result: List[str] = []
        compressed_count = 0
        i = 0
        length = len(text)

        while i < length:
            char = text[i]
            # 不压缩空白字符
            if char in _KEEP_CHARS or char.isspace():
                result.append(char)
                i += 1
                continue

            # 统计连续重复次数
            run_end = i + 1
            while run_end < length and text[run_end] == char:
                run_end += 1
            run_length = run_end - i

            if run_length > threshold:
                # 压缩：保留前 max_keep 个
                result.append(char * max_keep)
                compressed_count += run_length - max_keep
            else:
                result.append(char * run_length)

            i = run_end

        return "".join(result), compressed_count

    def _detect_excessive_uppercase(self, text: str, threshold: float = 0.7) -> bool:
        """检测过度大写（大写字母占比 > threshold）。

        仅统计拉丁字母，中文/数字/标点不参与计算。
        当拉丁字母总数 < 10 时不判定（样本太小）。
        """
        upper_count = 0
        letter_count = 0
        for char in text:
            if "a" <= char <= "z":
                letter_count += 1
            elif "A" <= char <= "Z":
                letter_count += 1
                upper_count += 1

        if letter_count < 10:
            return False

        return (upper_count / letter_count) > threshold

    # ------------------------------------------------------------------
    # 鲁棒语种检测（对应问题 3）
    # ------------------------------------------------------------------

    def _detect_language_robust(self, text: str) -> Dict[str, float]:
        """扩展 Unicode 区间 + Emoji 过滤，返回语种概率分布。

        P1 增强：
        - 集成 langdetect 做 n-gram 统计检测（可选依赖，不可用时降级）
        - 当 langdetect 可用且文本足够长时，使用其结果修正 Unicode 计数结果

        Returns:
            ``{"zh": 0.65, "en": 0.30, "ja": 0.05}``
        """
        # 基线：Unicode 区间计数
        counts: Dict[str, int] = {lang: 0 for lang in _LANG_RANGES}
        total = 0

        for char in text:
            cp = ord(char)
            if _is_emoji(cp):
                continue  # 跳过 Emoji
            for lang, ranges in _LANG_RANGES.items():
                if _in_ranges(cp, ranges):
                    counts[lang] += 1
                    total += 1
                    break

        if total == 0:
            return {self._language: 1.0}

        # 归一化为概率分布
        distribution = {lang: round(count / total, 3) for lang, count in counts.items() if count > 0}

        # P1: langdetect 修正（仅对足够长的文本启用）
        if _LANGDETECT_AVAILABLE and len(text) >= 20:
            langdetect_dist = self._detect_with_langdetect(text)
            if langdetect_dist:
                # 融合策略：langdetect 结果权重 0.6，Unicode 结果权重 0.4
                merged = self._merge_language_distributions(distribution, langdetect_dist)
                return merged

        return distribution

    def _detect_with_langdetect(self, text: str) -> Dict[str, float]:
        """使用 langdetect 做语种检测。

        langdetect 基于 n-gram 统计，对中长文本准确率高于 Unicode 计数。
        设置 seed 保证可复现。

        Returns:
            语种概率分布；失败返回空字典
        """
        try:
            from langdetect import DetectorFactory, detect_langs
            DetectorFactory.seed = 0  # 保证可复现
            langs = detect_langs(text)
            result = {lang.lang: round(lang.prob, 3) for lang in langs}
            # 仅保留 top-3 语种
            sorted_result = dict(sorted(result.items(), key=lambda x: x[1], reverse=True)[:3])
            return sorted_result
        except Exception:
            return {}

    def _merge_language_distributions(
        self,
        unicode_dist: Dict[str, float],
        langdetect_dist: Dict[str, float],
        unicode_weight: float = 0.4,
        langdetect_weight: float = 0.6,
    ) -> Dict[str, float]:
        """融合 Unicode 计数和 langdetect 的语种分布。

        策略：
        - 对两个分布中都存在的语种，加权平均
        - 仅在一个分布中存在的语种，按其权重计入
        - 最终归一化
        """
        all_langs = set(unicode_dist.keys()) | set(langdetect_dist.keys())
        merged: Dict[str, float] = {}

        for lang in all_langs:
            u_prob = unicode_dist.get(lang, 0.0)
            l_prob = langdetect_dist.get(lang, 0.0)
            merged[lang] = round(u_prob * unicode_weight + l_prob * langdetect_weight, 3)

        # 归一化
        total = sum(merged.values())
        if total > 0:
            merged = {lang: round(prob / total, 3) for lang, prob in merged.items() if prob > 0}

        return merged

    def _pick_dominant_language(self, distribution: Dict[str, float]) -> str:
        """从语种分布中选取主导语种。"""
        if not distribution:
            return self._language
        return max(distribution, key=distribution.get)

    def _is_language_mixed(self, distribution: Dict[str, float]) -> bool:
        """判断是否存在语种混淆（次高语种占比 > 0.3）。"""
        if len(distribution) < 2:
            return False
        sorted_probs = sorted(distribution.values(), reverse=True)
        return sorted_probs[1] > 0.3

    # ------------------------------------------------------------------
    # 细粒度敏感词检测（对应问题 4）
    # ------------------------------------------------------------------

    def _detect_sensitivity(self, text: str) -> int:
        """多层正则分类检测，返回最高命中的敏感级别（0-5）。

        P1 增强：
        - 白名单短语优先匹配（命中白名单直接返回 0）
        - 上下文关键词降级（敏感词 + 安全上下文 → 降低级别）
        """
        # P1: 白名单短语优先匹配
        text_lower = text.lower()
        for phrase in _WHITELIST_PHRASES:
            if phrase.lower() in text_lower:
                return 0  # 白名单命中，直接安全

        max_level = 0
        for level in sorted(SENSITIVITY_PATTERNS.keys(), reverse=True):
            for pattern in SENSITIVITY_PATTERNS[level]:
                if pattern.search(text):
                    max_level = max(max_level, level)
                    break
            if max_level >= 5:
                break

        # 兼容旧参数的补充模式（默认归为 level=5）
        for pattern in self._extra_patterns:
            if pattern.search(text):
                max_level = max(max_level, 5)
                break

        # P1: 上下文关键词降级（仅对 level >= 2 的命中生效）
        if max_level >= 2:
            max_level = self._apply_context_reduction(text, max_level)

        return max_level

    def _apply_context_reduction(self, text: str, current_level: int) -> int:
        """根据上下文关键词降低敏感级别。

        当敏感词命中且同时出现安全上下文关键词时，降低级别。
        降级后的级别不低于 0。

        Args:
            text: 输入文本
            current_level: 当前检测到的敏感级别

        Returns:
            降级后的敏感级别
        """
        reduced_level = current_level
        for sensitive_pattern, safe_keywords, reduction in _CONTEXT_SAFE_KEYWORDS:
            if sensitive_pattern.search(text):
                # 检查是否同时出现安全上下文关键词
                for keyword in safe_keywords:
                    if keyword.lower() in text.lower():
                        reduced_level = min(reduced_level, current_level - reduction)
                        break  # 命中一个安全关键词即可降级

        return max(0, reduced_level)

    # ------------------------------------------------------------------
    # 输入质量评估（对应问题 2）
    # ------------------------------------------------------------------

    def _assess_quality(self, text: str, language: str) -> float:
        """启发式规则评估输入质量（0~1）。

        评估维度：
        - 长度适宜度：过短或过长都扣分
        - 有效词占比：非空白字符比例
        - 信息密度：疑问词 / 关键词密度
        - 重复度：连续重复字符扣分
        """
        if not text:
            return 0.0

        score = 1.0
        length = len(text)

        # 长度适宜度
        if length < 5:
            score -= 0.3
        elif length < 10:
            score -= 0.15
        elif length > self._max_length * 0.9:
            score -= 0.1

        # 有效词占比
        non_space = sum(1 for c in text if not c.isspace())
        valid_ratio = non_space / length if length > 0 else 0
        if valid_ratio < 0.5:
            score -= 0.2

        # 信息密度（疑问词 / 关键词）
        question_marks = text.count("?") + text.count("？")
        if question_marks == 0 and length > 20:
            score -= 0.05  # 长文本无疑问标记，可能信息密度低

        # 重复度检测
        max_repeat = self._max_consecutive_repeat(text)
        if max_repeat > 5:
            score -= 0.2 * min((max_repeat - 5) / 10, 1.0)

        return max(0.0, min(1.0, round(score, 3)))

    def _max_consecutive_repeat(self, text: str) -> int:
        """计算最大连续重复字符数。"""
        if not text:
            return 0
        max_repeat = 1
        current = 1
        for i in range(1, len(text)):
            if text[i] == text[i - 1]:
                current += 1
                max_repeat = max(max_repeat, current)
            else:
                current = 1
        return max_repeat

    # ------------------------------------------------------------------
    # 置信度计算（对应问题 2：真实置信度）
    # ------------------------------------------------------------------

    def _compute_confidence(
        self,
        lang_dist: Dict[str, float],
        sensitivity_level: int,
        security_score: float,
        quality_score: float,
        decoding_errors: int,
    ) -> float:
        """综合计算置信度（0~1）。

        权重分配：
        - 语种检测置信度: 25%（top-1 概率）
        - 安全评分: 30%
        - 输入质量: 25%
        - 敏感词级别: 10%（级别越高置信度越低）
        - 解码错误: 10%
        """
        # 语种检测置信度
        lang_conf = max(lang_dist.values()) if lang_dist else 0.5

        # 敏感词级别影响
        sensitivity_factor = 1.0 - (sensitivity_level / 5.0) * 0.5

        # 解码错误影响
        decoding_factor = max(0.0, 1.0 - decoding_errors * 0.1)

        confidence = (
            lang_conf * 0.25
            + security_score * 0.30
            + quality_score * 0.25
            + sensitivity_factor * 0.10
            + decoding_factor * 0.10
        )

        return max(0.0, min(1.0, round(confidence, 3)))
