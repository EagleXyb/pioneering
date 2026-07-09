"""Skill 动态加载器（P2）。

采用适配器/插件扫描模式，支持两种来源：
    1. 目录扫描：遍历 ``skills.auto_discover_dirs`` 下每个 ``<skill>/skill.py``，
       提取模块级 ``skill``（BaseSkill 实例）或 ``skills``（列表）属性。
    2. 配置驱动：读 ``skills.enabled`` / ``skills.active``，仅激活白名单 Skill。

每个 Skill 的导入与实例化均被 try/except 隔离（P5 加载隔离），
单个 Skill 失败仅告警并跳过，绝不阻断 Agent 启动。
"""

from __future__ import annotations

import importlib.util
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from config.runtime_config import RuntimeConfig
from core.interfaces.skill import BaseSkill
from core.registry import ComponentRegistry

logger = logging.getLogger(__name__)


class SkillLoader:
    def __init__(self, registry: ComponentRegistry, config: RuntimeConfig) -> None:
        self._registry = registry
        self._config = config

    # ------------------------------------------------------------------
    # 目录扫描发现
    # ------------------------------------------------------------------

    def discover(self, paths: List[str]) -> List[BaseSkill]:
        """扫描目录，发现所有合法 Skill 模块。

        约定：``<base>/<skill_name>/skill.py`` 中定义模块级 ``skill`` 或 ``skills``。
        每个模块导入失败均被隔离记录，不影响其他 Skill。

        Args:
            paths: 待扫描的根目录列表

        Returns:
            发现的 BaseSkill 实例列表（去重按 name）
        """
        found: Dict[str, BaseSkill] = {}
        for base in paths:
            base_path = Path(base)
            if not base_path.is_dir():
                logger.debug("Skill discover path not a dir, skip: %s", base)
                continue
            for sub in sorted(base_path.iterdir()):
                if not sub.is_dir():
                    continue
                skill_file = sub / "skill.py"
                if not skill_file.exists():
                    continue
                try:
                    mod = self._load_module(f"modu_skill_{sub.name}", skill_file)
                    skill = getattr(mod, "skill", None)
                    if isinstance(skill, BaseSkill):
                        found[skill.name()] = skill
                    skills_attr = getattr(mod, "skills", None)
                    if isinstance(skills_attr, list):
                        for s in skills_attr:
                            if isinstance(s, BaseSkill):
                                found[s.name()] = s
                except Exception as e:  # noqa: BLE001 - 加载隔离
                    logger.error("Failed to load skill from %s: %s", skill_file, e)
        return list(found.values())

    @staticmethod
    def _load_module(module_name: str, path: Path):
        spec = importlib.util.spec_from_file_location(module_name, str(path))
        if spec is None or spec.loader is None:
            raise ImportError(f"Cannot create spec for {path}")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)  # noqa: S320 - 受控：仅加载白名单目录
        return mod

    # ------------------------------------------------------------------
    # 配置驱动加载
    # ------------------------------------------------------------------

    def load_from_config(self) -> None:
        """按配置激活 Skill。

        关闭（``skills.enabled=False``，默认）时直接返回，所有新增路径不可达。
        """
        if not self._config.get("skills.enabled", False):
            logger.debug("Skills disabled (skills.enabled=False), skipping load")
            return

        active: List[str] = self._config.get("skills.active", []) or []
        discover_dirs: List[str] = self._config.get("skills.auto_discover_dirs", []) or []

        discovered = {s.name(): s for s in self.discover(discover_dirs)}

        for name in active:
            if self._registry.get_skill(name) is not None:
                logger.debug("Skill '%s' already registered, skip", name)
                continue
            skill = discovered.get(name)
            if skill is None:
                logger.warning("Active skill '%s' not found in discover dirs, skip", name)
                continue
            try:
                skill.setup()
                self._registry.register_skill(skill)  # 内部自动注册工具（含 SkillToolWrapper）
            except Exception as e:  # noqa: BLE001 - 加载隔离
                logger.error("Skill '%s' failed to setup/register: %s", name, e)
