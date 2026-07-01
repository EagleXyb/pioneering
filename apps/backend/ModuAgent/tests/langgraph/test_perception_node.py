"""perception_node 单元测试（P2-4）。

覆盖：
    - 正常感知流程（输入路由 + 感知器链 + 融合）
    - 感知失败时的降级（返回 cleaned_text = prompt）
    - 路由函数 route_after_perception（敏感度熔断/注入熔断/PII 阻断）

依赖 langchain_core（通过 langgraph.nodes），未安装时自动跳过。
"""
import pytest

# langgraph.nodes 导入 langchain_core.messages，缺失则跳过
pytest.importorskip("langchain_core")

from unittest.mock import MagicMock, patch

from langgraph.nodes import perception_node, route_after_perception
from langgraph.state import ModuAgentState
from config.runtime_config import RuntimeConfig, override_config


class TestPerceptionNode:
    def test_perception_node_empty_input(self):
        """空输入时应返回降级结果。"""
        state: ModuAgentState = {
            "input_data": {"prompt": ""},
        }
        result = perception_node(state)
        assert result["cleaned_text"] == ""
        assert result["sensitivity_level"] == 0
        assert result["confidence"] == 1.0

    def test_perception_node_no_perception_components(self):
        """无感知组件注册时应返回降级结果（cleaned_text = prompt）。"""
        state: ModuAgentState = {
            "input_data": {"prompt": "hello world"},
        }
        result = perception_node(state)
        # 无注册感知器时 fused 为 None，cleaned_text 回退到 prompt
        assert result["cleaned_text"] == "hello world"

    def test_perception_node_with_mock_pipeline(self):
        """通过 mock 验证 perception_node 正确提取融合结果。"""
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

        with patch("langgraph.nodes.run_perception_pipeline", return_value=mock_fused):
            state: ModuAgentState = {
                "input_data": {"prompt": "原始输入"},
            }
            result = perception_node(state)

        assert result["cleaned_text"] == "cleaned text"
        assert result["sensitivity_level"] == 2
        assert result["confidence"] == 0.95
        assert result["detected_language"] == "zh"
        assert result["injection_detected"] is False
        assert result["pii_detected"] is False


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
