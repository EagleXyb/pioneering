from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import Any, Callable, Coroutine, Dict, List, Optional

from .protocol import AgentEvent, EventDomain, EventPriority

logger = logging.getLogger(__name__)

EventHandler = Callable[[AgentEvent], Coroutine[Any, Any, None]]


class Subscription:
    def __init__(
        self,
        handler: EventHandler,
        domain: Optional[str] = None,
        action: Optional[str] = None,
        priority_filter: Optional[EventPriority] = None,
    ):
        self.handler = handler
        self.domain = domain
        self.action = action
        self.priority_filter = priority_filter

    def matches(self, event: AgentEvent) -> bool:
        if self.domain and self.domain != event.domain:
            return False
        if self.action and self.action != event.action:
            return False
        if self.priority_filter and self.priority_filter != event.priority:
            return False
        return True


class EventBus:
    def __init__(self):
        self._subscriptions: List[Subscription] = []
        self._domain_index: Dict[str, List[Subscription]] = defaultdict(list)
        self._event_log: List[AgentEvent] = []
        self._max_log_size: int = 1000
        self._lock = asyncio.Lock()

    def subscribe(
        self,
        handler: EventHandler,
        domain: Optional[str] = None,
        action: Optional[str] = None,
        priority_filter: Optional[EventPriority] = None,
    ) -> Callable[[], None]:
        sub = Subscription(
            handler=handler,
            domain=domain,
            action=action,
            priority_filter=priority_filter,
        )
        self._subscriptions.append(sub)
        if domain:
            self._domain_index[domain].append(sub)

        def unsubscribe():
            if sub in self._subscriptions:
                self._subscriptions.remove(sub)
            if domain and sub in self._domain_index.get(domain, []):
                self._domain_index[domain].remove(sub)

        return unsubscribe

    async def publish(self, event: AgentEvent) -> None:
        async with self._lock:
            self._event_log.append(event)
            if len(self._event_log) > self._max_log_size:
                self._event_log = self._event_log[-self._max_log_size:]

        matched = self._domain_index.get(event.domain, self._subscriptions)
        if not matched:
            matched = self._subscriptions

        tasks = []
        for sub in matched:
            if sub.matches(event):
                tasks.append(self._safe_invoke(sub.handler, event))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _safe_invoke(self, handler: EventHandler, event: AgentEvent) -> None:
        try:
            await handler(event)
        except Exception as e:
            logger.error(
                "Event handler error: event_id=%s domain=%s action=%s error=%s",
                event.event_id,
                event.domain,
                event.action,
                str(e),
            )

    async def request(
        self,
        event: AgentEvent,
        timeout_ms: int = 5000,
    ) -> Optional[AgentEvent]:
        response_future: asyncio.Future[AgentEvent] = asyncio.get_event_loop().create_future()
        request_id = event.event_id

        async def response_handler(resp_event: AgentEvent):
            if resp_event.metadata.get("request_id") == request_id and not response_future.done():
                response_future.set_result(resp_event)

        unsub = self.subscribe(
            response_handler,
            domain=event.domain,
            action=f"{event.action}_response",
        )

        await self.publish(event)

        try:
            return await asyncio.wait_for(
                response_future,
                timeout=timeout_ms / 1000.0,
            )
        except asyncio.TimeoutError:
            logger.warning("Request timeout: event_id=%s domain=%s", request_id, event.domain)
            return None
        finally:
            unsub()

    def get_event_log(
        self,
        domain: Optional[str] = None,
        session_id: Optional[str] = None,
        limit: int = 100,
    ) -> List[AgentEvent]:
        logs = self._event_log
        if domain:
            logs = [e for e in logs if e.domain == domain]
        if session_id:
            logs = [e for e in logs if e.session_id == session_id]
        return logs[-limit:]

    def clear_log(self) -> None:
        self._event_log.clear()


_event_bus: Optional[EventBus] = None


def get_event_bus() -> EventBus:
    global _event_bus
    if _event_bus is None:
        _event_bus = EventBus()
    return _event_bus
