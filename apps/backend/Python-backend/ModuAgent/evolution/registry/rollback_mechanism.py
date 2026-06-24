from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Dict, List, Optional, Tuple

if TYPE_CHECKING:
    from evolution.registry.versioned_store import VersionedComponentStore
    from core.registry import ComponentRegistry

logger = logging.getLogger(__name__)


class RollbackMechanism:
    """基于质量回退的自动回滚机制。"""

    def __init__(
        self,
        version_store: "VersionedComponentStore",
        registry: "ComponentRegistry",
        rollback_threshold: float = 0.7,
    ):
        self._version_store = version_store
        self._registry = registry
        self._rollback_threshold = rollback_threshold
        self._quality_records: Dict[str, List[Tuple[str, float]]] = {}
        self._rollback_count: int = 0

    def record_and_check(
        self,
        component_name: str,
        version: str,
        quality_score: float,
    ) -> bool:
        """记录质量得分并在需要时回滚。

        Returns:
            是否发生了回滚
        """
        if component_name not in self._quality_records:
            self._quality_records[component_name] = []
        self._quality_records[component_name].append((version, quality_score))

        logger.info(
            "Recorded quality score %.3f for %s version %s",
            quality_score,
            component_name,
            version,
        )

        if quality_score < self._rollback_threshold:
            logger.warning(
                "Quality score %.3f below threshold %.3f for %s",
                quality_score,
                self._rollback_threshold,
                component_name,
            )
            stable_version = self._find_stable_version(component_name)
            if stable_version:
                return self.rollback_to_version(component_name, stable_version)
            else:
                logger.error(
                    "No stable version found for %s to rollback to",
                    component_name,
                )
                return False

        return False

    def rollback_to_version(
        self,
        component_name: str,
        version: str,
    ) -> bool:
        """回滚到指定版本。

        流程：
        1. 从 version_store 获取版本快照
        2. 调用 registry.swap_component() 应用版本
        3. 记录回滚事件
        """
        snapshot = self._version_store.get_version(component_name, version)
        if snapshot is None:
            logger.error(
                "Failed to get snapshot for %s version %s",
                component_name,
                version,
            )
            return False

        category = snapshot.get("category")
        component = snapshot.get("component")

        if category is None or component is None:
            logger.error(
                "Invalid snapshot format for %s version %s",
                component_name,
                version,
            )
            return False

        success = self._registry.swap_component(category, component_name, component)
        if success:
            self._rollback_count += 1
            logger.info(
                "Successfully rolled back %s to version %s (rollback #%d)",
                component_name,
                version,
                self._rollback_count,
            )
        return success

    def _find_stable_version(self, component_name: str) -> Optional[str]:
        """找到满足质量阈值的最稳定版本。"""
        records = self._quality_records.get(component_name, [])
        for version, score in reversed(records):
            if score >= self._rollback_threshold:
                return version
        return None

    def get_quality_history(self, component_name: str) -> List[Tuple[str, float]]:
        """获取组件的质量历史记录。"""
        return self._quality_records.get(component_name, [])

    def get_rollback_count(self) -> int:
        """获取回滚总次数。"""
        return self._rollback_count
