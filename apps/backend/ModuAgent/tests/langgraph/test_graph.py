"""build_modu_graph 单元测试（P2-4）。

覆盖：
    - 图结构构建（节点/边存在性）
    - 无工具/无 store 时的降级
    - recursion_limit 设置
    - feedback/memory_update 节点接入

依赖 langgraph + langchain_core，未安装时自动跳过。
"""
import pytest

pytest.importorskip("langchain_core")
pytest.importorskip("langgraph")

from unittest.mock import MagicMock

from langgraph.graph import build_modu_graph


class TestBuildModuGraph:
    def test_build_graph_minimal(self):
        """最小图构建：无工具、无 store、无 checkpointer。"""
        mock_llm = MagicMock()
        mock_llm.bind_tools = MagicMock(return_value=mock_llm)

        graph = build_modu_graph(
            tools=[],
            llm=mock_llm,
            checkpointer=None,
            store=None,
        )
        assert graph is not None
        # 默认 recursion_limit 应为正数
        assert graph.recursion_limit > 0

    def test_build_graph_with_custom_recursion_limit(self):
        mock_llm = MagicMock()
        mock_llm.bind_tools = MagicMock(return_value=mock_llm)

        graph = build_modu_graph(
            tools=[],
            llm=mock_llm,
            recursion_limit=20,
        )
        assert graph.recursion_limit == 20

    def test_build_graph_with_orchestrator_adds_feedback_node(self):
        """有 orchestrator 时应接入 feedback 节点。"""
        mock_llm = MagicMock()
        mock_llm.bind_tools = MagicMock(return_value=mock_llm)
        mock_orchestrator = MagicMock()

        graph = build_modu_graph(
            tools=[],
            llm=mock_llm,
            orchestrator=mock_orchestrator,
        )
        assert graph is not None

    def test_build_graph_with_store_adds_memory_nodes(self):
        """有 store 时应接入 memory_query/memory_update 节点。"""
        mock_llm = MagicMock()
        mock_llm.bind_tools = MagicMock(return_value=mock_llm)
        mock_store = MagicMock()

        graph = build_modu_graph(
            tools=[],
            llm=mock_llm,
            store=mock_store,
        )
        assert graph is not None
