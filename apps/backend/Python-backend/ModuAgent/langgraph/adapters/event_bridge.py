"""事件桥接器：LangGraph stream → EventBus。

将 LangGraph astream / astream_events 产生的事件桥接到现有 EventBus，
保留现有 EventBus 订阅者（PersistentEventLog、EvolutionSignalCollector）
不受重构影响。

映射规则：
    - messages stream → REASONING.GENERATE / STREAM
    - updates stream（perception 节点）→ PERCEPTION.ANALYZE
    - updates stream（memory_query 节点）→ MEMORY.QUERY
    - updates stream（tools 节点）→ TOOL.INVOKE / TOOL.EXECUTE
    - updates stream（agent 节点）→ REASONING.GENERATE

SSE 细粒度事件：
    - thinking：LLM 推理开始
    - tool_call_start：工具调用开始
    - tool_result：工具执行结果
"""

from __future__ import annotations

import logging
from typing import Any, AsyncGenerator, Dict, List, Optional

from orchestration.communication.message_bus import EventBus, get_event_bus
from orchestration.communication.protocol import (
    AgentEvent,
    EventAction,
    EventDomain,
    EventPriority,
)

logger = logging.getLogger(__name__)

# LangGraph stream 事件 → AgentEvent 域/动作映射
_NODE_DOMAIN_MAP: Dict[str, str] = {
    "perception": EventDomain.PERCEPTION,
    "memory_query": EventDomain.MEMORY,
    "agent": EventDomain.REASONING,
    "tools": EventDomain.TOOL,
}

_NODE_ACTION_MAP: Dict[str, str] = {
    "perception": EventAction.ANALYZE,
    "memory_query": EventAction.QUERY,
    "agent": EventAction.GENERATE,
    "tools": EventAction.INVOKE,
}

# SSE 事件类型
_SSE_EVENT_TYPES = ("thinking", "tool_call_start", "tool_call_end", "tool_result", "response")


class LangGraphEventBridge:
    """将 LangGraph stream 事件桥接到现有 EventBus。

    保留现有 EventBus 订阅者（PersistentEventLog、EvolutionSignalCollector）
    不受重构影响。作为 stream 消费者，同时透传原始事件供上游消费（如 SSE 输出）。

    增强功能：
    - SSE 细粒度事件映射（thinking/tool_call_start/tool_result）
    - EvolutionSignalCollector 集成

    Usage:
        bridge = LangGraphEventBridge()
        async for event in bridge.consume(graph.astream(...)):
            # event 透传给上游 SSE / AG-UI 适配器
            yield event
    """

    def __init__(
        self,
        event_bus: Optional[EventBus] = None,
        evolution_collector: Optional[Any] = None,
        trace_id: str = "",
        session_id: str = "",
        user_id: str = "",
    ) -> None:
        """初始化事件桥接器。

        Args:
            event_bus: 事件总线（默认使用全局单例）
            evolution_collector: 进化信号收集器（EvolutionSignalCollector 实例）
            trace_id: 链路追踪 ID
            session_id: 会话 ID
            user_id: 用户 ID
        """
        self._event_bus = event_bus or get_event_bus()
        self._evolution_collector = evolution_collector
        self._trace_id = trace_id
        self._session_id = session_id
        self._user_id = user_id
        self._token_count = 0
        self._in_thinking = False
        self._tool_call_stack: List[Dict[str, Any]] = []

    async def consume(
        self,
        graph_stream: AsyncGenerator[Dict[str, Any], None],
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """消费 LangGraph stream 事件，同步发布到 EventBus。

        同时透传原始事件供上游消费（如 SSE 输出）。

        Args:
            graph_stream: LangGraph astream / astream_events 产生的事件流

        Yields:
            原始事件（透传给上游）
        """
        async for event in graph_stream:
            # 映射并发布到 EventBus
            agent_event = self._map_to_agent_event(event)
            if agent_event:
                try:
                    await self._event_bus.publish(agent_event)
                except Exception as e:
                    logger.error("EventBus publish error: %s", str(e))

            # 发送到 EvolutionSignalCollector
            if self._evolution_collector:
                try:
                    self._evolution_collector.on_agent_event(agent_event)
                except Exception as e:
                    logger.error("EvolutionSignalCollector error: %s", str(e))

            # 发送 SSE 细粒度事件
            sse_events = self._emit_sse_events(event)
            for sse_event in sse_events:
                yield sse_event

            # 透传原始事件
            yield event

    def _map_to_agent_event(self, event: Dict[str, Any]) -> Optional[AgentEvent]:
        """将 LangGraph stream 事件映射为 AgentEvent。

        支持三种 LangGraph stream 格式：
        1. astream(stream_mode=["messages"]) → {"type": "messages", ...}
        2. astream(stream_mode=["updates"]) → {"type": "updates", "node": "...", ...}
        3. astream(stream_mode=["custom"]) → {"type": "custom", ...}

        Args:
            event: LangGraph stream 事件

        Returns:
            映射后的 AgentEvent，或 None（无需发布的事件）
        """
        event_type = event.get("type", "")

        # messages stream → token 级流式事件
        if event_type == "messages":
            self._token_count += 1
            # 每 10 个 token 发布一次进度事件
            if self._token_count % 10 == 0:
                return AgentEvent(
                    trace_id=self._trace_id,
                    session_id=self._session_id,
                    user_id=self._user_id,
                    domain=EventDomain.REASONING,
                    action=EventAction.STREAM,
                    metadata={
                        "phase": "progress",
                        "token_count": str(self._token_count),
                    },
                )
            return None

        # updates stream → 节点状态更新事件
        if event_type == "updates":
            node = event.get("node", "")
            domain = _NODE_DOMAIN_MAP.get(node)
            action = _NODE_ACTION_MAP.get(node)

            if domain and action:
                data = event.get("data", {})
                metadata: Dict[str, str] = {}

                if node == "perception" and isinstance(data, dict):
                    metadata = self._extract_perception_metadata(data)
                elif node == "memory_query" and isinstance(data, dict):
                    metadata = {
                        "has_knowledge": str(len(data.get("knowledge", [])) > 0),
                    }
                elif node == "tools" and isinstance(data, dict):
                    metadata = self._extract_tool_metadata(data)
                elif node == "agent" and isinstance(data, dict):
                    metadata = self._extract_agent_metadata(data)

                return AgentEvent(
                    trace_id=self._trace_id,
                    session_id=self._session_id,
                    user_id=self._user_id,
                    domain=domain,
                    action=action,
                    metadata=metadata,
                )

        # custom stream → 自定义事件
        if event_type == "custom":
            custom_data = event.get("data", {})
            if isinstance(custom_data, dict):
                domain_str = custom_data.get("domain", "")
                action_str = custom_data.get("action", "")
                if domain_str and action_str:
                    return AgentEvent(
                        trace_id=self._trace_id,
                        session_id=self._session_id,
                        user_id=self._user_id,
                        domain=domain_str,
                        action=action_str,
                        metadata=custom_data.get("metadata", {}),
                        priority=EventPriority.NORMAL,
                    )

        return None

    def _emit_sse_events(self, event: Dict[str, Any]) -> List[Dict[str, Any]]:
        """发射 SSE 细粒度事件。

        支持的事件类型：
        - thinking：LLM 推理开始
        - tool_call_start：工具调用开始
        - tool_result：工具执行结果

        Args:
            event: LangGraph stream 事件

        Returns:
            SSE 事件列表
        """
        sse_events = []
        event_type = event.get("type", "")

        # messages stream 开始 → thinking 事件
        if event_type == "messages":
            msg_event = event.get("event", {})
            if msg_event:
                # 检查是否是 AI 消息开始
                if hasattr(msg_event, "type") and msg_event.type == "ai":
                    if not self._in_thinking:
                        self._in_thinking = True
                        sse_events.append({
                            "type": "thinking",
                            "data": {"status": "started"},
                        })

        # updates stream → 检查工具调用
        if event_type == "updates":
            node = event.get("node", "")
            data = event.get("data", {})

            if node == "agent" and isinstance(data, dict):
                messages = data.get("messages", [])
                if messages:
                    last_msg = messages[-1]
                    # 检查是否有 tool_calls
                    if hasattr(last_msg, "tool_calls") and last_msg.tool_calls:
                        for tc in last_msg.tool_calls:
                            tc_id = tc.get("id", "")
                            tc_name = tc.get("name", "")
                            # 检查是否已发射过 tool_call_start
                            if not any(t.get("id") == tc_id for t in self._tool_call_stack):
                                sse_events.append({
                                    "type": "tool_call_start",
                                    "data": {
                                        "tool_call_id": tc_id,
                                        "tool_name": tc_name,
                                    },
                                })
                                self._tool_call_stack.append({"id": tc_id, "name": tc_name})

            elif node == "tools" and isinstance(data, dict):
                messages = data.get("messages", [])
                for msg in messages:
                    if hasattr(msg, "type") and msg.type == "tool":
                        tool_call_id = getattr(msg, "tool_call_id", "")
                        tool_name = getattr(msg, "name", "unknown")
                        content = getattr(msg, "content", "")

                        # 查找对应的 tool_call_start
                        matching = [t for t in self._tool_call_stack if t.get("id") == tool_call_id]
                        if matching:
                            self._tool_call_stack = [t for t in self._tool_call_stack if t.get("id") != tool_call_id]

                        sse_events.append({
                            "type": "tool_result",
                            "data": {
                                "tool_call_id": tool_call_id,
                                "tool_name": tool_name,
                                "result": content,
                            },
                        })

        return sse_events

    @staticmethod
    def _extract_perception_metadata(data: Dict[str, Any]) -> Dict[str, str]:
        """从感知节点更新数据中提取元数据。"""
        perception = data.get("perception_result")
        if not perception or not isinstance(perception, dict):
            return {
                "sensitivity_level": str(data.get("sensitivity_level", 0)),
                "confidence": str(data.get("confidence", 1.0)),
            }

        meta = perception.get("metadata", {})
        return {
            "input_type": str(perception.get("parsed_content", {}).get("input_type", "text")),
            "detected_language": str(perception.get("detected_language", "")),
            "confidence": str(perception.get("confidence", 1.0)),
            "sensitivity_level": str(meta.get("sensitivity_level", 0)),
            "injection_detected": str(meta.get("injection_detected", False)),
            "truncated": str(meta.get("truncated", False)),
        }

    @staticmethod
    def _extract_tool_metadata(data: Dict[str, Any]) -> Dict[str, str]:
        """从工具节点更新数据中提取元数据。"""
        messages = data.get("messages", [])
        metadata: Dict[str, str] = {"tool_count": str(len(messages))}

        for msg in messages:
            if hasattr(msg, "name") and msg.name:
                metadata["tool_name"] = msg.name
            if hasattr(msg, "content") and msg.content:
                metadata["tool_status"] = "success"

        return metadata

    @staticmethod
    def _extract_agent_metadata(data: Dict[str, Any]) -> Dict[str, str]:
        """从推理节点更新数据中提取元数据。"""
        messages = data.get("messages", [])
        has_tool_calls = False

        for msg in messages:
            if hasattr(msg, "tool_calls") and msg.tool_calls:
                has_tool_calls = True
                break

        return {
            "has_tools": str(has_tool_calls),
            "message_count": str(len(messages)),
        }
