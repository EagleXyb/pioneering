"""Skill 适配器（P2）。

提供两个职责：
    1. SkillAdapter：把 BaseSkill 降解为图可消费的两类产物
       —— 工具名列表 + system prompt 片段（含 examples）。
    2. SkillToolWrapper：执行隔离包装，捕获 Skill 工具内部的任意异常，
       返回与现有工具（见 components/action/tools/calculator.py）一致的错误结构，
       避免 Skill 缺陷外泄到 LangGraph 图导致整个请求失败。
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from core.interfaces.action import BaseTool
from core.interfaces.skill import BaseSkill

logger = logging.getLogger(__name__)


class SkillAdapter:
    """把 BaseSkill 降解为工具集 + 提示片段。"""

    @staticmethod
    def tool_names(skill: BaseSkill) -> List[str]:
        """返回 Skill 内含工具名列表。"""
        return [t.name() for t in skill.tools()]

    @staticmethod
    def prompt_fragment(skill: BaseSkill) -> Optional[str]:
        """构建注入 LLM 的提示片段（含可选 examples）。

        Returns:
            提示字符串，或 None（当 Skill 无提示/描述时返回 None 以避免注入空片段）。
        """
        frag = skill.system_prompt_fragment()
        if not frag and not skill.description():
            return None

        header = f"[Skill: {skill.name()} v{skill.version()}]"
        body = frag or skill.description()

        examples = skill.examples()
        example_text = ""
        if examples:
            lines = []
            for ex in examples:
                inp = ex.get("input", "")
                out = ex.get("output", "")
                lines.append(f"  输入: {inp}\n  输出: {out}")
            example_text = "\nExamples:\n" + "\n".join(lines)

        return f"{header}\n{body}{example_text}"


class SkillToolWrapper(BaseTool):
    """执行隔离包装（P5 降级机制）。

    委托被包装工具的全部接口，仅在 ``invoke`` 外层捕获异常，
    保证 Skill 工具任何运行时错误都被标准化为错误字典，不影响图的 ReAct 循环。

    包装后 ``name()`` 保持不变，因此注册中心/图/function calling 视角无差异。
    """

    def __init__(self, inner: BaseTool, skill_name: str) -> None:
        self._inner = inner
        self._skill_name = skill_name

    def name(self) -> str:
        return self._inner.name()

    def description(self) -> str:
        return self._inner.description()

    def parameters_schema(self) -> Dict:
        return self._inner.parameters_schema()

    def requires_approval(self) -> bool:
        return self._inner.requires_approval()

    def on_approval_rejected(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return self._inner.on_approval_rejected(params)

    def invoke(self, params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        try:
            return self._inner.invoke(params, context)
        except Exception as e:  # noqa: BLE001 - 执行隔离：绝不让 Skill 异常外泄
            logger.error(
                "Skill tool '%s' (skill=%s) failed: %s",
                self._inner.name(), self._skill_name, e,
            )
            return {
                "status": "error",
                "error_code": "SKILL_EXECUTION_FAILED",
                "data": {"message": str(e), "skill": self._skill_name},
            }
