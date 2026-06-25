from __future__ import annotations

"""感知层公共工具函数（对应问题 11：事件追踪信息标准化）。"""

import json
from typing import Any, Dict


def build_perception_event_metadata(
    perception_result: Dict[str, Any],
    input_type: str,
) -> Dict[str, str]:
    """从感知结果构建标准化事件 metadata。

    将感知结果中的所有关键字段转为字符串，用于 AgentEvent.metadata。
    确保事件日志包含完整的可观测性信息。

    Args:
        perception_result: 感知器输出结果
        input_type: 输入类型（text/image/audio）

    Returns:
        标准化的 metadata 字典（所有值为字符串）
    """
    meta = perception_result.get("metadata", {})
    truncation_info = meta.get("truncation_info", {})
    security_details = meta.get("security_details", {})
    sanitization_warnings = meta.get("sanitization_warnings", {})

    return {
        # 基础字段
        "input_type": input_type,
        "detected_language": str(perception_result.get("detected_language", "")),
        "confidence": str(perception_result.get("confidence", 1.0)),
        # 安全字段
        "sensitivity_level": str(meta.get("sensitivity_level", 0)),
        "sensitivity_label": str(meta.get("sensitivity_label", "safe")),
        "security_score": str(perception_result.get("security_score", meta.get("security_score", 1.0))),
        "injection_detected": str(meta.get("injection_detected", False)),
        "pii_detected": str(meta.get("pii_detected", False)),
        # 截断字段
        "truncated": str(meta.get("truncated", False)),
        "original_length": str(meta.get("original_length", 0)),
        "truncated_length": str(truncation_info.get("truncated_length", 0)),
        "truncation_ratio": str(truncation_info.get("truncation_ratio", 1.0)),
        # 语义字段
        "intent": json.dumps(perception_result.get("intent"), ensure_ascii=False) if perception_result.get("intent") else "{}",
        "entity_count": str(len(perception_result.get("entities", []))),
        "sentiment": json.dumps(perception_result.get("sentiment"), ensure_ascii=False) if perception_result.get("sentiment") else "{}",
        "quality_score": str(perception_result.get("quality_score", 0.0)),
        "language_mixed": str(perception_result.get("language_mixed", False)),
        "language_distribution": json.dumps(perception_result.get("language_distribution", {}), ensure_ascii=False),
        # 编码字段
        "decoding_errors": str(meta.get("decoding_errors", 0)),
        "sanitization_warnings": json.dumps(sanitization_warnings, ensure_ascii=False),
        # 安全详情
        "security_details": json.dumps(security_details, ensure_ascii=False) if security_details else "{}",
    }


def extract_perception_context(perception_result: Dict[str, Any]) -> Dict[str, Any]:
    """从感知结果中提取需要注入 LLM context 的字段（对应问题 7）。

    将感知结果中的语义字段提取为可注入 LLM context 的结构。
    """
    return {
        "detected_language": perception_result.get("detected_language"),
        "confidence": perception_result.get("confidence"),
        "intent": perception_result.get("intent"),
        "entities": perception_result.get("entities", []),
        "sentiment": perception_result.get("sentiment"),
        "quality_score": perception_result.get("quality_score"),
        "language_mixed": perception_result.get("language_mixed", False),
        "language_distribution": perception_result.get("language_distribution"),
        "security_score": perception_result.get("security_score"),
        "sensitivity_level": perception_result.get("metadata", {}).get("sensitivity_level", 0),
    }
