"""perception_node 单元测试（P2-4）。

覆盖：
    - 正常感知流程（输入路由 + 感知器链 + 融合）
    - 感知失败时的降级（返回 cleaned_text = prompt）
    - 路由函数 route_after_perception（敏感度熔断/注入熔断/PII 阻断）
    - P2-12.2.3: 异步 perception_node 并行管线验证

依赖 langchain_core（通过 langgraph.nodes），未安装时自动跳过。
"""
import pytest

# langgraph.nodes 导入 langchain_core.messages，缺失则跳过
pytest.importorskip("langchain_core")

from unittest.mock import AsyncMock, patch

from langgraph.nodes import (
    perception_node,
    perception_node_sync,
    route_after_perception,
)
from langgraph.state import ModuAgentState
from config.runtime_config import RuntimeConfig, override_config


class TestPerceptionNode:
    """P2-12.2.3: 异步 perception_node 测试。"""

    async def test_perception_node_empty_input(self):
        """空输入时应返回降级结果。"""
        state: ModuAgentState = {
            "input_data": {"prompt": ""},
        }
        result = await perception_node(state)
        assert result["cleaned_text"] == ""
        assert result["sensitivity_level"] == 0
        assert result["confidence"] == 1.0

    async def test_perception_node_no_perception_components(self):
        """无感知组件注册时应返回降级结果（cleaned_text = prompt）。"""
        state: ModuAgentState = {
            "input_data": {"prompt": "hello world"},
        }
        result = await perception_node(state)
        # 无注册感知器时 fused 为 None，cleaned_text 回退到 prompt
        assert result["cleaned_text"] == "hello world"

    async def test_perception_node_with_mock_pipeline(self):
        """通过 mock 验证异步 perception_node 正确提取融合结果。"""
        mock_fused = {
            "parsed_content": {"text": "cleaned text", "input_type": "text"},
            "metadata": {
                "sensitivity_level": 2,
                "injection_detected": False,
                "pii_detected": False,
            },
            "confidence": 0.95,
            "detected_language": "zh",
        }

        with patch(
            "langgraph.nodes.run_perception_pipeline_async",
            new_callable=AsyncMock,
            return_value=mock_fused,
        ):
            state: ModuAgentState = {
                "input_data": {"prompt": "原始输入"},
            }
            result = await perception_node(state)

        assert result["cleaned_text"] == "cleaned text"
        assert result["sensitivity_level"] == 2
        assert result["confidence"] == 0.95
        assert result["detected_language"] == "zh"
        assert result["injection_detected"] is False
        assert result["pii_detected"] is False

    async def test_perception_node_uses_async_pipeline(self):
        """P2-12.2.3: 验证 perception_node 调用的是异步并行管线而非同步串行管线。"""
        with patch(
            "langgraph.nodes.run_perception_pipeline_async",
            new_callable=AsyncMock,
            return_value=None,
        ) as mock_async, patch(
            "langgraph.nodes.run_perception_pipeline",
        ) as mock_sync:
            state: ModuAgentState = {
                "input_data": {"prompt": "test"},
            }
            await perception_node(state)
            mock_async.assert_awaited_once()
            mock_sync.assert_not_called()


class TestPerceptionNodeSync:
    """P2-12.2.3: 同步 perception_node_sync 向后兼容测试。"""

    def test_sync_empty_input(self):
        """同步版本空输入降级。"""
        state: ModuAgentState = {
            "input_data": {"prompt": ""},
        }
        result = perception_node_sync(state)
        assert result["cleaned_text"] == ""

    def test_sync_with_mock_pipeline(self):
        """同步版本 mock 验证。"""
        mock_fused = {
            "parsed_content": {"text": "sync text", "input_type": "text"},
            "metadata": {"sensitivity_level": 1},
            "confidence": 0.8,
            "detected_language": "en",
        }
        with patch(
            "langgraph.nodes.run_perception_pipeline",
            return_value=mock_fused,
        ):
            state: ModuAgentState = {
                "input_data": {"prompt": "input"},
            }
            result = perception_node_sync(state)
        assert result["cleaned_text"] == "sync text"
        assert result["confidence"] == 0.8


class TestRouteAfterPerception:
    def test_route_to_memory_query_normal(self):
        """正常情况路由到 memory_query。"""
        cfg = RuntimeConfig()
        with override_config(cfg):
            state: ModuAgentState = {
                "sensitivity_level": 0,
                "injection_detected": False,
                "pii_detected": False,
            }
            assert route_after_perception(state) == "memory_query"

    def test_route_to_end_on_sensitivity_circuit_breaker(self):
        """敏感度 >= threshold 时熔断。"""
        cfg = RuntimeConfig()
        with override_config(cfg):
            state: ModuAgentState = {
                "sensitivity_level": 5,  # 默认 threshold=5
            }
            assert route_after_perception(state) == "__end__"

    def test_route_to_end_on_injection_detected(self):
        """注入检测 + block_on_injection 时熔断。"""
        cfg = RuntimeConfig()
        cfg.update("perception.security.block_on_injection", True)
        with override_config(cfg):
            state: ModuAgentState = {
                "sensitivity_level": 0,
                "injection_detected": True,
            }
            assert route_after_perception(state) == "__end__"

    def test_route_to_end_on_pii_detected(self):
        """PII 检测 + block_on_pii 时熔断（P2-6）。"""
        cfg = RuntimeConfig()
        cfg.update("perception.security.block_on_pii", True)
        with override_config(cfg):
            state: ModuAgentState = {
                "sensitivity_level": 0,
                "pii_detected": True,
            }
            assert route_after_perception(state) == "__end__"
