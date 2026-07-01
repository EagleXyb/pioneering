"""功能测试：config 模块（RuntimeConfig + Schemas）。"""

from __future__ import annotations

import copy
import json
import os
import tempfile
from pathlib import Path

import pytest

from config.runtime_config import (
    RuntimeConfig,
    _DEFAULT_CONFIG,
    get_config,
    override_config,
    reset_config,
)
from config.schemas import (
    PerceptionInputSchema,
    PerceptionOutputSchema,
    MemoryQuerySchema,
    MemoryUpdateSchema,
    ToolCallSchema,
    ToolResultSchema,
    LLMCallSchema,
    LLMResultSchema,
    FeedbackSignalSchema,
)


# ======================================================================
# RuntimeConfig 功能测试
# ======================================================================

class TestRuntimeConfigInit:
    """RuntimeConfig 初始化测试。"""

    def test_default_init_uses_deep_copy(self):
        """验证默认初始化使用深拷贝，不污染 _DEFAULT_CONFIG。"""
        cfg = RuntimeConfig()
        original_llm_temp = _DEFAULT_CONFIG["llm"]["temperature"]
        cfg.set("llm.temperature", 0.0)
        assert _DEFAULT_CONFIG["llm"]["temperature"] == original_llm_temp
        assert cfg.get("llm.temperature") == 0.0

    def test_init_with_override_data(self):
        """验证传入自定义配置覆盖默认值。"""
        overrides = {"llm": {"temperature": 0.3, "max_tokens": 1024}}
        cfg = RuntimeConfig(config_data=overrides)
        assert cfg.get("llm.temperature") == 0.3
        assert cfg.get("llm.max_tokens") == 1024
        # 未覆盖的保持默认
        assert cfg.get("memory.default_strategy") == "cache"

    def test_init_shallow_merge_nested(self):
        """验证嵌套字典合并而非替换。"""
        overrides = {"llm": {"temperature": 0.1}}
        cfg = RuntimeConfig(config_data=overrides)
        assert cfg.get("llm.temperature") == 0.1
        # 其他 llm 子字段应保持默认
        assert cfg.get("llm.default_provider") == "deepseek"


class TestRuntimeConfigFromFile:
    """RuntimeConfig.from_file 测试。"""

    def test_from_file_valid_json(self):
        """从有效 JSON 文件加载配置。"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump({"llm": {"temperature": 0.5}, "memory": {"default_strategy": "chroma"}}, f)
            path = f.name
        try:
            cfg = RuntimeConfig.from_file(path)
            assert cfg.get("llm.temperature") == 0.5
            assert cfg.get("memory.default_strategy") == "chroma"
        finally:
            os.unlink(path)

    def test_from_file_not_found(self):
        """配置文件不存在时应使用默认配置。"""
        cfg = RuntimeConfig.from_file("/nonexistent/path.json")
        assert cfg.get("llm.temperature") == 0.7  # 默认值

    def test_from_file_invalid_json(self):
        """无效 JSON 文件应抛出异常。"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as f:
            f.write("{ invalid json ")
            path = f.name
        try:
            with pytest.raises(json.JSONDecodeError):
                RuntimeConfig.from_file(path)
        finally:
            os.unlink(path)


class TestRuntimeConfigFromEnv:
    """RuntimeConfig.from_env 测试。"""

    def test_from_env_with_vars(self, monkeypatch):
        """从环境变量读取配置。"""
        monkeypatch.setenv("MODU_LLM_PROVIDER", "gpt")
        monkeypatch.setenv("MODU_LLM_TEMPERATURE", "0.9")
        monkeypatch.setenv("MODU_MEMORY_STRATEGY", "chroma")
        cfg = RuntimeConfig.from_env()
        assert cfg.get("llm.default_provider") == "gpt"
        assert cfg.get("llm.temperature") == 0.9
        assert cfg.get("memory.default_strategy") == "chroma"

    def test_from_env_no_vars(self, monkeypatch):
        """无环境变量时使用默认配置。"""
        monkeypatch.delenv("MODU_LLM_PROVIDER", raising=False)
        monkeypatch.delenv("MODU_LLM_TEMPERATURE", raising=False)
        monkeypatch.delenv("MODU_MEMORY_STRATEGY", raising=False)
        cfg = RuntimeConfig.from_env()
        assert cfg.get("llm.default_provider") == "deepseek"


class TestRuntimeConfigGetSet:
    """RuntimeConfig.get / set / update 测试。"""

    def test_get_existing_key(self):
        cfg = RuntimeConfig()
        assert cfg.get("llm.temperature") == 0.7

    def test_get_nonexistent_key_returns_default(self):
        cfg = RuntimeConfig()
        assert cfg.get("nonexistent.key", 42) == 42

    def test_get_nonexistent_no_default(self):
        cfg = RuntimeConfig()
        assert cfg.get("nonexistent.key") is None

    def test_set_existing_key(self):
        cfg = RuntimeConfig()
        cfg.set("llm.temperature", 0.1)
        assert cfg.get("llm.temperature") == 0.1

    def test_set_nested_key_creates_intermediate(self):
        cfg = RuntimeConfig()
        cfg.set("new_section.new_key", "new_value")
        assert cfg.get("new_section.new_key") == "new_value"

    def test_update_returns_old_value(self):
        cfg = RuntimeConfig()
        old = cfg.update("llm.temperature", 0.2)
        assert old == 0.7
        assert cfg.get("llm.temperature") == 0.2

    def test_update_many_atomic(self):
        cfg = RuntimeConfig()
        updates = {"llm.temperature": 0.3, "llm.max_tokens": 1024}
        old_values = cfg.update_many(updates)
        assert old_values["llm.temperature"] == 0.7
        assert old_values["llm.max_tokens"] == 512
        assert cfg.get("llm.temperature") == 0.3
        assert cfg.get("llm.max_tokens") == 1024

    def test_as_dict_returns_deep_copy(self):
        cfg = RuntimeConfig()
        d = cfg.as_dict()
        d["llm"]["temperature"] = 999
        assert cfg.get("llm.temperature") == 0.7  # 不受外部修改影响

    def test_get_dict_returns_shallow_copy(self):
        """get 对 dict 类型返回浅拷贝。"""
        cfg = RuntimeConfig()
        llm = cfg.get("llm")
        llm["temperature"] = 999
        # 内部状态不受影响（因为返回的是浅拷贝）
        assert cfg.get("llm.temperature") == 0.7


class TestRuntimeConfigCallbacks:
    """配置变更回调测试。"""

    def test_register_and_fire_callback(self):
        cfg = RuntimeConfig()
        received = []

        def cb(key, old, new):
            received.append((key, old, new))

        unregister = cfg.register_change_callback(cb)
        cfg.update("llm.temperature", 0.0)
        assert len(received) == 1
        assert received[0] == ("llm.temperature", 0.7, 0.0)
        unregister()

    def test_callback_no_value_change_no_fire(self):
        cfg = RuntimeConfig()
        received = []

        def cb(key, old, new):
            received.append((key, old, new))

        cfg.register_change_callback(cb)
        cfg.update("llm.temperature", 0.7)  # 值未变
        assert len(received) == 0

    def test_callback_exception_does_not_block_others(self):
        cfg = RuntimeConfig()
        received = []

        def bad_cb(key, old, new):
            raise RuntimeError("fail")

        def good_cb(key, old, new):
            received.append(key)

        cfg.register_change_callback(bad_cb)
        cfg.register_change_callback(good_cb)
        cfg.update("llm.temperature", 0.0)
        assert received == ["llm.temperature"]

    def test_unregister_callback(self):
        cfg = RuntimeConfig()
        received = []

        def cb(key, old, new):
            received.append(key)

        unreg = cfg.register_change_callback(cb)
        unreg()
        cfg.update("llm.temperature", 0.0)
        assert len(received) == 0


class TestRuntimeConfigGlobal:
    """全局 config 单例管理测试。"""

    def test_get_config_creates_singleton(self):
        reset_config()
        cfg1 = get_config()
        cfg2 = get_config()
        assert cfg1 is cfg2

    def test_get_config_with_override(self):
        reset_config()
        cfg = RuntimeConfig()
        result = get_config(override=cfg)
        assert result is cfg

    def test_override_config_contextmanager(self):
        reset_config()
        old_cfg = get_config()
        new_cfg = RuntimeConfig(config_data={"llm": {"temperature": 0.1}})
        with override_config(new_cfg) as current:
            assert current is new_cfg
            assert get_config() is new_cfg
        assert get_config() is old_cfg

    def test_override_config_restore_on_exception(self):
        reset_config()
        old_cfg = get_config()
        new_cfg = RuntimeConfig()
        try:
            with override_config(new_cfg):
                raise ValueError("test")
        except ValueError:
            pass
        assert get_config() is old_cfg


# ======================================================================
# Schemas 功能测试
# ======================================================================

class TestPerceptionInputSchema:
    def test_valid_default(self):
        s = PerceptionInputSchema()
        assert s.input_type == "text"
        assert s.raw_content == b""
        assert s.sensitivity_level == 0

    def test_valid_text_input(self):
        s = PerceptionInputSchema(input_type="text", raw_content=b"hello", sensitivity_level=3)
        assert s.input_type == "text"
        assert s.raw_content == b"hello"
        assert s.sensitivity_level == 3

    def test_invalid_input_type(self):
        with pytest.raises(ValueError, match="Invalid input_type"):
            PerceptionInputSchema(input_type="video")

    def test_invalid_sensitivity_level_too_high(self):
        with pytest.raises(ValueError, match="sensitivity_level"):
            PerceptionInputSchema(sensitivity_level=6)

    def test_invalid_sensitivity_level_negative(self):
        with pytest.raises(ValueError, match="sensitivity_level"):
            PerceptionInputSchema(sensitivity_level=-1)

    def test_to_dict_and_from_dict_roundtrip(self):
        s = PerceptionInputSchema(
            input_type="audio", raw_content=b"test", language="zh", sensitivity_level=2
        )
        d = s.to_dict()
        restored = PerceptionInputSchema.from_dict(d)
        assert restored.input_type == "audio"
        assert restored.raw_content == b"test"
        assert restored.language == "zh"
        assert restored.sensitivity_level == 2


class TestPerceptionOutputSchema:
    def test_default_fields(self):
        s = PerceptionOutputSchema()
        assert s.parsed_content == {}
        assert s.confidence == 0.0
        assert s.security_score == 1.0
        assert s.entities == []

    def test_full_construction(self):
        s = PerceptionOutputSchema(
            parsed_content={"text": "hello"},
            detected_language="en",
            confidence=0.95,
            sentiment={"positive": 0.8, "negative": 0.1},
            security_score=0.75,
        )
        assert s.detected_language == "en"
        assert s.confidence == 0.95
        assert s.sentiment["positive"] == 0.8
        assert s.security_score == 0.75

    def test_to_dict_roundtrip(self):
        s = PerceptionOutputSchema(
            parsed_content={"key": "val"},
            detected_language="zh",
            confidence=0.88,
            intent={"query": 0.9},
        )
        d = s.to_dict()
        assert d["confidence"] == 0.88
        assert d["intent"] == {"query": 0.9}


class TestMemoryQuerySchema:
    def test_valid(self):
        s = MemoryQuerySchema(user_id="u1", context_window="last_5_turns", required_fields=["prompt"])
        assert s.user_id == "u1"
        assert s.enable_compression is False

    def test_empty_user_id_raises(self):
        with pytest.raises(ValueError, match="user_id"):
            MemoryQuerySchema(user_id="")

    def test_empty_context_window_raises(self):
        with pytest.raises(ValueError, match="context_window"):
            MemoryQuerySchema(user_id="u1", context_window="")

    def test_empty_required_fields_raises(self):
        with pytest.raises(ValueError, match="required_fields"):
            MemoryQuerySchema(user_id="u1", required_fields=[])

    def test_to_dict_from_dict_roundtrip(self):
        s = MemoryQuerySchema(
            user_id="u1", context_window="last_10_turns",
            required_fields=["prompt", "response"], enable_compression=True
        )
        d = s.to_dict()
        restored = MemoryQuerySchema.from_dict(d)
        assert restored.user_id == "u1"
        assert restored.context_window == "last_10_turns"
        assert restored.enable_compression is True


class TestMemoryUpdateSchema:
    def test_valid(self):
        s = MemoryUpdateSchema(
            user_id="u1", new_data={"prompt": "hello"},
            metadata={"session_id": "s1"}, mode="incremental"
        )
        assert s.user_id == "u1"
        assert s.mode == "incremental"

    def test_empty_user_id_raises(self):
        with pytest.raises(ValueError, match="user_id"):
            MemoryUpdateSchema(user_id="")

    def test_invalid_mode_raises(self):
        with pytest.raises(ValueError, match="Invalid mode"):
            MemoryUpdateSchema(user_id="u1", mode="delete")


class TestToolCallSchema:
    def test_valid(self):
        s = ToolCallSchema(tool_name="calculator", parameters={"expression": "1+1"})
        assert s.tool_name == "calculator"
        assert s.timeout_ms == 1800000

    def test_empty_tool_name_raises(self):
        with pytest.raises(ValueError, match="tool_name"):
            ToolCallSchema(tool_name="")

    def test_to_dict(self):
        s = ToolCallSchema(
            tool_name="search_engine",
            parameters={"query": "weather"},
            timeout_ms=5000,
            required_fields=["results"],
        )
        d = s.to_dict()
        assert d["tool_name"] == "search_engine"
        assert d["timeout_ms"] == 5000


class TestToolResultSchema:
    def test_success(self):
        s = ToolResultSchema(status="success", data={"result": 42})
        assert s.is_success() is True

    def test_error(self):
        s = ToolResultSchema(status="error", error_code="TOOL_001")
        assert s.is_success() is False

    def test_to_dict(self):
        s = ToolResultSchema(status="success", error_code="", data={"r": 1})
        d = s.to_dict()
        assert d["status"] == "success"


class TestLLMCallSchema:
    def test_valid(self):
        s = LLMCallSchema(prompt="hello", temperature=1.0, max_tokens=256)
        assert s.prompt == "hello"
        assert s.temperature == 1.0

    def test_empty_prompt_raises(self):
        with pytest.raises(ValueError, match="prompt"):
            LLMCallSchema(prompt="")

    def test_invalid_temperature_too_high(self):
        with pytest.raises(ValueError, match="temperature"):
            LLMCallSchema(prompt="test", temperature=3.0)

    def test_invalid_temperature_negative(self):
        with pytest.raises(ValueError, match="temperature"):
            LLMCallSchema(prompt="test", temperature=-0.1)

    def test_invalid_max_tokens_zero(self):
        with pytest.raises(ValueError, match="max_tokens"):
            LLMCallSchema(prompt="test", max_tokens=0)

    def test_invalid_max_tokens_negative(self):
        with pytest.raises(ValueError, match="max_tokens"):
            LLMCallSchema(prompt="test", max_tokens=-1)

    def test_temperature_boundaries(self):
        """验证 temperature 边界值 0.0 和 2.0 可接受。"""
        LLMCallSchema(prompt="test", temperature=0.0)
        LLMCallSchema(prompt="test", temperature=2.0)


class TestLLMResultSchema:
    def test_default(self):
        s = LLMResultSchema()
        assert s.content == ""
        assert s.tokens_used == 0

    def test_full(self):
        s = LLMResultSchema(content="hello", model="gpt-4", tokens_used=100, finish_reason="stop")
        assert s.model == "gpt-4"


class TestFeedbackSignalSchema:
    def test_default(self):
        s = FeedbackSignalSchema()
        assert s.triggered is False
        assert s.value == 0.0

    def test_triggered(self):
        s = FeedbackSignalSchema(
            source="accuracy", metric_name="success_rate",
            value=0.3, threshold=0.6, triggered=True
        )
        assert s.triggered is True
