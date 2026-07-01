"""EventBus 单元测试（P2-4）。

覆盖：
    - subscribe/publish 基本流程
    - domain 过滤
    - handler 异常隔离
    - request/response 模式
    - P2-2: 内存日志已移除（get_event_log/clear_log 不存在）
    - P2-1: override 参数与 context manager
"""
import asyncio

import pytest

from orchestration.communication.message_bus import (
    EventBus,
    get_event_bus,
    reset_event_bus,
    override_event_bus,
)
from orchestration.communication.protocol import (
    AgentEvent,
    EventAction,
    EventDomain,
    EventPriority,
)


def _make_event(
    domain: str = EventDomain.PERCEPTION,
    action: str = EventAction.ANALYZE,
    session_id: str = "test-session",
    user_id: str = "test-user",
    metadata: dict | None = None,
) -> AgentEvent:
    return AgentEvent(
        domain=domain,
        action=action,
        session_id=session_id,
        user_id=user_id,
        priority=EventPriority.NORMAL,
        metadata=metadata or {},
    )


class TestSubscribePublish:
    async def test_publish_invokes_subscribed_handler(self):
        bus = EventBus()
        received = []

        async def handler(event):
            received.append(event)

        bus.subscribe(handler)
        event = _make_event()
        await bus.publish(event)
        assert len(received) == 1
        assert received[0] is event

    async def test_unsubscribe_stops_receiving(self):
        bus = EventBus()
        received = []

        async def handler(event):
            received.append(event)

        unsub = bus.subscribe(handler)
        await bus.publish(_make_event())
        assert len(received) == 1

        unsub()
        await bus.publish(_make_event())
        assert len(received) == 1  # 不再接收

    async def test_domain_filter(self):
        bus = EventBus()
        perception_events = []
        memory_events = []

        async def perception_handler(event):
            perception_events.append(event)

        async def memory_handler(event):
            memory_events.append(event)

        bus.subscribe(perception_handler, domain=EventDomain.PERCEPTION)
        bus.subscribe(memory_handler, domain=EventDomain.MEMORY)

        await bus.publish(_make_event(domain=EventDomain.PERCEPTION))
        await bus.publish(_make_event(domain=EventDomain.MEMORY))

        assert len(perception_events) == 1
        assert len(memory_events) == 1

    async def test_action_filter(self):
        bus = EventBus()
        analyze_events = []

        async def handler(event):
            analyze_events.append(event)

        bus.subscribe(handler, domain=EventDomain.PERCEPTION, action=EventAction.ANALYZE)

        await bus.publish(_make_event(action=EventAction.ANALYZE))
        await bus.publish(_make_event(action=EventAction.GENERATE))

        assert len(analyze_events) == 1

    async def test_handler_exception_isolated(self):
        bus = EventBus()
        ok_received = []

        async def bad_handler(event):
            raise RuntimeError("intentional")

        async def good_handler(event):
            ok_received.append(event)

        bus.subscribe(bad_handler)
        bus.subscribe(good_handler)

        # 不应抛异常
        await bus.publish(_make_event())
        assert len(ok_received) == 1


class TestRequestResponse:
    async def test_request_returns_response(self):
        bus = EventBus()

        async def responder(event):
            # 收到 request 事件后立即发布 response
            resp = AgentEvent(
                domain=event.domain,
                action=f"{event.action}_response",
                session_id=event.session_id,
                user_id=event.user_id,
                priority=EventPriority.NORMAL,
                metadata={"request_id": event.event_id, "result": "ok"},
            )
            await bus.publish(resp)

        bus.subscribe(responder, domain=EventDomain.TOOL, action=EventAction.INVOKE)

        request_event = _make_event(
            domain=EventDomain.TOOL,
            action=EventAction.INVOKE,
        )
        response = await bus.request(request_event, timeout_ms=2000)
        assert response is not None
        assert response.metadata.get("result") == "ok"

    async def test_request_timeout_returns_none(self):
        bus = EventBus()
        # 无 handler 注册，必然超时
        request_event = _make_event(domain=EventDomain.TOOL)
        response = await bus.request(request_event, timeout_ms=100)
        assert response is None


class TestEventBusSlimmed:
    """P2-2: 验证 EventBus 已移除内存事件日志。"""

    def test_no_event_log_attribute(self):
        bus = EventBus()
        assert not hasattr(bus, "_event_log")
        assert not hasattr(bus, "_max_log_size")

    def test_no_get_event_log_method(self):
        bus = EventBus()
        assert not hasattr(bus, "get_event_log")

    def test_no_clear_log_method(self):
        bus = EventBus()
        assert not hasattr(bus, "clear_log")


class TestOverrideAndReset:
    def test_get_event_bus_returns_singleton(self):
        reset_event_bus()
        e1 = get_event_bus()
        e2 = get_event_bus()
        assert e1 is e2

    def test_override_replaces_singleton(self):
        reset_event_bus()
        original = get_event_bus()
        custom = EventBus()
        result = get_event_bus(override=custom)
        assert result is custom
        assert get_event_bus() is custom

    def test_reset_event_bus_clears_singleton(self):
        reset_event_bus()
        e1 = get_event_bus()
        reset_event_bus()
        e2 = get_event_bus()
        assert e1 is not e2

    def test_override_event_bus_context_manager(self):
        reset_event_bus()
        original = get_event_bus()
        custom = EventBus()
        with override_event_bus(custom) as ctx:
            assert ctx is custom
            assert get_event_bus() is custom
        assert get_event_bus() is original
