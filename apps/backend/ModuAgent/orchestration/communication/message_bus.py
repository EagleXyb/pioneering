from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from contextlib import contextmanager
from typing import Any, Callable, Coroutine, Dict, Iterator, List, Optional

from .protocol import AgentEvent, EventPriority

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
        # P2-2: 移除内存事件日志 _event_log/_max_log_size 及保护它的 _lock，
        # 事件持久化统一由 PersistentEventLog 订阅处理（避免双份内存开销与职责重叠）。
        # 在单线程 asyncio 事件循环中，subscribe/publish 的同步段不会被 await 之间打断，
        # 因此无需额外锁保护订阅集合。

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
        # P2-2: 不再追加到内存 _event_log，事件持久化由 PersistentEventLog 订阅处理。
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


class PersistentEventLog:
    """事件日志持久化处理器（P1：事件追踪信息完整化）。

    订阅 EventBus 的所有事件，将事件以 JSONL 格式写入文件。
    支持按 domain 过滤、文件轮转。

    设计原则：
    - 文件写入异步，不阻塞主流程
    - 文件不可用时降级为内存日志
    - 支持最大文件大小限制和轮转
    """

    def __init__(
        self,
        log_file_path: str,
        max_file_size_mb: float = 10.0,
        domains: Optional[List[str]] = None,
    ) -> None:
        """初始化持久化事件日志。

        Args:
            log_file_path: 日志文件路径（JSONL 格式）
            max_file_size_mb: 单文件最大大小（MB），超过后轮转
            domains: 仅持久化指定 domain 的事件（None=全部）
        """
        self._log_file_path = log_file_path
        self._max_file_size = int(max_file_size_mb * 1024 * 1024)
        self._domains = set(domains) if domains else None
        self._enabled = False
        self._write_queue: asyncio.Queue = asyncio.Queue()
        self._writer_task: Optional[asyncio.Task] = None

    async def start(self, event_bus: EventBus) -> None:
        """启动持久化日志：订阅事件并启动写入任务。"""
        import os
        log_dir = os.path.dirname(self._log_file_path)
        if log_dir and not os.path.exists(log_dir):
            try:
                os.makedirs(log_dir, exist_ok=True)
            except OSError as e:
                logger.warning("Cannot create log directory %s: %s", log_dir, str(e))
                return

        self._enabled = True
        event_bus.subscribe(self._on_event)
        self._writer_task = asyncio.create_task(self._writer_loop())
        logger.info("PersistentEventLog started: %s", self._log_file_path)

    async def stop(self) -> None:
        """停止持久化日志。"""
        self._enabled = False
        if self._writer_task:
            self._writer_task.cancel()
            try:
                await self._writer_task
            except asyncio.CancelledError:
                pass
            self._writer_task = None

    async def _on_event(self, event: AgentEvent) -> None:
        """事件回调：将事件放入写入队列。"""
        if not self._enabled:
            return
        if self._domains and event.domain not in self._domains:
            return
        await self._write_queue.put(event)

    async def _writer_loop(self) -> None:
        """后台写入循环：从队列取事件写入文件。"""
        import json
        import os

        while self._enabled:
            try:
                event = await asyncio.wait_for(self._write_queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            try:
                # 文件轮转检查
                if os.path.exists(self._log_file_path):
                    file_size = os.path.getsize(self._log_file_path)
                    if file_size > self._max_file_size:
                        self._rotate_log()

                # 序列化事件
                event_dict = {
                    "event_id": event.event_id,
                    "timestamp": event.timestamp,
                    "trace_id": event.trace_id,
                    "session_id": event.session_id,
                    "user_id": event.user_id,
                    "domain": event.domain,
                    "action": event.action,
                    "priority": event.priority,
                    "metadata": event.metadata,
                }
                line = json.dumps(event_dict, ensure_ascii=False) + "\n"

                with open(self._log_file_path, "a", encoding="utf-8") as f:
                    f.write(line)
            except Exception as e:
                logger.warning("Failed to write event log: %s", str(e))

    def _rotate_log(self) -> None:
        """日志文件轮转：重命名为 .1 后缀。"""
        import os
        rotated_path = self._log_file_path + ".1"
        try:
            if os.path.exists(rotated_path):
                os.unlink(rotated_path)
            os.rename(self._log_file_path, rotated_path)
            logger.info("Event log rotated: %s → %s", self._log_file_path, rotated_path)
        except OSError as e:
            logger.warning("Log rotation failed: %s", str(e))


_event_bus: Optional[EventBus] = None


def get_event_bus(override: Optional[EventBus] = None) -> EventBus:
    """获取全局 EventBus 单例。

    P2-1: 新增 `override` 参数用于测试隔离。
    生产代码不应使用此参数；测试在 teardown 中应调用 `reset_event_bus()` 清理。

    Args:
        override: 测试时注入的实例。若提供，将替换全局单例并返回。

    Returns:
        全局 EventBus 实例
    """
    global _event_bus
    if override is not None:
        _event_bus = override
    if _event_bus is None:
        _event_bus = EventBus()
    return _event_bus


def reset_event_bus() -> None:
    """重置全局 event_bus 单例（测试清理用）。"""
    global _event_bus
    _event_bus = None


@contextmanager
def override_event_bus(event_bus: EventBus) -> Iterator[EventBus]:
    """P2-1: 测试用上下文管理器——临时替换全局 event_bus 单例，退出时自动恢复。"""
    global _event_bus
    old = _event_bus
    _event_bus = event_bus
    try:
        yield _event_bus
    finally:
        _event_bus = old
