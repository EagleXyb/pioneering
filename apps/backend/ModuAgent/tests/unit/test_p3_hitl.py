"""P3-12.3.2 Human-in-the-loop (HITL) 单元测试。

测试矩阵（对照技术方案 §6.2.2）：
    - test_tool_requires_approval_flag: 敏感工具 requires_approval()=True
    - test_interrupt_paused_state: human_review_node 调用 interrupt
    - test_resume_approved: Command(resume=approved) → 继续
    - test_resume_rejected: Command(resume=rejected) → 跳过工具
    - test_non_sensitive_tool_no_interrupt: 普通工具不触发 interrupt
    - test_human_review_node_disabled: HITL 关闭时 no-op
    - test_route_after_human_review: 审批后路由
    - test_checkpointer_persists_interrupt_state: interrupt 状态查询

Note: 由于本地 langgraph 包名遮蔽库，部分测试需跳过（与 test_p2_performance_fixes.py 同模式）。
"""
from __future__ import annotations

import asyncio
import json
import sys
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ============================================================
# 模块级 probe import（检测 langgraph 集成是否可用）
# ============================================================
try:
    from langgraph.nodes import (
        _tool_requires_approval,
        make_human_review_node,
        route_after_human_review,
    )
    _LANGGRAPH_HITL_AVAILABLE = True
    _LANGGRAPH_HITL_SKIP_REASON = ""
except BaseException as _e:  # noqa: BLE001
    _LANGGRAPH_HITL_AVAILABLE = False
    _LANGGRAPH_HITL_SKIP_REASON = (
        f"local langgraph integration not importable (package name shadowing): {_e}"
    )


def _skip_if_langgraph_unavailable():
    """若 langgraph 集成不可用，跳过当前测试。"""
    if not _LANGGRAPH_HITL_AVAILABLE:
        pytest.skip(_LANGGRAPH_HITL_SKIP_REASON, allow_module_level=False)


# ============================================================
# 1. BaseTool.requires_approval 标记测试（无需 langgraph 导入）
# ============================================================

class TestToolApprovalFlag:
    """工具审批标记测试（直接测试工具实例，不依赖 langgraph）。"""

    def test_code_executor_requires_approval(self, code_executor_tool) -> None:
        """code_executor 需要审批。"""
        assert code_executor_tool.requires_approval() is True

    def test_file_ops_requires_approval(self, file_ops_tool) -> None:
        """file_ops 需要审批。"""
        assert file_ops_tool.requires_approval() is True

    def test_sql_query_requires_approval(self, sql_query_tool) -> None:
        """sql_query 需要审批。"""
        assert sql_query_tool.requires_approval() is True

    def test_http_request_requires_approval(self, http_request_tool) -> None:
        """http_request 需要审批。"""
        assert http_request_tool.requires_approval() is True

    def test_datetime_does_not_require_approval(self, datetime_tool) -> None:
        """datetime_tool 不需要审批（纯计算）。"""
        assert datetime_tool.requires_approval() is False

    def test_calculator_does_not_require_approval(self) -> None:
        """calculator（现有工具）不需要审批。"""
        from components.action.tools.calculator import CalculatorTool

        tool = CalculatorTool()
        assert tool.requires_approval() is False

    def test_search_does_not_require_approval(self) -> None:
        """search（现有工具）不需要审批。"""
        from components.action.tools.search import SearchTool

        tool = SearchTool()
        assert tool.requires_approval() is False


# ============================================================
# 2. _tool_requires_approval 辅助函数测试
# ============================================================

class TestToolRequiresApprovalHelper:
    """_tool_requires_approval() 辅助函数测试。"""

    def test_sensitive_tools_list_match(self) -> None:
        """工具名在 sensitive_tools 列表中 → True。"""
        _skip_if_langgraph_unavailable()
        assert _tool_requires_approval("code_executor", None, ["code_executor"]) is True
        assert _tool_requires_approval("sql_query", None, ["code_executor", "sql_query"]) is True

    def test_non_sensitive_tool_without_registry(self) -> None:
        """工具不在列表中且无 registry → False。"""
        _skip_if_langgraph_unavailable()
        assert _tool_requires_approval("calculator", None, ["code_executor"]) is False

    def test_non_sensitive_tool_with_registry_approval(self, fresh_registry) -> None:
        """工具不在列表中但 registry 中 requires_approval()=True → True。"""
        _skip_if_langgraph_unavailable()
        # 注册 code_executor（requires_approval()=True）
        from components.action.tools.code_executor import CodeExecutorTool

        fresh_registry.register_tool(CodeExecutorTool())
        assert _tool_requires_approval("code_executor", fresh_registry, []) is True

    def test_non_sensitive_tool_with_registry_no_approval(self, fresh_registry) -> None:
        """工具不在列表中且 registry 中 requires_approval()=False → False。"""
        _skip_if_langgraph_unavailable()
        from components.action.tools.calculator import CalculatorTool

        fresh_registry.register_tool(CalculatorTool())
        assert _tool_requires_approval("calculator", fresh_registry, ["code_executor"]) is False

    def test_empty_sensitive_list(self) -> None:
        """空 sensitive_tools 列表 → False。"""
        _skip_if_langgraph_unavailable()
        assert _tool_requires_approval("code_executor", None, []) is False


# ============================================================
# 3. make_human_review_node 测试
# ============================================================

class TestHumanReviewNode:
    """human_review 节点测试。"""

    def test_human_review_disabled_returns_skipped(self, fresh_config) -> None:
        """HITL 关闭时节点返回 skipped。"""
        _skip_if_langgraph_unavailable()
        fresh_config.set("tools.human_in_loop.enabled", False)
        node = make_human_review_node(config=fresh_config)

        state = {"messages": [], "trace_id": "t1", "session_id": "s1", "user_id": "u1"}
        result = asyncio.get_event_loop().run_until_complete(node(state))
        assert result["approval_status"] == "skipped"

    def test_no_messages_returns_no_tool_calls(self, fresh_config) -> None:
        """无消息时返回 no_tool_calls。"""
        _skip_if_langgraph_unavailable()
        fresh_config.set("tools.human_in_loop.enabled", True)
        node = make_human_review_node(config=fresh_config)

        state = {"messages": [], "trace_id": "t1"}
        result = asyncio.get_event_loop().run_until_complete(node(state))
        assert result["approval_status"] == "no_tool_calls"

    def test_no_tool_calls_in_last_message(self, fresh_config) -> None:
        """最后一条消息无 tool_calls → no_tool_calls。"""
        _skip_if_langgraph_unavailable()
        fresh_config.set("tools.human_in_loop.enabled", True)
        node = make_human_review_node(config=fresh_config)

        # 创建无 tool_calls 的 AIMessage
        from langchain_core.messages import AIMessage

        state = {
            "messages": [AIMessage(content="I can help with that.")],
            "trace_id": "t1",
        }
        result = asyncio.get_event_loop().run_until_complete(node(state))
        assert result["approval_status"] == "no_tool_calls"

    def test_non_sensitive_tool_no_interrupt(self, fresh_config) -> None:
        """普通工具不触发 interrupt → not_required。"""
        _skip_if_langgraph_unavailable()
        fresh_config.set("tools.human_in_loop.enabled", True)
        fresh_config.set("tools.human_in_loop.sensitive_tools", ["code_executor"])
        node = make_human_review_node(config=fresh_config)

        from langchain_core.messages import AIMessage

        # calculator 不需要审批
        state = {
            "messages": [AIMessage(content="", tool_calls=[{"name": "calculator", "args": {}, "id": "tc1"}])],
            "trace_id": "t1",
        }
        result = asyncio.get_event_loop().run_until_complete(node(state))
        assert result["approval_status"] == "not_required"
        assert result["tool_requires_approval"] is False

    def test_sensitive_tool_triggers_interrupt_approved(self, fresh_config) -> None:
        """敏感工具触发 interrupt，resume=approved → approved。"""
        _skip_if_langgraph_unavailable()
        fresh_config.set("tools.human_in_loop.enabled", True)
        fresh_config.set("tools.human_in_loop.sensitive_tools", ["code_executor"])
        node = make_human_review_node(config=fresh_config)

        from langchain_core.messages import AIMessage

        state = {
            "messages": [AIMessage(
                content="",
                tool_calls=[{"name": "code_executor", "args": {"code": "print(1)"}, "id": "tc1"}],
            )],
            "trace_id": "trace-1",
            "session_id": "sess-1",
            "user_id": "user-1",
        }

        # Mock interrupt 返回 approved
        with patch("langgraph.types.interrupt", return_value={"approved": True, "feedback": "ok"}):
            result = asyncio.get_event_loop().run_until_complete(node(state))

        assert result["approval_status"] == "approved"
        assert result["approval_feedback"] == "ok"

    def test_sensitive_tool_triggers_interrupt_rejected(self, fresh_config, fresh_registry) -> None:
        """敏感工具触发 interrupt，resume=rejected → rejected + 降级 ToolMessage。"""
        _skip_if_langgraph_unavailable()
        fresh_config.set("tools.human_in_loop.enabled", True)
        fresh_config.set("tools.human_in_loop.sensitive_tools", ["code_executor"])

        # 注册 code_executor 以获取 on_approval_rejected
        from components.action.tools.code_executor import CodeExecutorTool

        fresh_registry.register_tool(CodeExecutorTool())

        node = make_human_review_node(registry=fresh_registry, config=fresh_config)

        from langchain_core.messages import AIMessage

        state = {
            "messages": [AIMessage(
                content="",
                tool_calls=[{"name": "code_executor", "args": {"code": "print(1)"}, "id": "tc1"}],
            )],
            "trace_id": "trace-1",
            "session_id": "sess-1",
            "user_id": "user-1",
        }

        # Mock interrupt 返回 rejected
        with patch("langgraph.types.interrupt", return_value={"approved": False, "feedback": "dangerous"}):
            result = asyncio.get_event_loop().run_until_complete(node(state))

        assert result["approval_status"] == "rejected"
        assert result["approval_feedback"] == "dangerous"
        # 应生成降级 ToolMessage
        assert "messages" in result
        assert len(result["messages"]) == 1
        msg = result["messages"][0]
        # ToolMessage 内容应包含 TOOL_APPROVAL_REJECTED
        content = msg.content if hasattr(msg, "content") else str(msg)
        assert "TOOL_APPROVAL_REJECTED" in content or "rejected" in content.lower()


# ============================================================
# 4. route_after_human_review 测试
# ============================================================

class TestRouteAfterHumanReview:
    """审批后路由函数测试。"""

    def test_approved_routes_to_tools(self) -> None:
        """approved → tools。"""
        _skip_if_langgraph_unavailable()
        assert route_after_human_review({"approval_status": "approved"}) == "tools"

    def test_rejected_routes_to_response(self) -> None:
        """rejected → response。"""
        _skip_if_langgraph_unavailable()
        assert route_after_human_review({"approval_status": "rejected"}) == "response"

    def test_error_routes_to_response(self) -> None:
        """error → response。"""
        _skip_if_langgraph_unavailable()
        assert route_after_human_review({"approval_status": "error"}) == "response"

    def test_not_required_routes_to_tools(self) -> None:
        """not_required → tools。"""
        _skip_if_langgraph_unavailable()
        assert route_after_human_review({"approval_status": "not_required"}) == "tools"

    def test_skipped_routes_to_tools(self) -> None:
        """skipped → tools。"""
        _skip_if_langgraph_unavailable()
        assert route_after_human_review({"approval_status": "skipped"}) == "tools"

    def test_no_tool_calls_routes_to_tools(self) -> None:
        """no_tool_calls → tools。"""
        _skip_if_langgraph_unavailable()
        assert route_after_human_review({"approval_status": "no_tool_calls"}) == "tools"

    def test_empty_status_routes_to_tools(self) -> None:
        """空状态 → tools（默认）。"""
        _skip_if_langgraph_unavailable()
        assert route_after_human_review({}) == "tools"


# ============================================================
# 5. HITL 配置测试
# ============================================================

class TestHITLConfig:
    """HITL 配置测试。"""

    def test_hitl_disabled_by_default(self, fresh_config) -> None:
        """默认配置下 HITL 关闭。"""
        hitl = fresh_config.get("tools.human_in_loop")
        assert hitl is not None
        assert hitl["enabled"] is False

    def test_hitl_sensitive_tools_config(self, fresh_config) -> None:
        """敏感工具列表配置。"""
        tools = fresh_config.get("tools.human_in_loop.sensitive_tools")
        assert "code_executor" in tools
        assert "sql_query" in tools

    def test_hitl_approval_timeout_config(self, fresh_config) -> None:
        """审批超时配置。"""
        assert fresh_config.get("tools.human_in_loop.approval_timeout_seconds") == 300
        assert fresh_config.get("tools.human_in_loop.auto_reject_on_timeout") is True

    def test_hitl_can_be_enabled(self, fresh_config) -> None:
        """HITL 可启用。"""
        fresh_config.set("tools.human_in_loop.enabled", True)
        assert fresh_config.get("tools.human_in_loop.enabled") is True


# ============================================================
# 6. State 字段扩展测试
# ============================================================

class TestStateFields:
    """P3-12.3.2 state 字段扩展测试。"""

    def test_make_initial_state_includes_hitl_fields(self) -> None:
        """make_initial_state 包含 HITL 字段。"""
        _skip_if_langgraph_unavailable()
        from langgraph.state import make_initial_state

        state = make_initial_state(
            user_id="u1",
            session_id="s1",
            trace_id="t1",
            input_data={"input_type": "text", "prompt": "hello"},
        )
        assert "pending_tool_calls" in state
        assert "tool_requires_approval" in state
        assert "approval_status" in state
        assert "approval_feedback" in state
        assert state["pending_tool_calls"] == []
        assert state["tool_requires_approval"] is False
        assert state["approval_status"] == ""
        assert state["approval_feedback"] == ""


# ============================================================
# 7. resume_sync / get_interrupt_state 测试
# ============================================================

class TestResumeFunctions:
    """resume_sync / get_interrupt_state 函数测试（使用 mock graph）。"""

    def test_get_interrupt_state_returns_none_for_no_checkpoint(self) -> None:
        """无 checkpoint 时返回 None。"""
        _skip_if_langgraph_unavailable()
        from langgraph.runner import get_interrupt_state

        mock_graph = MagicMock()
        mock_graph.get_state.return_value = None

        result = get_interrupt_state(mock_graph, "session-1")
        assert result is None

    def test_get_interrupt_state_returns_none_for_no_next_nodes(self) -> None:
        """state.next 为空时返回 None（未暂停）。"""
        _skip_if_langgraph_unavailable()
        from langgraph.runner import get_interrupt_state

        mock_graph = MagicMock()
        mock_state = MagicMock()
        mock_state.next = []
        mock_graph.get_state.return_value = mock_state

        result = get_interrupt_state(mock_graph, "session-1")
        assert result is None

    def test_get_interrupt_state_returns_none_for_non_human_review(self) -> None:
        """next 不含 human_review 时返回 None。"""
        _skip_if_langgraph_unavailable()
        from langgraph.runner import get_interrupt_state

        mock_graph = MagicMock()
        mock_state = MagicMock()
        mock_state.next = ["tools"]
        mock_graph.get_state.return_value = mock_state

        result = get_interrupt_state(mock_graph, "session-1")
        assert result is None

    def test_get_interrupt_state_returns_dict_for_human_review(self) -> None:
        """next 含 human_review 时返回 interrupt 上下文。"""
        _skip_if_langgraph_unavailable()
        from langgraph.runner import get_interrupt_state

        mock_graph = MagicMock()
        mock_state = MagicMock()
        mock_state.next = ["human_review"]
        mock_state.values = {
            "pending_tool_calls": [{"name": "code_executor"}],
            "tool_requires_approval": True,
            "trace_id": "trace-1",
            "user_id": "user-1",
        }
        mock_graph.get_state.return_value = mock_state

        result = get_interrupt_state(mock_graph, "session-1")
        assert result is not None
        assert result["session_id"] == "session-1"
        assert "human_review" in result["next_nodes"]
        assert result["pending_tool_calls"] == [{"name": "code_executor"}]
        assert result["tool_requires_approval"] is True
        assert result["trace_id"] == "trace-1"

    def test_resume_sync_returns_error_when_command_unavailable(self) -> None:
        """Command API 不可用时返回错误。"""
        _skip_if_langgraph_unavailable()
        from langgraph.runner import resume_sync

        mock_graph = MagicMock()

        # Mock langgraph.types.Command 导入失败
        with patch.dict("sys.modules", {"langgraph.types": None}):
            result = asyncio.get_event_loop().run_until_complete(
                resume_sync(mock_graph, "s1", approved=True)
            )
        assert result["status"] == "error"
