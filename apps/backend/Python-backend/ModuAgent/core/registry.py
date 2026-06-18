from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from core.interfaces.action import BaseActionExecutor, BaseTool
from core.interfaces.feedback import BaseEvolutionSignal, BaseFeedbackLoop
from core.interfaces.memory import BaseMemory, BaseStorageAdapter
from core.interfaces.perception import BasePerception, BaseSensor
from core.interfaces.reasoning import BaseReasoningEngine, BaseReasoningStrategy

logger = logging.getLogger(__name__)


class ComponentRegistry:
    def __init__(self):
        self._reasoning_engines: Dict[str, BaseReasoningEngine] = {}
        self._reasoning_strategies: Dict[str, BaseReasoningStrategy] = {}
        self._action_executors: Dict[str, BaseActionExecutor] = {}
        self._tools: Dict[str, BaseTool] = {}
        self._memories: Dict[str, BaseMemory] = {}
        self._storage_adapters: Dict[str, BaseStorageAdapter] = {}
        self._perceptions: Dict[str, BasePerception] = {}
        self._sensors: Dict[str, BaseSensor] = {}
        self._feedback_loops: Dict[str, BaseFeedbackLoop] = {}
        self._evolution_signals: Dict[str, BaseEvolutionSignal] = {}

    def register_reasoning_engine(self, name: str, engine: BaseReasoningEngine) -> None:
        if not isinstance(engine, BaseReasoningEngine):
            raise TypeError(f"engine must implement BaseReasoningEngine, got {type(engine)}")
        self._reasoning_engines[name] = engine
        logger.info("Registered reasoning engine: %s", name)

    def get_reasoning_engine(self, name: str) -> Optional[BaseReasoningEngine]:
        return self._reasoning_engines.get(name)

    def get_active_reasoning_engine(self) -> Optional[BaseReasoningEngine]:
        if not self._reasoning_engines:
            return None
        return next(iter(self._reasoning_engines.values()))

    def register_reasoning_strategy(self, name: str, strategy: BaseReasoningStrategy) -> None:
        if not isinstance(strategy, BaseReasoningStrategy):
            raise TypeError(f"strategy must implement BaseReasoningStrategy, got {type(strategy)}")
        self._reasoning_strategies[name] = strategy
        logger.info("Registered reasoning strategy: %s", name)

    def get_reasoning_strategy(self, name: str) -> Optional[BaseReasoningStrategy]:
        return self._reasoning_strategies.get(name)

    def register_action_executor(self, name: str, executor: BaseActionExecutor) -> None:
        if not isinstance(executor, BaseActionExecutor):
            raise TypeError(f"executor must implement BaseActionExecutor, got {type(executor)}")
        self._action_executors[name] = executor
        logger.info("Registered action executor: %s", name)

    def get_action_executor(self, name: str) -> Optional[BaseActionExecutor]:
        return self._action_executors.get(name)

    def register_tool(self, tool: BaseTool) -> None:
        if not isinstance(tool, BaseTool):
            raise TypeError(f"tool must implement BaseTool, got {type(tool)}")
        tool_name = tool.name()
        self._tools[tool_name] = tool
        logger.info("Registered tool: %s", tool_name)

    def get_tool(self, name: str) -> Optional[BaseTool]:
        return self._tools.get(name)

    def list_tools(self) -> Dict[str, Dict[str, Any]]:
        return {
            name: {
                "name": tool.name(),
                "description": tool.description(),
                "parameters_schema": tool.parameters_schema(),
            }
            for name, tool in self._tools.items()
        }

    def register_memory(self, name: str, memory: BaseMemory) -> None:
        if not isinstance(memory, BaseMemory):
            raise TypeError(f"memory must implement BaseMemory, got {type(memory)}")
        self._memories[name] = memory
        logger.info("Registered memory: %s", name)

    def get_memory(self, name: str) -> Optional[BaseMemory]:
        return self._memories.get(name)

    def register_storage_adapter(self, name: str, adapter: BaseStorageAdapter) -> None:
        if not isinstance(adapter, BaseStorageAdapter):
            raise TypeError(f"adapter must implement BaseStorageAdapter, got {type(adapter)}")
        self._storage_adapters[name] = adapter
        logger.info("Registered storage adapter: %s", name)

    def get_storage_adapter(self, name: str) -> Optional[BaseStorageAdapter]:
        return self._storage_adapters.get(name)

    def register_perception(self, name: str, perception: BasePerception) -> None:
        if not isinstance(perception, BasePerception):
            raise TypeError(f"perception must implement BasePerception, got {type(perception)}")
        self._perceptions[name] = perception
        logger.info("Registered perception: %s", name)

    def get_perception(self, name: str) -> Optional[BasePerception]:
        return self._perceptions.get(name)

    def register_sensor(self, name: str, sensor: BaseSensor) -> None:
        if not isinstance(sensor, BaseSensor):
            raise TypeError(f"sensor must implement BaseSensor, got {type(sensor)}")
        self._sensors[name] = sensor
        logger.info("Registered sensor: %s", name)

    def get_sensor(self, name: str) -> Optional[BaseSensor]:
        return self._sensors.get(name)

    def register_feedback_loop(self, name: str, loop: BaseFeedbackLoop) -> None:
        if not isinstance(loop, BaseFeedbackLoop):
            raise TypeError(f"loop must implement BaseFeedbackLoop, got {type(loop)}")
        self._feedback_loops[name] = loop
        logger.info("Registered feedback loop: %s", name)

    def get_feedback_loop(self, name: str) -> Optional[BaseFeedbackLoop]:
        return self._feedback_loops.get(name)

    def register_evolution_signal(self, name: str, signal: BaseEvolutionSignal) -> None:
        if not isinstance(signal, BaseEvolutionSignal):
            raise TypeError(f"signal must implement BaseEvolutionSignal, got {type(signal)}")
        self._evolution_signals[name] = signal
        logger.info("Registered evolution signal: %s", name)

    def get_evolution_signal(self, name: str) -> Optional[BaseEvolutionSignal]:
        return self._evolution_signals.get(name)

    def swap_component(self, category: str, name: str, component: Any) -> bool:
        registries = {
            "reasoning_engine": self._reasoning_engines,
            "reasoning_strategy": self._reasoning_strategies,
            "action_executor": self._action_executors,
            "tool": self._tools,
            "memory": self._memories,
            "storage_adapter": self._storage_adapters,
            "perception": self._perceptions,
            "sensor": self._sensors,
            "feedback_loop": self._feedback_loops,
            "evolution_signal": self._evolution_signals,
        }
        registry = registries.get(category)
        if registry is None:
            logger.error("Unknown component category: %s", category)
            return False
        registry[name] = component
        logger.info("Swapped %s component: %s", category, name)
        return True

    def list_all(self) -> Dict[str, list]:
        return {
            "reasoning_engines": list(self._reasoning_engines.keys()),
            "reasoning_strategies": list(self._reasoning_strategies.keys()),
            "action_executors": list(self._action_executors.keys()),
            "tools": list(self._tools.keys()),
            "memories": list(self._memories.keys()),
            "storage_adapters": list(self._storage_adapters.keys()),
            "perceptions": list(self._perceptions.keys()),
            "sensors": list(self._sensors.keys()),
            "feedback_loops": list(self._feedback_loops.keys()),
            "evolution_signals": list(self._evolution_signals.keys()),
        }


_registry: Optional[ComponentRegistry] = None


def get_registry() -> ComponentRegistry:
    global _registry
    if _registry is None:
        _registry = ComponentRegistry()
    return _registry
