"""Skill 提示聚合器（P2）。

把当前已注册的所有 Skill 提示片段合并为一段注入 LLM 的 system prompt 补充。
无激活 Skill 时返回原始 base 提示，行为等价于改造前。
"""

from __future__ import annotations

import logging
from typing import List, Optional

from core.interfaces.skill import BaseSkill
from core.registry import ComponentRegistry
from skills.adapter import SkillAdapter

logger = logging.getLogger(__name__)


class SkillPromptAggregator:
    @staticmethod
    def aggregate(base: Optional[str], registry: ComponentRegistry) -> Optional[str]:
        """合并 base 提示与所有已注册 Skill 的提示片段。

        Args:
            base: 原始 system prompt（可能为 None）
            registry: 组件注册中心

        Returns:
            合并后的提示；若无任何 Skill 片段则返回 base（原样）。
        """
        try:
            names = list(registry.list_skills().keys())
            skills = [registry.get_skill(n) for n in names]
            skills = [s for s in skills if s is not None]
        except Exception as e:  # noqa: BLE001 - 提示注入失败降级
            logger.warning("Skill prompt aggregation failed, fallback to base: %s", e)
            return base

        frags = [SkillAdapter.prompt_fragment(s) for s in skills]
        frags = [f for f in frags if f]
        if not frags:
            return base

        merged = (base or "") + "\n\n" + "\n\n".join(frags)
        return merged
