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
"""

from __future__ import annotations

import logging
from typing import Any, AsyncGenerator, Dict, Optional

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


class LangGraphEventBridge:
    """将 LangGraph stream 事件桥接到现有 EventBus。

    保留现有 EventBus 订阅者（PersistentEventLog、EvolutionSignalCollector）
    不受重构影响。作为 stream 消费者，同时透传原始事件供上游消费（如 SSE 输出）。

    Usage:
        bridge = LangGraphEventBridge()
        async for event in bridge.consume(graph.astream(...)):
            # event 透传给上游 SSE / AG-UI 适配器
            yield event
    """

    def __init__(
        self,
        event_bus: Optional[EventBus] = None,
        trace_id: str = "",
        session_id: str = "",
        user_id: str = "",
    ) -> None:
        """初始化事件桥接器。

        Args:
            event_bus: 事件总线（默认使用全局单例）
            trace_id: 链路追踪 ID
            session_id: 会话 ID
            user_id: 用户 ID
        """
        self._event_bus = event_bus or get_event_bus()
        self._trace_id = trace_id
        self._session_id = session_id
        self._user_id = user_id
        self._token_count = 0

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
            agent_event = self._map_to_agent_event(event)
            if agent_event:
                try:
                    await self._event_bus.publish(agent_event)
                except Exception as e:
                    logger.error("EventBus publish error: %s", str(e))
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
