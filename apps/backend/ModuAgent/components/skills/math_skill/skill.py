"""示例 Skill：math_skill（P4）。

封装 CalculatorTool，并注入数学计算相关的 system prompt 片段与示例。
可被 SkillLoader 通过 ``components/skills`` 目录扫描自动发现（约定：<skill>/skill.py 含模块级 ``skill``）。

本文件即 Skill 的实现，无需改动任何核心代码即可被 Agent 加载。
"""

from __future__ import annotations

from core.interfaces.skill import BaseSkill
from components.action.tools.calculator import CalculatorTool


class MathSkill(BaseSkill):
    def name(self) -> str:
        return "math"

    def description(self) -> str:
        return "数学计算与表达式求值能力，支持加减乘除和括号运算"

    def version(self) -> str:
        return "1.0.0"

    def tags(self) -> list:
        return ["math", "calculation"]

    def examples(self) -> list:
        return [
            {"input": "计算 (1+2)*3 等于多少", "output": "调用 calculator 工具求值，得到 9"},
            {"input": "帮我算一下 3.14 的平方", "output": "调用 calculator 工具计算 3.14*3.14"},
        ]

    def system_prompt_fragment(self) -> str:
        return (
            "当用户需要进行数学计算或表达式求值时，优先使用 calculator 工具；"
            "该工具仅支持数字与 + - * / ( ) 运算符，请勿构造非法表达式。"
        )

    def tools(self):
        return [CalculatorTool()]


# SkillLoader 约定：模块级 ``skill`` 实例
skill = MathSkill()
