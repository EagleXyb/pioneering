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


class EvolutionSignalCollector:
    """进化信号收集器（P1：事件追踪 + 进化信号联动）。

    订阅感知事件，收集进化信号指标：
    - 低置信度频率（感知准确度信号）
    - 敏感词触发频率（安全风险信号）
    - 截断频率（输入质量信号）
    - 语种分布（用户群体信号）
    - 多模态输入比例（模态使用信号）

    定期输出信号摘要，供进化系统消费。
    """

    def __init__(self, report_interval: int = 100) -> None:
        """初始化进化信号收集器。

        Args:
            report_interval: 每处理 N 个事件输出一次信号摘要
        """
        self._report_interval = report_interval
        self._event_count = 0
        self._signals: Dict[str, Any] = {
            "total_perceptions": 0,
            "low_confidence_count": 0,
            "sensitivity_triggered": {str(i): 0 for i in range(6)},
            "truncation_count": 0,
            "language_distribution": {},
            "input_type_distribution": {},
            "injection_detected_count": 0,
            "pii_detected_count": 0,
            "avg_confidence": 0.0,
        }
        self._confidence_sum = 0.0
        self._signal_handlers: List[Callable[[Dict[str, Any]], None]] = []

    def add_signal_handler(self, handler: Callable[[Dict[str, Any]], None]) -> None:
        """注册信号处理器，当信号摘要生成时被调用。"""
        self._signal_handlers.append(handler)

    async def on_perception_event(self, event: AgentEvent) -> None:
        """感知事件回调：收集进化信号。"""
        if event.domain != EventDomain.PERCEPTION:
            return

        self._event_count += 1
        self._signals["total_perceptions"] += 1

        metadata = event.metadata

        # 置信度统计
        confidence = float(metadata.get("confidence", "1.0"))
        self._confidence_sum += confidence
        self._signals["avg_confidence"] = round(self._confidence_sum / self._event_count, 3)

        if confidence < 0.5:
            self._signals["low_confidence_count"] += 1

        # 敏感度统计
        sensitivity = metadata.get("sensitivity_level", "0")
        if sensitivity in self._signals["sensitivity_triggered"]:
            self._signals["sensitivity_triggered"][sensitivity] += 1

        # 截断统计
        if metadata.get("truncated", "False") == "True":
            self._signals["truncation_count"] += 1

        # 语种分布
        language = metadata.get("detected_language", "unknown")
        lang_dist = self._signals["language_distribution"]
        lang_dist[language] = lang_dist.get(language, 0) + 1

        # 输入类型分布
        input_type = metadata.get("input_type", "text")
        type_dist = self._signals["input_type_distribution"]
        type_dist[input_type] = type_dist.get(input_type, 0) + 1

        # 安全检测统计
        if metadata.get("injection_detected", "False") == "True":
            self._signals["injection_detected_count"] += 1
        if metadata.get("pii_detected", "False") == "True":
            self._signals["pii_detected_count"] += 1

        # 定期输出信号摘要
        if self._event_count % self._report_interval == 0:
            self._emit_signals()

    def _emit_signals(self) -> None:
        """输出进化信号摘要。"""
        signal_snapshot = dict(self._signals)
        signal_snapshot["snapshot_at"] = self._event_count
        logger.info("Evolution signals: %s", signal_snapshot)

        for handler in self._signal_handlers:
            try:
                handler(signal_snapshot)
            except Exception as e:
                logger.warning("Signal handler error: %s", str(e))

    def get_signals(self) -> Dict[str, Any]:
        """获取当前信号摘要。"""
        return dict(self._signals)


_event_bus: Optional[EventBus] = None


def get_event_bus() -> EventBus:
    global _event_bus
    if _event_bus is None:
        _event_bus = EventBus()
    return _event_bus
