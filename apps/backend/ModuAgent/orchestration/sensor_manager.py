"""Sensor 生命周期管理（从 Coordinator 提取）。

负责注册表中的 BaseSensor 实例的启动/停止/循环调度，
将传感器捕获的数据通过 EventBus 发布为 PERCEPTION 域事件。

P0-2: 从 orchestration/coordinator.py 提取，coordinator 删除后由本模块承接。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

from core.interfaces.perception import BaseSensor
from core.registry import get_registry
from orchestration.communication.message_bus import get_event_bus
from orchestration.communication.protocol import (
    AgentEvent,
    EventAction,
    EventDomain,
)

logger = logging.getLogger(__name__)


class SensorManager:
    """传感器生命周期管理器。

    通过 registry 查找 BaseSensor 实例，后台异步运行采集循环，
    将捕获的数据发布为 EventBus 事件。
    """

    def __init__(self, registry: Any = None, event_bus: Any = None) -> None:
        self._registry = registry or get_registry()
        self._event_bus = event_bus or get_event_bus()
        self._sensor_tasks: Dict[str, asyncio.Task] = {}

    async def start_sensors(self, sensor_names: List[str]) -> None:
        """启动指定的传感器，后台异步运行。

        传感器捕获的数据通过 EventBus 发布为 PERCEPTION 域事件。
        """
        for name in sensor_names:
            if name in self._sensor_tasks:
                logger.warning("Sensor '%s' already running", name)
                continue

            sensor = self._registry.get_sensor(name)
            if sensor is None:
                logger.warning("Sensor '%s' not registered, skipping", name)
                continue

            self._sensor_tasks[name] = asyncio.create_task(
                self._run_sensor(name, sensor)
            )
            logger.info("Started sensor: %s", name)

    async def stop_sensors(self, sensor_names: Optional[List[str]] = None) -> None:
        """停止指定的传感器，未指定则停止全部。"""
        names = sensor_names or list(self._sensor_tasks.keys())
        for name in names:
            task = self._sensor_tasks.pop(name, None)
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                logger.info("Stopped sensor: %s", name)

    async def _run_sensor(self, name: str, sensor: BaseSensor) -> None:
        """传感器运行循环：定时捕获并发布事件。"""
        logger.info("Sensor '%s' (type=%s) started", name, sensor.sensor_type())
        try:
            while True:
                try:
                    raw_data = sensor.capture({"user_id": "system"})
                    if raw_data:
                        event = AgentEvent(
                            trace_id=f"sensor_{name}",
                            session_id="sensor",
                            user_id="system",
                            domain=EventDomain.PERCEPTION,
                            action=EventAction.ANALYZE_SCENE,
                            payload=raw_data,
                            metadata={
                                "sensor_name": name,
                                "sensor_type": sensor.sensor_type(),
                                "data_size": str(len(raw_data)),
                            },
                        )
                        await self._event_bus.publish(event)
                except Exception as e:
                    logger.error("Sensor '%s' capture error: %s", name, str(e))

                await asyncio.sleep(1.0)  # 采集间隔
        except asyncio.CancelledError:
            logger.info("Sensor '%s' cancelled", name)
            raise
