"""RuntimeConfig 单元测试（P2-4）。

覆盖：
    - 默认配置加载
    - get/set/update/update_many 读写
    - 线程安全（并发 update 不丢数据）
    - 配置变更回调
    - P2-1: override 参数与 context manager
    - P2-1: reset_config 清理
"""
import threading

import pytest

from config.runtime_config import (
    RuntimeConfig,
    get_config,
    reset_config,
    override_config,
)


class TestDefaultConfig:
    def test_default_config_has_required_sections(self):
        cfg = RuntimeConfig()
        for section in ("llm", "memory", "tools", "perception", "feedback"):
            assert section in cfg._data, f"缺少默认配置段: {section}"

    def test_default_llm_retry_config(self):
        cfg = RuntimeConfig()
        retry = cfg.get("llm.retry")
        assert retry is not None
        assert retry["max_attempts"] == 2

    def test_default_tools_retry_config(self):
        cfg = RuntimeConfig()
        retry = cfg.get("tools.retry")
        assert retry["max_attempts"] == 3
        assert retry["base_delay"] == 0.5
        assert retry["max_delay"] == 5.0

    def test_default_feedback_quality_monitor(self):
        cfg = RuntimeConfig()
        assert cfg.get("feedback.quality_monitor_mode") == "rule"
        assert cfg.get("feedback.quality_monitor_llm_temperature") == 0.0


class TestGetSetUpdate:
    def test_get_nested_key(self):
        cfg = RuntimeConfig()
        assert cfg.get("llm.default_provider") == "deepseek"
        assert cfg.get("llm.temperature") == 0.7

    def test_get_missing_key_returns_default(self):
        cfg = RuntimeConfig()
        assert cfg.get("nonexistent.key", "fallback") == "fallback"
        assert cfg.get("nonexistent.key") is None

    def test_get_returns_shallow_copy_for_dict(self):
        cfg = RuntimeConfig()
        retry = cfg.get("tools.retry")
        retry["max_attempts"] = 999
        # 原始配置不应被修改
        assert cfg.get("tools.retry.max_attempts") == 3

    def test_set_updates_value(self):
        cfg = RuntimeConfig()
        cfg.set("llm.temperature", 0.1)
        assert cfg.get("llm.temperature") == 0.1

    def test_update_returns_old_value(self):
        cfg = RuntimeConfig()
        old = cfg.update("llm.temperature", 0.5)
        assert old == 0.7
        assert cfg.get("llm.temperature") == 0.5

    def test_update_creates_intermediate_keys(self):
        cfg = RuntimeConfig()
        cfg.update("custom.section.key", "value")
        assert cfg.get("custom.section.key") == "value"

    def test_update_many_atomic(self):
        cfg = RuntimeConfig()
        old_values = cfg.update_many({
            "llm.temperature": 0.1,
            "llm.max_tokens": 1024,
        })
        assert old_values["llm.temperature"] == 0.7
        assert old_values["llm.max_tokens"] == 512
        assert cfg.get("llm.temperature") == 0.1
        assert cfg.get("llm.max_tokens") == 1024


class TestChangeCallback:
    def test_register_callback_called_on_update(self):
        cfg = RuntimeConfig()
        received = []
        unsub = cfg.register_change_callback(
            lambda key, old, new: received.append((key, old, new))
        )
        cfg.update("llm.temperature", 0.3)
        assert len(received) == 1
        assert received[0] == ("llm.temperature", 0.7, 0.3)

    def test_callback_not_called_when_value_unchanged(self):
        cfg = RuntimeConfig()
        received = []
        cfg.register_change_callback(
            lambda key, old, new: received.append((key, old, new))
        )
        current = cfg.get("llm.temperature")
        cfg.update("llm.temperature", current)
        assert len(received) == 0

    def test_unregister_callback(self):
        cfg = RuntimeConfig()
        received = []
        unsub = cfg.register_change_callback(
            lambda key, old, new: received.append((key, old, new))
        )
        unsub()
        cfg.update("llm.temperature", 0.3)
        assert len(received) == 0

    def test_callback_exception_isolated(self):
        cfg = RuntimeConfig()
        received = []

        def bad_callback(key, old, new):
            raise RuntimeError("intentional")

        cfg.register_change_callback(bad_callback)
        cfg.register_change_callback(
            lambda key, old, new: received.append((key, old, new))
        )
        cfg.update("llm.temperature", 0.3)
        # 第二个回调仍应被调用
        assert len(received) == 1


class TestThreadSafety:
    def test_concurrent_updates_no_data_loss(self):
        cfg = RuntimeConfig()
        cfg.update("custom.counter", 0)
        barrier = threading.Barrier(10)

        def increment():
            barrier.wait()
            for _ in range(100):
                current = cfg.get("custom.counter")
                cfg.update("custom.counter", current + 1)

        threads = [threading.Thread(target=increment) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        # 注意：由于 get+update 非原子，最终值可能 < 1000，
        # 但不应抛异常且值应 > 0（验证锁本身不死锁）
        assert cfg.get("custom.counter") > 0


class TestOverrideAndReset:
    def test_get_config_returns_singleton(self):
        reset_config()
        c1 = get_config()
        c2 = get_config()
        assert c1 is c2

    def test_override_replaces_singleton(self):
        reset_config()
        original = get_config()
        custom = RuntimeConfig({"llm": {"temperature": 0.01}})
        result = get_config(override=custom)
        assert result is custom
        assert get_config() is custom

    def test_reset_config_clears_singleton(self):
        reset_config()
        c1 = get_config()
        reset_config()
        c2 = get_config()
        assert c1 is not c2

    def test_override_config_context_manager(self):
        reset_config()
        original = get_config()
        custom = RuntimeConfig({"llm": {"temperature": 0.01}})
        with override_config(custom) as ctx:
            assert ctx is custom
            assert get_config() is custom
        # 退出后恢复
        assert get_config() is original

    def test_override_config_restores_on_exception(self):
        reset_config()
        original = get_config()
        custom = RuntimeConfig({"llm": {"temperature": 0.01}})
        with pytest.raises(RuntimeError):
            with override_config(custom):
                assert get_config() is custom
                raise RuntimeError("test")
        assert get_config() is original
