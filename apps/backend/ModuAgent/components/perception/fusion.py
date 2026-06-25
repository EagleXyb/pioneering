from __future__ import annotations

"""多路感知融合器（对应问题 9：多感知融合）。

当同一输入有多个感知器处理（如文本 + 图像 + 音频）时，
将多路结果按权重融合，输出统一的感知结果。

支持的融合策略：
- weighted_average: 按模态权重加权平均
- max_confidence: 取置信度最高的结果
- voting: 多数投票（用于敏感度等离散字段）
"""

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# 默认模态权重
_DEFAULT_WEIGHTS = {
    "text": 0.5,
    "image": 0.3,
    "audio": 0.2,
}


class PerceptionFusion:
    """多路感知结果融合器。"""

    def __init__(
        self,
        strategy: str = "weighted_average",
        weights: Optional[Dict[str, float]] = None,
    ) -> None:
        self._strategy = strategy
        self._weights = weights or _DEFAULT_WEIGHTS

    def fuse(self, results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """融合多路感知结果。

        Args:
            results: 多个感知器的输出列表

        Returns:
            融合后的单一感知结果
        """
        if not results:
            return self._empty_result()

        if len(results) == 1:
            return results[0]

        if self._strategy == "max_confidence":
            return self._fuse_max_confidence(results)
        elif self._strategy == "voting":
            return self._fuse_voting(results)
        else:
            return self._fuse_weighted_average(results)

    def _fuse_weighted_average(self, results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """加权平均融合。"""
        total_weight = 0.0
        fused_confidence = 0.0
        fused_quality = 0.0
        fused_security = 0.0

        # 取最高敏感度
        max_sensitivity = 0
        all_entities: List[Dict[str, str]] = []
        all_metadata: Dict[str, Any] = {}

        # 合并文本
        merged_text_parts: List[str] = []

        for result in results:
            input_type = result.get("parsed_content", {}).get("input_type", "text")
            weight = self._weights.get(input_type, 0.3)

            confidence = result.get("confidence", 0.0)
            quality = result.get("quality_score", 0.0)
            security = result.get("security_score", 1.0)
            sensitivity = result.get("metadata", {}).get("sensitivity_level", 0)

            fused_confidence += confidence * weight
            fused_quality += quality * weight
            fused_security += security * weight
            max_sensitivity = max(max_sensitivity, sensitivity)
            total_weight += weight

            # 合并文本
            text = result.get("parsed_content", {}).get("text", "")
            if text:
                merged_text_parts.append(text)

            # 合并实体
            entities = result.get("entities", [])
            all_entities.extend(entities)

            # 合并 metadata
            meta = result.get("metadata", {})
            for key, value in meta.items():
                if key not in all_metadata:
                    all_metadata[key] = value

        if total_weight > 0:
            fused_confidence /= total_weight
            fused_quality /= total_weight
            fused_security /= total_weight

        return {
            "parsed_content": {
                "input_type": "fused",
                "text": "\n".join(merged_text_parts),
                "modalities": [r.get("parsed_content", {}).get("input_type", "text") for r in results],
            },
            "detected_language": results[0].get("detected_language"),
            "confidence": round(fused_confidence, 3),
            "metadata": {
                **all_metadata,
                "sensitivity_level": max_sensitivity,
                "fusion_strategy": "weighted_average",
                "source_count": len(results),
            },
            "quality_score": round(fused_quality, 3),
            "security_score": round(fused_security, 3),
            "entities": all_entities,
            "intent": self._merge_intent(results),
            "sentiment": self._merge_sentiment(results),
            "language_mixed": any(r.get("language_mixed", False) for r in results),
        }

    def _fuse_max_confidence(self, results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """取置信度最高的结果。"""
        best = max(results, key=lambda r: r.get("confidence", 0.0))
        best = dict(best)  # 浅拷贝
        best.setdefault("metadata", {})["fusion_strategy"] = "max_confidence"
        return best

    def _fuse_voting(self, results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """多数投票融合（主要用于敏感度等离散字段）。"""
        # 敏感度投票
        sensitivity_votes: Dict[int, int] = {}
        for r in results:
            level = r.get("metadata", {}).get("sensitivity_level", 0)
            sensitivity_votes[level] = sensitivity_votes.get(level, 0) + 1

        voted_sensitivity = max(sensitivity_votes, key=sensitivity_votes.get)

        # 取置信度最高的作为基础
        best = max(results, key=lambda r: r.get("confidence", 0.0))
        best = dict(best)
        best.setdefault("metadata", {})["sensitivity_level"] = voted_sensitivity
        best["metadata"]["fusion_strategy"] = "voting"
        return best

    def _merge_intent(self, results: List[Dict[str, Any]]) -> Optional[Dict[str, float]]:
        """合并意图结果。"""
        merged: Dict[str, float] = {}
        for r in results:
            intent = r.get("intent")
            if isinstance(intent, dict):
                for key, value in intent.items():
                    merged[key] = max(merged.get(key, 0.0), value)
            elif isinstance(intent, str):
                merged[intent] = merged.get(intent, 0.0) + 1.0 / len(results)
        return merged if merged else None

    def _merge_sentiment(self, results: List[Dict[str, Any]]) -> Optional[Dict[str, float]]:
        """合并情感结果。"""
        merged = {"positive": 0.0, "negative": 0.0, "neutral": 0.0}
        count = 0
        for r in results:
            sentiment = r.get("sentiment")
            if isinstance(sentiment, dict):
                for key in merged:
                    merged[key] += sentiment.get(key, 0.0)
                count += 1
        if count == 0:
            return None
        for key in merged:
            merged[key] = round(merged[key] / count, 3)
        return merged

    def _empty_result(self) -> Dict[str, Any]:
        return {
            "parsed_content": {"input_type": "empty", "text": ""},
            "detected_language": None,
            "confidence": 0.0,
            "metadata": {"sensitivity_level": 0, "fusion_strategy": "none"},
            "quality_score": 0.0,
            "security_score": 1.0,
            "entities": [],
            "intent": None,
            "sentiment": None,
        }
