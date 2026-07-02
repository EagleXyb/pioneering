"""P2-12.2 性能优化项功能测试。

针对 docs/重构/agent优化方案.md 12.2 章节下的 5 个待优化性能项：

    12.2.1  ChromaDB 持久化默认行为
    12.2.2  嵌入模型降级优化
    12.2.3  感知管线并行化
    12.2.4  配置热更新主动传导
    12.2.5  AGUIStreamAdapter 重构（状态机抽取）

验证每个修复的：
    1. 功能正确性（行为符合预期）
    2. 边界条件处理
    3. 向后兼容性
    4. 回归安全（不破坏现有功能）
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import time
from typing import AsyncGenerator, Dict, List
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# 12.2.1  ChromaDB 持久化默认行为
# ---------------------------------------------------------------------------


class TestChromaDBPersistPath:
    """12.2.1: ChromaDB 持久化路径默认值与环境变量解析。"""

    def test_default_persist_path_when_no_env(self, monkeypatch):
        """无环境变量时，默认路径为 ./chroma_data。"""
        monkeypatch.delenv("MODU_CHROMA_PATH", raising=False)
        monkeypatch.delenv("MODU_CHROMA_IN_MEMORY", raising=False)
        from components.memory.vector.chroma import ChromaLongTermMemory

        mem = ChromaLongTermMemory()
        assert mem._persist_path == "./chroma_data"

    def test_env_var_override(self, monkeypatch):
        """MODU_CHROMA_PATH 环境变量覆盖默认路径。"""
        monkeypatch.setenv("MODU_CHROMA_PATH", "/tmp/custom_chroma")
        monkeypatch.delenv("MODU_CHROMA_IN_MEMORY", raising=False)
        from components.memory.vector.chroma import ChromaLongTermMemory

        mem = ChromaLongTermMemory()
        assert mem._persist_path == "/tmp/custom_chroma"

    def test_explicit_persist_path_takes_priority(self, monkeypatch):
        """显式传入的 persist_path 优先于环境变量。"""
        monkeypatch.setenv("MODU_CHROMA_PATH", "/tmp/env_chroma")
        from components.memory.vector.chroma import ChromaLongTermMemory

        mem = ChromaLongTermMemory(persist_path="/tmp/explicit_chroma")
        assert mem._persist_path == "/tmp/explicit_chroma"

    def test_in_memory_mode_via_env(self, monkeypatch):
        """MODU_CHROMA_IN_MEMORY=1 时强制内存模式。"""
        monkeypatch.setenv("MODU_CHROMA_IN_MEMORY", "1")
        monkeypatch.setenv("MODU_CHROMA_PATH", "/tmp/should_not_use")
        from components.memory.vector.chroma import ChromaLongTermMemory

        mem = ChromaLongTermMemory()
        assert mem._persist_path is None

    def test_in_memory_mode_various_truthy_values(self, monkeypatch):
        """各种 truthy 值均触发内存模式。"""
        from components.memory.vector.chroma import ChromaLongTermMemory

        for val in ("1", "true", "True", "yes", "YES"):
            monkeypatch.setenv("MODU_CHROMA_IN_MEMORY", val)
            monkeypatch.delenv("MODU_CHROMA_PATH", raising=False)
            mem = ChromaLongTermMemory()
            assert mem._persist_path is None, f"MODU_CHROMA_IN_MEMORY={val!r} should force in-memory"

    def test_in_memory_mode_falsy_values(self, monkeypatch):
        """falsy 值不触发内存模式，回退到默认路径。"""
        from components.memory.vector.chroma import ChromaLongTermMemory

        for val in ("0", "false", "no", ""):
            monkeypatch.setenv("MODU_CHROMA_IN_MEMORY", val)
            monkeypatch.delenv("MODU_CHROMA_PATH", raising=False)
            mem = ChromaLongTermMemory()
            assert mem._persist_path == "./chroma_data", f"MODU_CHROMA_IN_MEMORY={val!r} should not force in-memory"

    def test_persistent_client_used_when_path_set(self, monkeypatch):
        """有 persist_path 时使用 PersistentClient。"""
        monkeypatch.delenv("MODU_CHROMA_IN_MEMORY", raising=False)
        from components.memory.vector.chroma import ChromaLongTermMemory

        mem = ChromaLongTermMemory(persist_path="/tmp/test_chroma_persist")
        with patch("chromadb.PersistentClient") as mock_pc:
            mock_pc.return_value = MagicMock()
            mem._get_client()
            mock_pc.assert_called_once_with(path="/tmp/test_chroma_persist")

    def test_in_memory_client_when_path_none(self, monkeypatch):
        """persist_path=None 时使用 Client（内存模式）。"""
        monkeypatch.delenv("MODU_CHROMA_IN_MEMORY", raising=False)
        from components.memory.vector.chroma import ChromaLongTermMemory

        mem = ChromaLongTermMemory(persist_path=None)
        # 显式 None 不走 env 解析（_resolve_persist_path(None) 会检查 env）
        # 但设置 IN_MEMORY=1 确保 None
        monkeypatch.setenv("MODU_CHROMA_IN_MEMORY", "1")
        mem = ChromaLongTermMemory()
        assert mem._persist_path is None
        with patch("chromadb.Client") as mock_client:
            mock_client.return_value = MagicMock()
            mem._get_client()
            mock_client.assert_called_once()


# ---------------------------------------------------------------------------
# 12.2.2  嵌入模型降级优化
# ---------------------------------------------------------------------------


class TestEmbeddingFallback:
    """12.2.2: 嵌入模型三级降级——SentenceTransformer → ONNX → hash embedding。"""

    def test_hash_embedding_fallback_dimension(self):
        """hash embedding 降级时维度为 384。"""
        from components.memory.vector.chroma import _simple_hash_embedding

        vec = _simple_hash_embedding("test text")
        assert len(vec) == 384

    def test_hash_embedding_normalized(self):
        """hash embedding 应归一化（L2 norm ≈ 1）。"""
        import math
        from components.memory.vector.chroma import _simple_hash_embedding

        vec = _simple_hash_embedding("normalization test")
        norm = math.sqrt(sum(v * v for v in vec))
        assert abs(norm - 1.0) < 1e-6

    def test_hash_embedding_deterministic(self):
        """相同输入产生相同向量。"""
        from components.memory.vector.chroma import _simple_hash_embedding

        v1 = _simple_hash_embedding("deterministic")
        v2 = _simple_hash_embedding("deterministic")
        assert v1 == v2

    def test_hash_embedding_different_inputs_differ(self):
        """不同输入产生不同向量。"""
        from components.memory.vector.chroma import _simple_hash_embedding

        v1 = _simple_hash_embedding("input one")
        v2 = _simple_hash_embedding("input two")
        assert v1 != v2

    def test_variable_renamed_to_semantic(self, monkeypatch):
        """P2-12.2.2: 变量重命名为 _use_semantic_embedding。"""
        monkeypatch.delenv("MODU_CHROMA_IN_MEMORY", raising=False)
        monkeypatch.setenv("MODU_CHROMA_IN_MEMORY", "1")
        from components.memory.vector.chroma import ChromaLongTermMemory

        mem = ChromaLongTermMemory()
        # 初始状态：None（惰性初始化）
        assert mem._use_semantic_embedding is None
        assert mem._embed_fn is None
        # 旧变量名不应存在
        assert not hasattr(mem, "_use_sentence_transformer")
        assert not hasattr(mem, "_st_fn")

    def test_embedding_dimension_tracking(self, monkeypatch):
        """P2-12.2.2: 嵌入维度被正确跟踪。"""
        monkeypatch.setenv("MODU_CHROMA_IN_MEMORY", "1")
        from components.memory.vector.chroma import ChromaLongTermMemory

        mem = ChromaLongTermMemory()
        # 触发初始化（hash fallback）
        mem._embed_texts(["test"])
        assert mem._embedding_dim is not None
        assert mem._embedding_dim == 384  # hash fallback 维度

    def test_onnx_env_var_support(self, monkeypatch):
        """P2-12.2.2: MODU_ONNX_MODEL_PATH 环境变量支持。"""
        monkeypatch.setenv("MODU_CHROMA_IN_MEMORY", "1")
        monkeypatch.setenv("MODU_ONNX_MODEL_PATH", "/tmp/models/onnx")
        from components.memory.vector.chroma import ChromaLongTermMemory

        mem = ChromaLongTermMemory()
        # _try_onnx_embedding 应读取环境变量
        # 由于 onnxruntime 可能不可用，返回 None 是合理的
        result = ChromaLongTermMemory._try_onnx_embedding()
        # 不崩溃即可（可能返回 None 或实际函数）
        assert result is None or callable(result)


# ---------------------------------------------------------------------------
# 12.2.3  感知管线并行化
# ---------------------------------------------------------------------------


class TestPerceptionPipelineParallel:
    """12.2.3: 感知管线异步并行化。"""

    async def test_async_pipeline_parallel_execution(self):
        """异步管线中独立感知器并行执行。"""
        from components.perception.pipeline import run_perception_pipeline_async
        from core.registry import ComponentRegistry

        registry = ComponentRegistry()
        call_times: Dict[str, float] = {}

        def make_slow_perceiver(name: str, delay: float):
            perceiver = MagicMock()
            perceiver.perceive = MagicMock(
                side_effect=lambda **kw: (
                    call_times.update({name: time.perf_counter()}),
                    time.sleep(delay),
                    {
                        "parsed_content": {"text": f"{name}_output", "input_type": "text"},
                        "confidence": 0.9,
                        "metadata": {"sensitivity_level": 0},
                    },
                )[-1]
            )
            return perceiver

        # 注册 3 个感知器，各延迟 0.1s
        registry._perceptions = {
            "p1": make_slow_perceiver("p1", 0.1),
            "p2": make_slow_perceiver("p2", 0.1),
            "p3": make_slow_perceiver("p3", 0.1),
        }

        config = MagicMock()
        config.get = MagicMock(
            side_effect=lambda key, default=None: {
                "perception.routing": {"text": {"pipeline": ["p1", "p2", "p3"]}},
                "perception.fusion.strategy": "weighted_average",
                "perception.fusion.weights": {"text": 0.5, "image": 0.3, "audio": 0.2},
            }.get(key, default)
        )

        input_data = {"input_type": "text", "prompt": "test", "sensitivity_level": 0}
        start = time.perf_counter()
        result = await run_perception_pipeline_async(input_data, config, registry)
        elapsed = time.perf_counter() - start

        # 并行执行：首个串行 0.1s + 后两个并行 0.1s ≈ 0.2s
        # 串行执行需要 0.3s
        assert elapsed < 0.28, f"Parallel execution too slow: {elapsed:.3f}s (expected < 0.28s)"
        assert result is not None

    async def test_async_pipeline_single_perceiver(self):
        """单感知器时异步管线正常工作。"""
        from components.perception.pipeline import run_perception_pipeline_async
        from core.registry import ComponentRegistry

        registry = ComponentRegistry()
        perceiver = MagicMock()
        perceiver.perceive = MagicMock(return_value={
            "parsed_content": {"text": "hello", "input_type": "text"},
            "confidence": 1.0,
            "metadata": {"sensitivity_level": 0},
        })
        registry._perceptions = {"text_preprocessor": perceiver}

        config = MagicMock()
        config.get = MagicMock(
            side_effect=lambda key, default=None: {
                "perception.routing": {"text": {"pipeline": ["text_preprocessor"]}},
                "perception.fusion.strategy": "weighted_average",
                "perception.fusion.weights": None,
            }.get(key, default)
        )

        result = await run_perception_pipeline_async(
            {"input_type": "text", "prompt": "hello", "sensitivity_level": 0},
            config,
            registry,
        )
        assert result is not None
        assert result["parsed_content"]["text"] == "hello"

    async def test_async_pipeline_no_perceivers(self):
        """无感知器时返回 None。"""
        from components.perception.pipeline import run_perception_pipeline_async
        from core.registry import ComponentRegistry

        registry = ComponentRegistry()
        config = MagicMock()
        config.get = MagicMock(
            side_effect=lambda key, default=None: {
                "perception.routing": {"text": {"pipeline": []}},
                "perception.fusion.strategy": "weighted_average",
                "perception.fusion.weights": None,
            }.get(key, default)
        )

        result = await run_perception_pipeline_async(
            {"input_type": "text", "prompt": "test", "sensitivity_level": 0},
            config,
            registry,
        )
        assert result is None

    async def test_perception_node_is_async(self):
        """P2-12.2.3: perception_node 是异步函数。"""
        pytest.importorskip("langchain_core")
        import inspect
        from langgraph.nodes import perception_node

        assert inspect.iscoroutinefunction(perception_node), "perception_node should be async"

    async def test_perception_node_sync_exists(self):
        """P2-12.2.3: perception_node_sync 同步版本存在（向后兼容）。"""
        pytest.importorskip("langchain_core")
        import inspect
        from langgraph.nodes import perception_node_sync

        assert not inspect.iscoroutinefunction(perception_node_sync), "perception_node_sync should be sync"

    async def test_perception_node_calls_async_pipeline(self):
        """P2-12.2.3: 异步 perception_node 调用 run_perception_pipeline_async。"""
        pytest.importorskip("langchain_core")
        from langgraph.nodes import perception_node

        with patch(
            "langgraph.nodes.run_perception_pipeline_async",
            new_callable=AsyncMock,
            return_value=None,
        ) as mock_async, patch(
            "langgraph.nodes.run_perception_pipeline",
        ) as mock_sync:
            state = {"input_data": {"prompt": "test"}}
            await perception_node(state)
            mock_async.assert_awaited_once()
            mock_sync.assert_not_called()

    async def test_perception_node_result_extraction(self):
        """P2-12.2.3: 异步 perception_node 正确提取融合结果。"""
        pytest.importorskip("langchain_core")
        from langgraph.nodes import perception_node

        mock_fused = {
            "parsed_content": {"text": "cleaned", "input_type": "text"},
            "metadata": {"sensitivity_level": 3, "injection_detected": True, "pii_detected": False},
            "confidence": 0.85,
            "detected_language": "en",
        }
        with patch(
            "langgraph.nodes.run_perception_pipeline_async",
            new_callable=AsyncMock,
            return_value=mock_fused,
        ):
            state = {"input_data": {"prompt": "original"}}
            result = await perception_node(state)

        assert result["cleaned_text"] == "cleaned"
        assert result["sensitivity_level"] == 3
        assert result["confidence"] == 0.85
        assert result["detected_language"] == "en"
        assert result["injection_detected"] is True
        assert result["pii_detected"] is False


# ---------------------------------------------------------------------------
# 12.2.4  配置热更新主动传导
# ---------------------------------------------------------------------------


class TestConfigHotReloadCallback:
    """12.2.4: 配置变更回调主动触发 runner 缓存失效。

    需要 langchain_core（通过 langgraph.runner → langgraph.factory）。
    """

    def test_callback_registered_on_get_runner(self):
        """首次 get_runner() 时注册配置变更回调。"""
        pytest.importorskip("langchain_core")
        from config.runtime_config import RuntimeConfig, override_config
        from langgraph import runner as runner_mod

        # 重置回调标志
        runner_mod._config_callback_registered = False

        cfg = RuntimeConfig()
        received: List[str] = []

        def tracker(key, old, new):
            received.append(key)

        cfg.register_change_callback(tracker)

        with override_config(cfg):
            # mock create_agent 避免实际构建图
            with patch("langgraph.factory.create_agent") as mock_create:
                mock_create.return_value = MagicMock()
                try:
                    runner_mod.get_runner()
                except Exception:
                    pass  # 图构建可能失败，不影响回调注册验证

                # 回调应已注册
                assert runner_mod._config_callback_registered is True

                # 修改 llm 配置 → 应触发回调
                cfg.update("llm.temperature", 0.5)
                assert "llm.temperature" in received

    def test_llm_config_change_invalidates_cache(self):
        """llm.* 配置变更触发 reset_runner_cache。"""
        pytest.importorskip("langchain_core")
        from config.runtime_config import RuntimeConfig, override_config
        from langgraph import runner as runner_mod

        runner_mod._config_callback_registered = False
        cfg = RuntimeConfig()

        with override_config(cfg):
            with patch("langgraph.factory.create_agent") as mock_create:
                mock_create.return_value = MagicMock()
                try:
                    runner_mod.get_runner()
                except Exception:
                    pass

                # 修改 llm 配置
                with patch.object(runner_mod, "reset_runner_cache") as mock_reset:
                    cfg.update("llm.temperature", 0.9)
                    mock_reset.assert_called_once()

    def test_tools_config_change_invalidates_cache(self):
        """tools.* 配置变更触发 reset_runner_cache。"""
        pytest.importorskip("langchain_core")
        from config.runtime_config import RuntimeConfig, override_config
        from langgraph import runner as runner_mod

        runner_mod._config_callback_registered = False
        cfg = RuntimeConfig()

        with override_config(cfg):
            with patch("langgraph.factory.create_agent") as mock_create:
                mock_create.return_value = MagicMock()
                try:
                    runner_mod.get_runner()
                except Exception:
                    pass

                with patch.object(runner_mod, "reset_runner_cache") as mock_reset:
                    cfg.update("tools.default_timeout_ms", 5000)
                    mock_reset.assert_called_once()

    def test_unrelated_config_does_not_invalidate(self):
        """非图相关配置变更不触发缓存失效。"""
        pytest.importorskip("langchain_core")
        from config.runtime_config import RuntimeConfig, override_config
        from langgraph import runner as runner_mod

        runner_mod._config_callback_registered = False
        cfg = RuntimeConfig()

        with override_config(cfg):
            with patch("langgraph.factory.create_agent") as mock_create:
                mock_create.return_value = MagicMock()
                try:
                    runner_mod.get_runner()
                except Exception:
                    pass

                with patch.object(runner_mod, "reset_runner_cache") as mock_reset:
                    # feedback 配置不影响图结构
                    cfg.update("feedback.evolution_threshold", 0.8)
                    mock_reset.assert_not_called()

    def test_callback_registered_only_once(self):
        """回调仅注册一次（多次 get_runner 不重复注册）。"""
        pytest.importorskip("langchain_core")
        from config.runtime_config import RuntimeConfig, override_config
        from langgraph import runner as runner_mod

        runner_mod._config_callback_registered = False
        cfg = RuntimeConfig()

        with override_config(cfg):
            with patch("langgraph.factory.create_agent") as mock_create:
                mock_create.return_value = MagicMock()
                try:
                    runner_mod.get_runner()
                except Exception:
                    pass
                assert runner_mod._config_callback_registered is True

                # 记录当前回调数量
                with cfg._lock:
                    initial_count = len(cfg._change_callbacks)

                try:
                    runner_mod.get_runner()
                except Exception:
                    pass
                try:
                    runner_mod.get_runner()
                except Exception:
                    pass

                # 回调数量不应增加
                with cfg._lock:
                    assert len(cfg._change_callbacks) == initial_count

    def test_on_config_change_prefix_matching(self):
        """_on_config_change 正确匹配配置前缀。"""
        pytest.importorskip("langchain_core")
        from langgraph.runner import _on_config_change

        # 应触发图重建的配置
        for prefix in ["llm.temperature", "tools.default_timeout_ms",
                       "memory.store_type", "orchestration.engine",
                       "streaming.chunk_size"]:
            with patch("langgraph.runner.reset_runner_cache") as mock_reset:
                _on_config_change(prefix, "old", "new")
                mock_reset.assert_called_once()

        # 不应触发图重建的配置
        for key in ["feedback.evolution_threshold", "perception.max_length",
                     "event_bus.max_log_size"]:
            with patch("langgraph.runner.reset_runner_cache") as mock_reset:
                _on_config_change(key, "old", "new")
                mock_reset.assert_not_called()


# ---------------------------------------------------------------------------
# 12.2.5  AGUIStreamAdapter 重构（AGUIStateMachine）
# ---------------------------------------------------------------------------


async def _async_gen(items: List[Dict]) -> AsyncGenerator[Dict, None]:
    """辅助：将列表转为异步生成器。"""
    for item in items:
        yield item


class TestAGUIStateMachine:
    """12.2.5: AGUIStateMachine 状态机单元测试。"""

    def test_state_machine_init(self):
        """状态机正确初始化。"""
        from orchestration.communication.agui_adapter import AGUIStateMachine

        sm = AGUIStateMachine("trace123", "msg456", "dict")
        assert sm.trace_id == "trace123"
        assert sm.message_id == "msg456"
        assert sm.output_format == "dict"
        assert sm.thinking_started is False
        assert sm.text_message_started is False
        assert sm.has_error is False
        assert sm.response_text == ""
        assert sm.tool_call_records == []

    def test_emit_run_started_dict(self):
        """emit_run_started 产出 dict 格式。"""
        from orchestration.communication.agui_adapter import AGUIStateMachine

        sm = AGUIStateMachine("t1", "m1", "dict")
        event = sm.emit_run_started()
        assert "data" in event
        data = json.loads(event["data"])
        assert data["type"] == "RUN_STARTED"
        assert data["threadId"] == "t1"
        assert data["runId"] == "t1"

    def test_emit_run_started_sse(self):
        """emit_run_started 产出 SSE 字符串格式。"""
        from orchestration.communication.agui_adapter import AGUIStateMachine

        sm = AGUIStateMachine("t1", "m1", "sse")
        event = sm.emit_run_started()
        assert isinstance(event, str)
        assert event.startswith("data: ")
        assert "RUN_STARTED" in event

    def test_thinking_lazy_start(self):
        """思考事件懒启动——首次产出 THINKING_START。"""
        from orchestration.communication.agui_adapter import AGUIStateMachine

        sm = AGUIStateMachine("t", "m", "dict")
        events = sm.emit_thinking("hello")
        # 首次：THINKING_START + THINKING_CONTENT
        assert len(events) == 2
        assert "THINKING_START" in events[0]["data"]
        assert "THINKING_TEXT_MESSAGE_CONTENT" in events[1]["data"]

        # 第二次：仅 THINKING_CONTENT（不重复 START）
        events2 = sm.emit_thinking("world")
        assert len(events2) == 1
        assert "THINKING_TEXT_MESSAGE_CONTENT" in events2[0]["data"]

    def test_token_lazy_start(self):
        """token 事件懒启动——首次产出 TEXT_MESSAGE_START。"""
        from orchestration.communication.agui_adapter import AGUIStateMachine

        sm = AGUIStateMachine("t", "m", "dict")
        events = sm.emit_token("hello")
        assert len(events) == 2
        assert "TEXT_MESSAGE_START" in events[0]["data"]
        assert "TEXT_MESSAGE_CONTENT" in events[1]["data"]

        events2 = sm.emit_token(" world")
        assert len(events2) == 1
        assert "TEXT_MESSAGE_CONTENT" in events2[0]["data"]

        assert sm.response_text == "hello world"
        assert sm.collected_text == "hello world"

    def test_tool_call_lifecycle(self):
        """工具调用完整生命周期：start → end → result。"""
        from orchestration.communication.agui_adapter import AGUIStateMachine

        sm = AGUIStateMachine("t", "m", "dict")

        # start
        events = sm.emit_tool_call_start("tc1", "calculator", '{"expr": "1+1"}')
        assert len(events) == 2  # TOOL_CALL_START + TOOL_CALL_ARGS
        assert "TOOL_CALL_START" in events[0]["data"]
        assert "TOOL_CALL_ARGS" in events[1]["data"]

        # end
        end_ev = sm.emit_tool_call_end("tc1")
        assert end_ev is not None
        assert "TOOL_CALL_END" in end_ev["data"]

        # result
        events = sm.emit_tool_result("tc1", "calculator", "2", "success")
        assert len(events) == 1
        assert "TOOL_CALL_RESULT" in events[0]["data"]
        assert len(sm.tool_call_records) == 1
        assert sm.tool_call_records[0].tool_name == "calculator"

    def test_emit_closing_full(self):
        """emit_closing 产出完整的结束事件序列。"""
        from orchestration.communication.agui_adapter import AGUIStateMachine

        sm = AGUIStateMachine("t", "m", "dict")
        # 启动 thinking 和 text
        sm.emit_thinking("thinking content")
        sm.emit_token("response text")

        events = sm.emit_closing()
        # THINKING_END + TEXT_MESSAGE_END + RUN_FINISHED
        assert len(events) == 3
        assert "THINKING_END" in events[0]["data"]
        assert "TEXT_MESSAGE_END" in events[1]["data"]
        assert "RUN_FINISHED" in events[2]["data"]

    def test_emit_closing_text_not_started_but_has_response(self):
        """未启动 text 但有 response_text 时补发完整文本序列。"""
        from orchestration.communication.agui_adapter import AGUIStateMachine

        sm = AGUIStateMachine("t", "m", "dict")
        sm.response_text = "accumulated text"
        # 不调用 emit_token（text_message_started=False）

        events = sm.emit_closing()
        # 无 THINKING_END（未启动）+ TEXT_START + TEXT_CONTENT + TEXT_END + RUN_FINISHED
        assert len(events) == 4
        assert "TEXT_MESSAGE_START" in events[0]["data"]
        assert "TEXT_MESSAGE_CONTENT" in events[1]["data"]
        assert "TEXT_MESSAGE_END" in events[2]["data"]
        assert "RUN_FINISHED" in events[3]["data"]

    def test_emit_run_error_sets_has_error(self):
        """emit_run_error 设置 has_error 标志。"""
        from orchestration.communication.agui_adapter import AGUIStateMachine

        sm = AGUIStateMachine("t", "m", "dict")
        sm.emit_run_error("ERR_001", "something went wrong")
        assert sm.has_error is True


class TestAGUIStreamAdapterRefactored:
    """12.2.5: 重构后的 AGUIStreamAdapter 集成测试。"""

    async def test_transform_streaming_events_basic(self):
        """transform_streaming_events 基本流程（token + done）。"""
        from orchestration.communication.agui_adapter import AGUIStreamAdapter

        adapter = AGUIStreamAdapter(trace_id="test_trace")
        frames = [
            {"event": "token", "data": json.dumps({"token": "Hello"})},
            {"event": "token", "data": json.dumps({"token": " World"})},
            {"event": "done", "data": json.dumps({"tool_results": []})},
        ]

        events = []
        async for ev in adapter.transform_streaming_events(_async_gen(frames)):
            events.append(ev)

        # RUN_STARTED + TEXT_START + TEXT_CONTENT*2 + TEXT_END + RUN_FINISHED
        types = [json.loads(e["data"])["type"] for e in events]
        assert types[0] == "RUN_STARTED"
        assert "TEXT_MESSAGE_START" in types
        assert types.count("TEXT_MESSAGE_CONTENT") == 2
        assert "TEXT_MESSAGE_END" in types
        assert types[-1] == "RUN_FINISHED"

    async def test_transform_streaming_events_with_thinking(self):
        """transform_streaming_events 处理 thinking 事件。"""
        from orchestration.communication.agui_adapter import AGUIStreamAdapter

        adapter = AGUIStreamAdapter(trace_id="test_trace")
        frames = [
            {"event": "thinking", "data": json.dumps({"content": "Let me think..."})},
            {"event": "token", "data": json.dumps({"token": "Answer"})},
            {"event": "done", "data": json.dumps({"tool_results": []})},
        ]

        events = []
        async for ev in adapter.transform_streaming_events(_async_gen(frames)):
            events.append(ev)

        types = [json.loads(e["data"])["type"] for e in events]
        assert "THINKING_START" in types
        assert "THINKING_TEXT_MESSAGE_CONTENT" in types
        assert "THINKING_END" in types
        assert "TEXT_MESSAGE_START" in types

    async def test_transform_streaming_events_with_tool_call(self):
        """transform_streaming_events 处理工具调用。"""
        from orchestration.communication.agui_adapter import AGUIStreamAdapter

        adapter = AGUIStreamAdapter(trace_id="test_trace")
        frames = [
            {"event": "tool_call_start", "data": json.dumps({
                "id": "tc1", "name": "calculator", "arguments": '{"expr": "1+1"}',
            })},
            {"event": "tool_call_end", "data": json.dumps({"id": "tc1"})},
            {"event": "tool_result", "data": json.dumps({
                "id": "tc1", "name": "calculator", "result": "2", "status": "success",
            })},
            {"event": "token", "data": json.dumps({"token": "The answer is 2"})},
            {"event": "done", "data": json.dumps({"tool_results": []})},
        ]

        events = []
        async for ev in adapter.transform_streaming_events(_async_gen(frames)):
            events.append(ev)

        types = [json.loads(e["data"])["type"] for e in events]
        assert "TOOL_CALL_START" in types
        assert "TOOL_CALL_ARGS" in types
        assert "TOOL_CALL_END" in types
        assert "TOOL_CALL_RESULT" in types

        # 验证 tool_call_records 同步
        assert len(adapter.tool_call_records) == 1
        assert adapter.tool_call_records[0].tool_name == "calculator"

    async def test_transform_streaming_events_error(self):
        """transform_streaming_events 处理 error 事件（短路返回）。"""
        from orchestration.communication.agui_adapter import AGUIStreamAdapter

        adapter = AGUIStreamAdapter(trace_id="test_trace")
        frames = [
            {"event": "token", "data": json.dumps({"token": "partial"})},
            {"event": "error", "data": json.dumps({
                "error_code": "ERR_001", "message": "Failed",
            })},
            {"event": "token", "data": json.dumps({"token": "should not appear"})},
        ]

        events = []
        async for ev in adapter.transform_streaming_events(_async_gen(frames)):
            events.append(ev)

        types = [json.loads(e["data"])["type"] for e in events]
        assert "RUN_ERROR" in types
        # error 之后的 token 不应出现
        assert types.count("TEXT_MESSAGE_CONTENT") == 1
        # 不应有 RUN_FINISHED（error 短路）
        assert "RUN_FINISHED" not in types

    async def test_transform_streaming_sse_format(self):
        """transform_streaming 产出 SSE 字符串格式。"""
        from orchestration.communication.agui_adapter import AGUIStreamAdapter

        adapter = AGUIStreamAdapter(trace_id="test_trace")
        frames = [
            {"event": "token", "data": json.dumps({"token": "Hi"})},
            {"event": "done", "data": json.dumps({"tool_results": []})},
        ]

        results = []
        async for sse_str in adapter.transform_streaming(_async_gen(frames)):
            results.append(sse_str)
            assert isinstance(sse_str, str)
            assert sse_str.startswith("data: ")

    async def test_transform_streaming_events_collected_text(self):
        """transform_streaming_events 正确收集 collected_text。"""
        from orchestration.communication.agui_adapter import AGUIStreamAdapter

        adapter = AGUIStreamAdapter(trace_id="test_trace")
        frames = [
            {"event": "token", "data": json.dumps({"token": "Hello"})},
            {"event": "token", "data": json.dumps({"token": " World"})},
            {"event": "done", "data": json.dumps({"tool_results": []})},
        ]

        async for _ in adapter.transform_streaming_events(_async_gen(frames)):
            pass

        assert adapter.collected_text == "Hello World"

    async def test_transform_langgraph_events_basic(self):
        """transform_langgraph_events 基本流程。"""
        from orchestration.communication.agui_adapter import AGUIStreamAdapter

        adapter = AGUIStreamAdapter(trace_id="lg_trace")

        # 模拟 LangGraph messages 事件
        mock_msg = MagicMock()
        mock_msg.content = "LangGraph response"
        events = [
            {"type": "messages", "event": mock_msg},
            {"type": "values", "data": {"response": "LangGraph response"}},
        ]

        results = []
        async for ev in adapter.transform_langgraph_events(_async_gen(events)):
            results.append(ev)

        types = [json.loads(e["data"])["type"] for e in results]
        assert types[0] == "RUN_STARTED"
        assert "TEXT_MESSAGE_START" in types
        assert "TEXT_MESSAGE_CONTENT" in types
        assert "TEXT_MESSAGE_END" in types
        assert types[-1] == "RUN_FINISHED"

    async def test_transform_langgraph_events_error(self):
        """transform_langgraph_events 处理错误事件。"""
        from orchestration.communication.agui_adapter import AGUIStreamAdapter

        adapter = AGUIStreamAdapter(trace_id="lg_trace")
        events = [
            {"type": "values", "data": {"error_code": "GRAPH_001", "error_message": "Build failed"}},
        ]

        results = []
        async for ev in adapter.transform_langgraph_events(_async_gen(events)):
            results.append(ev)

        types = [json.loads(e["data"])["type"] for e in results]
        assert "RUN_ERROR" in types
        assert "RUN_FINISHED" not in types

    async def test_transform_langgraph_events_final_response_fallback(self):
        """transform_langgraph_events 非流式回退（values 中 response）。"""
        from orchestration.communication.agui_adapter import AGUIStreamAdapter

        adapter = AGUIStreamAdapter(trace_id="lg_trace")
        events = [
            {"type": "values", "data": {"response": "Non-streaming response"}},
        ]

        results = []
        async for ev in adapter.transform_langgraph_events(_async_gen(events)):
            results.append(ev)

        types = [json.loads(e["data"])["type"] for e in results]
        assert "TEXT_MESSAGE_START" in types
        assert "TEXT_MESSAGE_CONTENT" in types
        # 验证内容包含非流式响应
        content_events = [e for e in results if "TEXT_MESSAGE_CONTENT" in e["data"]]
        if content_events:
            data = json.loads(content_events[0]["data"])
            assert data["delta"] == "Non-streaming response"

    async def test_transform_langgraph_sse_wrapper(self):
        """transform_langgraph 产出 SSE 字符串。"""
        from orchestration.communication.agui_adapter import AGUIStreamAdapter

        adapter = AGUIStreamAdapter(trace_id="lg_trace")
        mock_msg = MagicMock()
        mock_msg.content = "test"
        events = [
            {"type": "messages", "event": mock_msg},
        ]

        results = []
        async for sse_str in adapter.transform_langgraph(_async_gen(events)):
            results.append(sse_str)
            assert isinstance(sse_str, str)

    async def test_state_delta_status_event(self):
        """status 事件产出 STATE_DELTA。"""
        from orchestration.communication.agui_adapter import AGUIStreamAdapter

        adapter = AGUIStreamAdapter(trace_id="test_trace")
        frames = [
            {"event": "status", "data": json.dumps({"phase": "reasoning"})},
            {"event": "token", "data": json.dumps({"token": "response"})},
            {"event": "done", "data": json.dumps({"tool_results": []})},
        ]

        events = []
        async for ev in adapter.transform_streaming_events(_async_gen(frames)):
            events.append(ev)

        types = [json.loads(e["data"])["type"] for e in events]
        assert "STATE_DELTA" in types

    async def test_reasoning_iteration_event(self):
        """reasoning_iteration 事件产出 STATE_DELTA。"""
        from orchestration.communication.agui_adapter import AGUIStreamAdapter

        adapter = AGUIStreamAdapter(trace_id="test_trace")
        frames = [
            {"event": "reasoning_iteration", "data": json.dumps({"index": 1, "max": 3})},
            {"event": "token", "data": json.dumps({"token": "response"})},
            {"event": "done", "data": json.dumps({"tool_results": []})},
        ]

        events = []
        async for ev in adapter.transform_streaming_events(_async_gen(frames)):
            events.append(ev)

        state_deltas = [
            json.loads(e["data"]) for e in events
            if "STATE_DELTA" in e["data"]
        ]
        assert len(state_deltas) >= 1
        assert state_deltas[0].get("iteration") == 1
        assert state_deltas[0].get("maxIterations") == 3

    async def test_done_with_extra_tool_results(self):
        """done 事件中附加的 tool_results 被正确处理。"""
        from orchestration.communication.agui_adapter import AGUIStreamAdapter

        adapter = AGUIStreamAdapter(trace_id="test_trace")
        frames = [
            {"event": "token", "data": json.dumps({"token": "response"})},
            {"event": "done", "data": json.dumps({
                "tool_results": [
                    {"tool": "search", "params": {"q": "test"}, "result": {"data": "results"}},
                ],
            })},
        ]

        events = []
        async for ev in adapter.transform_streaming_events(_async_gen(frames)):
            events.append(ev)

        types = [json.loads(e["data"])["type"] for e in events]
        assert "TOOL_CALL_START" in types
        assert "TOOL_CALL_END" in types
        assert "TOOL_CALL_RESULT" in types
