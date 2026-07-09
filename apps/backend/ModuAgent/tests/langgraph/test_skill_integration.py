"""Skills 与 LangGraph 接线集成测试（P5）。

验证：Skill 工具能经既有 build_langchain_tools → ToolNode 通路进入图；
默认关闭情况下零行为变化（回归）。

langchain/langgraph 为可选依赖：本环境未安装时，相关用例自动跳过（importorskip），
不影响 Skills 子系统自身（tests/skills/）的离线验证。
"""

from __future__ import annotations

from core.registry import get_registry, reset_registry
from config.runtime_config import get_config, reset_config
from components.skills.math_skill.skill import skill as math_skill
from skills.prompt_aggregator import SkillPromptAggregator


def setup_module(module):
    reset_registry()
    reset_config()


def teardown_module(module):
    reset_registry()
    reset_config()


def test_skill_prompt_injected_via_factory_path():
    """激活 Skill 后，SkillPromptAggregator 把提示片段聚合进 system prompt。"""
    reset_registry()
    reg = get_registry()
    reg.register_skill(math_skill)

    merged = SkillPromptAggregator.aggregate("你是一个助手。", reg)
    assert merged.startswith("你是一个助手。")
    assert "calculator" in merged


def test_skill_tools_flow_into_graph():
    """math_skill 的 calculator 工具经统一通路进入 ToolNode（需 langchain/langgraph）。"""
    pytest_import_skip()
    from unittest.mock import MagicMock
    from modu_graph.adapters.tool_adapter import build_langchain_tools
    from modu_graph.graph import build_modu_graph

    reset_registry()
    reg = get_registry()
    reg.register_skill(math_skill)

    lc_tools = build_langchain_tools(tool_names=["calculator"], registry=reg)
    assert len(lc_tools) == 1
    assert lc_tools[0].name == "calculator"

    llm = MagicMock()
    compiled = build_modu_graph(tools=lc_tools, llm=llm)
    assert compiled is not None


def test_no_skill_regression_default_config():
    """默认配置 skills.enabled=False，全新 registry 无任何 Skill，行为与改造前一致。"""
    reset_registry()
    reset_config()
    reg = get_registry()
    cfg = get_config()

    assert cfg.get("skills.enabled", False) is False
    assert reg.list_skills() == {}
    # 未注册任何 Skill 时，build_langchain_tools 不凭空产生工具
    pytest_import_skip()
    from modu_graph.adapters.tool_adapter import build_langchain_tools
    assert build_langchain_tools(registry=reg) == []


def pytest_import_skip():
    """惰性跳过需要 langchain/langgraph 的用例。"""
    import pytest
    pytest.importorskip("langchain_core")
    pytest.importorskip("langgraph")
