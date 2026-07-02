"""P0 问题修复验证测试。

验证：
- P0-1: VersionedComponentStore 序列化问题
- P0-2: ParameterTuneStrategy 全局污染问题
"""

from __future__ import annotations

import json
import os
import tempfile

import pytest

from components.action.tools.calculator import CalculatorTool
from config.runtime_config import RuntimeConfig
from evolution.registry.versioned_store import VersionedComponentStore, _is_json_serializable
from evolution.strategy.parameter_tune import ParameterTuneStrategy
from feedback.evolution_signal import EvolutionSignal, EvolutionSignalCollector


# ======================================================================
# P0-1: VersionedComponentStore 序列化测试
# ======================================================================

class TestVersionedComponentStoreSerialization:
    """P0-1: VersionedComponentStore 组件序列化与反序列化测试。"""

    def setup_method(self):
        self.tmpdir = tempfile.mkdtemp()
        self.store = VersionedComponentStore(storage_path=self.tmpdir)

    def teardown_method(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_save_version_no_type_error(self):
        """保存版本时不应抛出 TypeError（修复前的核心问题）。"""
        tool = CalculatorTool()
        self.store.save_version(
            component_name="calculator",
            version="v1.0",
            state={"enabled": True},
            metadata={"created_by": "test"},
            category="tool",
            component=tool,
        )

    def test_saved_data_is_valid_json(self):
        """保存的数据应该是有效的 JSON 文件。"""
        tool = CalculatorTool()
        self.store.save_version(
            component_name="calculator",
            version="v1.0",
            state={"enabled": True},
            metadata={"created_by": "test"},
            category="tool",
            component=tool,
        )

        version_file = os.path.join(
            self.tmpdir, "calculator", "v1.0.json"
        )
        assert os.path.exists(version_file)

        with open(version_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        assert data["version"] == "v1.0"
        assert data["state"] == {"enabled": True}
        assert data["category"] == "tool"

    def test_component_config_stored(self):
        """应存储 component_config 而非原始 component 对象。"""
        tool = CalculatorTool()
        self.store.save_version(
            component_name="calculator",
            version="v1.0",
            state={},
            metadata={},
            category="tool",
            component=tool,
        )

        version_file = os.path.join(
            self.tmpdir, "calculator", "v1.0.json"
        )
        with open(version_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        assert "component_config" in data
        config = data["component_config"]
        assert "module_path" in config
        assert "class_name" in config
        assert "init_params" in config
        assert config["class_name"] == "CalculatorTool"

    def test_get_version_reconstructs_component(self):
        """get_version 应能从 component_config 重建组件实例。"""
        tool = CalculatorTool()
        self.store.save_version(
            component_name="calculator",
            version="v1.0",
            state={},
            metadata={},
            category="tool",
            component=tool,
        )

        snapshot = self.store.get_version("calculator", "v1.0")
        assert snapshot is not None
        assert "component" in snapshot

        component = snapshot["component"]
        assert component is not None
        assert hasattr(component, "name")
        assert component.name() == "calculator"

    def test_save_version_with_none_component(self):
        """component 为 None 时也应正常工作。"""
        self.store.save_version(
            component_name="test",
            version="v1.0",
            state={},
            metadata={},
            category="tool",
            component=None,
        )

        snapshot = self.store.get_version("test", "v1.0")
        assert snapshot is not None
        assert snapshot["component_config"] is None

    def test_list_versions(self):
        """list_versions 应返回所有版本。"""
        tool = CalculatorTool()
        for v in ["v1.0", "v1.1", "v2.0"]:
            self.store.save_version(
                component_name="calculator",
                version=v,
                state={},
                metadata={},
                category="tool",
                component=tool,
            )

        versions = self.store.list_versions("calculator")
        assert len(versions) == 3
        assert "v1.0" in versions
        assert "v2.0" in versions

    def test_get_latest_version(self):
        """get_latest_version 应返回最新版本。"""
        tool = CalculatorTool()
        self.store.save_version(
            component_name="calculator",
            version="v1.0",
            state={},
            metadata={},
            category="tool",
            component=tool,
        )
        self.store.save_version(
            component_name="calculator",
            version="v2.0",
            state={},
            metadata={},
            category="tool",
            component=tool,
        )

        assert self.store.get_latest_version("calculator") == "v2.0"


class TestIsJsonSerializable:
    """_is_json_serializable 辅助函数测试。"""

    def test_primitives(self):
        assert _is_json_serializable(None) is True
        assert _is_json_serializable(True) is True
        assert _is_json_serializable(42) is True
        assert _is_json_serializable(3.14) is True
        assert _is_json_serializable("hello") is True

    def test_lists(self):
        assert _is_json_serializable([1, 2, 3]) is True
        assert _is_json_serializable(["a", "b"]) is True
        assert _is_json_serializable([]) is True

    def test_dicts(self):
        assert _is_json_serializable({"a": 1, "b": 2}) is True
        assert _is_json_serializable({}) is True

    def test_nested(self):
        assert _is_json_serializable({"a": [1, 2], "b": {"c": 3}}) is True

    def test_non_serializable(self):
        assert _is_json_serializable(object()) is False
        assert _is_json_serializable(lambda x: x) is False
        assert _is_json_serializable({1: "int_key"}) is False


# ======================================================================
# P0-2: ParameterTuneStrategy 全局污染测试
# ======================================================================

class TestParameterTuneStrategyNoGlobalPollution:
    """P0-2: ParameterTuneStrategy 不应修改全局配置。"""

    def setup_method(self):
        self.config = RuntimeConfig()
        self.collector = EvolutionSignalCollector(report_interval=1)
        self.strategy = ParameterTuneStrategy(
            config=self.config,
            feedback_collector=self.collector,
        )
        self.original_temp = self.config.get("llm.temperature")
        self.original_max_iter = self.config.get("llm.max_reasoning_iterations")

    def _make_low_accuracy_signals(self, count: int = 5) -> list[EvolutionSignal]:
        """创建低准确性信号，应触发 temperature 降低。"""
        return [
            EvolutionSignal(
                signal_type="reasoning.generate",
                source="test",
                timestamp=12345.0 + i,
                metrics={"accuracy": 0.3, "iterations": 5},
                context={"evaluation": {"accuracy": 0.3}},
                severity="medium",
            )
            for i in range(count)
        ]

    def test_returns_config_overrides(self):
        """analyze_and_adjust 应返回 config_overrides 字段。"""
        signals = self._make_low_accuracy_signals()
        result = self.strategy.analyze_and_adjust(signals, session_id="test-session")

        assert "adjusted" in result
        assert "config_overrides" in result
        assert "scope" in result
        assert "session_id" in result

    def test_session_id_preserved(self):
        """传入的 session_id 应在返回结果中保留。"""
        signals = self._make_low_accuracy_signals()
        result = self.strategy.analyze_and_adjust(signals, session_id="sess-123")
        assert result["session_id"] == "sess-123"

    def test_scope_is_session(self):
        """作用域应为 session。"""
        signals = self._make_low_accuracy_signals()
        result = self.strategy.analyze_and_adjust(signals, session_id="test")
        assert result["scope"] == "session"

    def test_global_config_not_modified(self):
        """核心测试：全局配置不应被修改。"""
        signals = self._make_low_accuracy_signals()
        self.strategy.analyze_and_adjust(signals, session_id="test")

        current_temp = self.config.get("llm.temperature")
        current_max_iter = self.config.get("llm.max_reasoning_iterations")

        assert current_temp == self.original_temp, (
            f"全局 temperature 被污染了! {self.original_temp} -> {current_temp}"
        )
        assert current_max_iter == self.original_max_iter, (
            f"全局 max_iterations 被污染了! {self.original_max_iter} -> {current_max_iter}"
        )

    def test_config_overrides_contains_adjusted_values(self):
        """config_overrides 应包含调整后的参数。"""
        signals = self._make_low_accuracy_signals()
        result = self.strategy.analyze_and_adjust(signals, session_id="test")

        if result["adjusted"]:
            overrides = result["config_overrides"]
            has_temp = "temperature" in overrides
            has_iter = "max_reasoning_iterations" in overrides
            assert has_temp or has_iter

    def test_empty_signals_no_adjustment(self):
        """空信号列表不应触发调整。"""
        result = self.strategy.analyze_and_adjust([], session_id="test")
        assert result["adjusted"] is False
        assert result["config_overrides"] == {}

    def test_high_accuracy_no_adjustment(self):
        """高准确性信号不应触发调整。"""
        signals = [
            EvolutionSignal(
                signal_type="reasoning.generate",
                source="test",
                timestamp=12345.0,
                metrics={"accuracy": 0.9, "iterations": 3},
                context={"evaluation": {"accuracy": 0.9}},
                severity="low",
            )
            for _ in range(5)
        ]
        result = self.strategy.analyze_and_adjust(signals, session_id="test")

        current_temp = self.config.get("llm.temperature")
        assert current_temp == self.original_temp


# ======================================================================
# P0-2: LangGraph state config_overrides 集成测试
# ======================================================================

class TestStateConfigOverrides:
    """P0-2: 验证 ModuAgentState 包含 config_overrides 字段。"""

    def test_state_has_config_overrides_field(self):
        """ModuAgentState 应包含 config_overrides 字段（静态检查）。"""
        import os
        state_file = os.path.join(
            os.path.dirname(__file__),
            "..",
            "..",
            "langgraph",
            "state.py",
        )
        with open(state_file, "r", encoding="utf-8") as f:
            content = f.read()

        assert "config_overrides" in content, (
            "state.py 中应包含 config_overrides 字段定义"
        )
        assert "config_overrides: Dict[str, Any]" in content, (
            "ModuAgentState 中应声明 config_overrides: Dict[str, Any]"
        )
        assert 'config_overrides={}' in content, (
            "make_initial_state 中应初始化 config_overrides 为 {}"
        )
