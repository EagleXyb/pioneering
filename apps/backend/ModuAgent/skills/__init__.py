"""Skills 子系统（P1/P2）。

包含：
    - adapter.py: SkillAdapter（Skill→工具名/提示片段降解）、SkillToolWrapper（执行隔离）
    - loader.py: SkillLoader（目录/配置动态发现与注册）
    - prompt_aggregator.py: SkillPromptAggregator（合并多 Skill 提示片段）
"""

from __future__ import annotations

from skills.adapter import SkillAdapter, SkillToolWrapper
from skills.loader import SkillLoader
from skills.prompt_aggregator import SkillPromptAggregator

__all__ = ["SkillAdapter", "SkillToolWrapper", "SkillLoader", "SkillPromptAggregator"]
