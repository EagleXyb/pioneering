"""Skills 子系统单元测试（P5）。

覆盖：BaseSkill 契约、注册中心 _skills 扩展、SkillToolWrapper 执行隔离、
SkillAdapter / SkillPromptAggregator、SkillLoader 发现与加载隔离。

全部离线，不依赖 LLM/网络。
"""

from __future__ import annotations

from core.interfaces.action import BaseTool
from core.interfaces.skill import BaseSkill
from core.registry import ComponentRegistry, get_registry, reset_registry
from config.runtime_config import RuntimeConfig
from skills.adapter import SkillAdapter, SkillToolWrapper
from skills.loader import SkillLoader
from skills.prompt_aggregator import SkillPromptAggregator


# ----------------------------------------------------------------------
# 测试替身
# ----------------------------------------------------------------------

class FakeTool(BaseTool):
    def __init__(self, name="fake_tool", should_raise=False):
        self._name = name
        self._should_raise = should_raise

    def name(self):
        return self._name

    def description(self):
        return "fake tool for testing"

    def parameters_schema(self):
        return {"type": "object", "properties": {}}

    def invoke(self, params, context):
        if self._should_raise:
            raise RuntimeError("boom")
        return {"status": "success", "data": {"ok": True}}


class FakeSkill(BaseSkill):
    def __init__(self, name="fake", tools=None, available=True, fragment=None):
        self._name = name
        self._tools = tools or []
        self._available = available
        self._fragment = fragment

    def name(self):
        return self._name

    def description(self):
        return f"description of {self._name}"

    def version(self):
        return "0.1.0"

    def tags(self):
        return ["t1"]

    def examples(self):
        return [{"input": "a", "output": "b"}]

    def system_prompt_fragment(self):
        return self._fragment

    def tools(self):
        return self._tools

    def is_available(self):
        return self._available


# ----------------------------------------------------------------------
# 注册中心扩展
# ----------------------------------------------------------------------

def _fresh():
    reset_registry()
    return get_registry()


def test_register_skill_registers_tools_and_skill():
    reg = _fresh()
    tool = FakeTool()
    skill = FakeSkill(tools=[tool])
    reg.register_skill(skill)

    assert reg.get_skill("fake") is skill
    assert "fake" in reg.list_skills()
    # 内含工具自动注册
    assert reg.get_tool("fake_tool") is not None
    assert "fake_tool" in reg.list_tools()


def test_register_skill_skips_unavailable():
    reg = _fresh()
    skill = FakeSkill(available=False)
    reg.register_skill(skill)
    assert reg.get_skill("fake") is None


def test_register_skill_conflict_name_skips_tool():
    reg = _fresh()
    reg.register_tool(FakeTool(name="fake_tool"))  # 预置同名工具
    skill = FakeSkill(tools=[FakeTool(name="fake_tool")])
    reg.register_skill(skill)
    assert reg.get_skill("fake") is skill
    # 工具冲突被跳过，但 Skill 仍注册
    assert len(reg.list_tools()) == 1


def test_unregister_skill():
    reg = _fresh()
    reg.register_skill(FakeSkill())
    assert reg.unregister_skill("fake") is True
    assert reg.get_skill("fake") is None


def test_swap_component_supports_skill():
    reg = _fresh()
    reg.register_skill(FakeSkill())
    assert reg.swap_component("skill", "fake", FakeSkill(name="fake")) is True


def test_list_all_includes_skills():
    reg = _fresh()
    reg.register_skill(FakeSkill())
    assert "fake" in reg.list_all()["skills"]


# ----------------------------------------------------------------------
# SkillToolWrapper 执行隔离
# ----------------------------------------------------------------------

def test_skill_tool_wrapper_delegates():
    w = SkillToolWrapper(FakeTool(), skill_name="fake")
    assert w.name() == "fake_tool"
    res = w.invoke({}, {})
    assert res["status"] == "success"


def test_skill_tool_wrapper_isolates_exception():
    w = SkillToolWrapper(FakeTool(should_raise=True), skill_name="fake")
    res = w.invoke({}, {})
    assert res["status"] == "error"
    assert res["error_code"] == "SKILL_EXECUTION_FAILED"
    assert res["data"]["skill"] == "fake"


# ----------------------------------------------------------------------
# SkillAdapter / SkillPromptAggregator
# ----------------------------------------------------------------------

def test_skill_adapter_tool_names_and_prompt():
    skill = FakeSkill(fragment="使用 fake 工具完成任务")
    assert SkillAdapter.tool_names(skill) == []
    frag = SkillAdapter.prompt_fragment(skill)
    assert "fake" in frag and "使用 fake" in frag and "Examples" in frag


def test_skill_prompt_aggregator_merges():
    reg = _fresh()
    reg.register_skill(FakeSkill(fragment="片段A"))
    reg.register_skill(FakeSkill(name="fake2", fragment="片段B"))
    merged = SkillPromptAggregator.aggregate("BASE", reg)
    assert merged.startswith("BASE")
    assert "片段A" in merged and "片段B" in merged


def test_skill_prompt_aggregator_falls_back_when_empty():
    reg = _fresh()
    # 无 Skill 时返回 base 原样
    assert SkillPromptAggregator.aggregate("BASE", reg) == "BASE"
    assert SkillPromptAggregator.aggregate(None, reg) is None


# ----------------------------------------------------------------------
# SkillLoader 发现与隔离
# ----------------------------------------------------------------------

_SKILL_MODULE = '''
from core.interfaces.skill import BaseSkill
from core.interfaces.action import BaseTool

class _T(BaseTool):
    def name(self): return "dummy_tool"
    def description(self): return "dummy"
    def parameters_schema(self): return {"type": "object", "properties": {}}
    def invoke(self, params, context): return {"status": "success", "data": {}}

class DummySkill(BaseSkill):
    def name(self): return "dummy"
    def description(self): return "dummy skill"
    def version(self): return "0.1.0"
    def tools(self): return [_T()]

skill = DummySkill()
'''

_BROKEN_MODULE = '''
import a_module_that_does_not_exist_xyz
'''


def test_skill_loader_discover_finds_skill(tmp_path):
    d = tmp_path / "dummy_skill"
    d.mkdir()
    (d / "skill.py").write_text(_SKILL_MODULE, encoding="utf-8")
    loader = SkillLoader(ComponentRegistry(), RuntimeConfig())
    skills = loader.discover([str(tmp_path)])
    names = [s.name() for s in skills]
    assert "dummy" in names


def test_skill_loader_discover_isolates_broken_module(tmp_path):
    bad = tmp_path / "broken_skill"
    bad.mkdir()
    (bad / "skill.py").write_text(_BROKEN_MODULE, encoding="utf-8")
    loader = SkillLoader(ComponentRegistry(), RuntimeConfig())
    # 不应抛异常，返回空列表
    assert loader.discover([str(tmp_path)]) == []


def test_skill_loader_load_from_config_registers(tmp_path):
    d = tmp_path / "dummy_skill"
    d.mkdir()
    (d / "skill.py").write_text(_SKILL_MODULE, encoding="utf-8")

    reg = ComponentRegistry()
    cfg = RuntimeConfig()
    cfg.set("skills.enabled", True)
    cfg.set("skills.active", ["dummy"])
    cfg.set("skills.auto_discover_dirs", [str(tmp_path)])

    SkillLoader(reg, cfg).load_from_config()

    assert reg.get_skill("dummy") is not None
    assert reg.get_tool("dummy_tool") is not None  # 工具自动注册（经 SkillToolWrapper）


def test_skill_loader_load_from_config_disabled_noop(tmp_path):
    d = tmp_path / "dummy_skill"
    d.mkdir()
    (d / "skill.py").write_text(_SKILL_MODULE, encoding="utf-8")

    reg = ComponentRegistry()
    cfg = RuntimeConfig()
    cfg.set("skills.enabled", False)  # 默认即 False
    cfg.set("skills.active", ["dummy"])
    cfg.set("skills.auto_discover_dirs", [str(tmp_path)])

    SkillLoader(reg, cfg).load_from_config()
    assert reg.get_skill("dummy") is None
    assert reg.list_skills() == {}


def test_skill_loader_idempotent(tmp_path):
    d = tmp_path / "dummy_skill"
    d.mkdir()
    (d / "skill.py").write_text(_SKILL_MODULE, encoding="utf-8")

    reg = ComponentRegistry()
    cfg = RuntimeConfig()
    cfg.set("skills.enabled", True)
    cfg.set("skills.active", ["dummy"])
    cfg.set("skills.auto_discover_dirs", [str(tmp_path)])

    loader = SkillLoader(reg, cfg)
    loader.load_from_config()
    before = reg.get_skill("dummy")
    loader.load_from_config()  # 再次加载应被幂等守卫跳过
    assert reg.get_skill("dummy") is before
