from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class VersionedComponentStore:
    """组件版本快照存储。"""

    def __init__(self, storage_path: str = "evolution/versions"):
        self._storage_path = storage_path

    def _get_component_dir(self, component_name: str) -> str:
        """获取组件的存储目录路径。"""
        return os.path.join(self._storage_path, component_name)

    def _get_version_file_path(self, component_name: str, version: str) -> str:
        """获取指定版本的JSON文件路径。"""
        return os.path.join(self._get_component_dir(component_name), f"{version}.json")

    def _get_versions_index_path(self, component_name: str) -> str:
        """获取版本索引文件路径。"""
        return os.path.join(self._get_component_dir(component_name), "_versions.json")

    def _load_versions_index(self, component_name: str) -> List[str]:
        """加载版本索引列表。"""
        index_path = self._get_versions_index_path(component_name)
        if os.path.exists(index_path):
            with open(index_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return []

    def _save_versions_index(self, component_name: str, versions: List[str]) -> None:
        """保存版本索引列表。"""
        component_dir = self._get_component_dir(component_name)
        os.makedirs(component_dir, exist_ok=True)
        index_path = self._get_versions_index_path(component_name)
        with open(index_path, "w", encoding="utf-8") as f:
            json.dump(versions, f, ensure_ascii=False, indent=2)

    def save_version(
        self,
        component_name: str,
        version: str,
        state: Dict[str, Any],
        metadata: Dict[str, Any],
        category: str = "",
        component: Any = None,
    ) -> None:
        """保存组件版本快照。

        Args:
            component_name: 组件名称
            version: 版本号
            state: 组件状态配置
            metadata: 元数据
            category: 组件分类（用于回滚时调用 registry.swap_component）
            component: 组件实例（用于回滚时恢复）
        """
        component_dir = self._get_component_dir(component_name)
        os.makedirs(component_dir, exist_ok=True)

        version_file_path = self._get_version_file_path(component_name, version)
        version_data = {
            "version": version,
            "state": state,
            "metadata": metadata,
            "category": category,
            "component": component,
        }
        with open(version_file_path, "w", encoding="utf-8") as f:
            json.dump(version_data, f, ensure_ascii=False, indent=2)

        versions = self._load_versions_index(component_name)
        if version not in versions:
            versions.append(version)
            self._save_versions_index(component_name, versions)

        logger.info("Saved version %s for component %s", version, component_name)

    def get_version(
        self,
        component_name: str,
        version: str,
    ) -> Optional[Dict[str, Any]]:
        """获取指定版本快照。"""
        version_file_path = self._get_version_file_path(component_name, version)
        if not os.path.exists(version_file_path):
            logger.warning("Version %s not found for component %s", version, component_name)
            return None

        with open(version_file_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def list_versions(
        self,
        component_name: str,
    ) -> List[str]:
        """列出组件的所有版本。"""
        return self._load_versions_index(component_name)

    def get_latest_version(
        self,
        component_name: str,
    ) -> Optional[str]:
        """获取组件的最新版本号。"""
        versions = self._load_versions_index(component_name)
        if not versions:
            return None
        return versions[-1]
