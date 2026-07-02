from __future__ import annotations

import importlib
import inspect
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

    @staticmethod
    def _serialize_component_config(component: Any) -> Optional[Dict[str, Any]]:
        """序列化组件配置（提取构造参数）。

        通过 inspect 获取 __init__ 参数签名，从对象属性中匹配参数值。
        存储类的模块路径和参数配置，回滚时通过反射重建。

        Args:
            component: 组件实例

        Returns:
            包含 module_path, class_name, init_params 的字典，
            无法序列化时返回 None
        """
        if component is None:
            return None

        try:
            cls = type(component)
            module_path = cls.__module__
            class_name = cls.__qualname__

            init_params: Dict[str, Any] = {}
            try:
                sig = inspect.signature(cls.__init__)
                for param_name in sig.parameters:
                    if param_name == "self":
                        continue
                    attr_name = f"_{param_name}"
                    if hasattr(component, attr_name):
                        value = getattr(component, attr_name)
                        if _is_json_serializable(value):
                            init_params[param_name] = value
                    elif hasattr(component, param_name):
                        value = getattr(component, param_name)
                        if _is_json_serializable(value):
                            init_params[param_name] = value
            except (ValueError, TypeError):
                pass

            if not init_params:
                init_params = {}
                for attr_name in dir(component):
                    if attr_name.startswith("_") or attr_name.startswith("__"):
                        continue
                    try:
                        value = getattr(component, attr_name)
                        if callable(value):
                            continue
                        if _is_json_serializable(value):
                            init_params[attr_name] = value
                    except Exception:
                        continue

            return {
                "module_path": module_path,
                "class_name": class_name,
                "init_params": init_params,
            }
        except Exception as e:
            logger.warning("Failed to serialize component config: %s", str(e))
            return None

    @staticmethod
    def _deserialize_component_config(component_config: Dict[str, Any]) -> Optional[Any]:
        """从配置反序列化重建组件实例。

        Args:
            component_config: _serialize_component_config 产出的配置字典

        Returns:
            重建的组件实例，失败时返回 None
        """
        if not component_config:
            return None

        try:
            module_path = component_config.get("module_path")
            class_name = component_config.get("class_name")
            init_params = component_config.get("init_params", {})

            if not module_path or not class_name:
                logger.warning("Invalid component config: missing module/class info")
                return None

            module = importlib.import_module(module_path)
            cls = module
            for name_part in class_name.split("."):
                cls = getattr(cls, name_part)

            try:
                sig = inspect.signature(cls.__init__)
                valid_params = {}
                for param_name in sig.parameters:
                    if param_name == "self":
                        continue
                    if param_name in init_params:
                        valid_params[param_name] = init_params[param_name]
                instance = cls(**valid_params)
            except (ValueError, TypeError):
                instance = cls(**init_params)

            logger.info(
                "Reconstructed component: %s.%s with %d params",
                module_path, class_name, len(init_params),
            )
            return instance
        except Exception as e:
            logger.warning("Failed to deserialize component: %s", str(e))
            return None

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

        component_config = self._serialize_component_config(component)

        version_file_path = self._get_version_file_path(component_name, version)
        version_data = {
            "version": version,
            "state": state,
            "metadata": metadata,
            "category": category,
            "component_config": component_config,
        }
        with open(version_file_path, "w", encoding="utf-8") as f:
            json.dump(version_data, f, ensure_ascii=False, indent=2, default=str)

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
        """获取指定版本快照。

        从 component_config 反序列化重建 component 对象，
        保持与旧版 API 的兼容性（返回 dict 中包含 component 字段）。
        """
        version_file_path = self._get_version_file_path(component_name, version)
        if not os.path.exists(version_file_path):
            logger.warning("Version %s not found for component %s", version, component_name)
            return None

        with open(version_file_path, "r", encoding="utf-8") as f:
            version_data = json.load(f)

        component_config = version_data.get("component_config")
        if component_config and "component" not in version_data:
            component = self._deserialize_component_config(component_config)
            version_data["component"] = component

        return version_data

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


def _is_json_serializable(value: Any) -> bool:
    """检查值是否可以被 JSON 序列化。

    Args:
        value: 待检查的值

    Returns:
        True 如果值可以被 JSON 序列化，否则 False
    """
    if value is None:
        return True
    if isinstance(value, (bool, int, float, str)):
        return True
    if isinstance(value, (list, tuple)):
        return all(_is_json_serializable(v) for v in value)
    if isinstance(value, dict):
        return all(
            isinstance(k, str) and _is_json_serializable(v)
            for k, v in value.items()
        )
    return False
