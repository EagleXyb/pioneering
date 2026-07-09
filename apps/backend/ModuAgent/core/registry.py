from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Dict, Iterator, Optional

from core.interfaces.action import BaseActionExecutor, BaseTool
from core.interfaces.feedback import BaseEvolutionSignal, BaseFeedbackLoop
from core.interfaces.memory import BaseMemory, BaseStorageAdapter
from core.interfaces.perception import BasePerception, BaseSensor
from core.interfaces.reasoning import BaseReasoningEngine, BaseReasoningStrategy
from core.interfaces.skill import BaseSkill

logger = logging.getLogger(__name__)


class ComponentRegistry:
    def __init__(self):
        self._reasoning_engines: Dict[str, BaseReasoningEngine] = {}
        # P2-8: 显式追踪活跃推理引擎名称，避免依赖 dict 插入顺序导致多引擎时选择不确定
        self._active_reasoning_engine_name: Optional[str] = None
        self._reasoning_strategies: Dict[str, BaseReasoningStrategy] = {}
        self._action_executors: Dict[str, BaseActionExecutor] = {}
        self._tools: Dict[str, BaseTool] = {}
        self._memories: Dict[str, BaseMemory] = {}
        self._storage_adapters: Dict[str, BaseStorageAdapter] = {}
        self._perceptions: Dict[str, BasePerception] = {}
        self._sensors: Dict[str, BaseSensor] = {}
        self._feedback_loops: Dict[str, BaseFeedbackLoop] = {}
        self._evolution_signals: Dict[str, BaseEvolutionSignal] = {}
        # P1: Skills 扩展（可插拔单元，内部工具注册进 _tools）
        self._skills: Dict[str, BaseSkill] = {}

    def register_reasoning_engine(self, name: str, engine: BaseReasoningEngine) -> None:
        if not isinstance(engine, BaseReasoningEngine):
            raise TypeError(f"engine must implement BaseReasoningEngine, got {type(engine)}")
        self._reasoning_engines[name] = engine
        # P2-8: 首个注册的引擎自动成为活跃引擎，后续可通过 set_active_reasoning_engine 切换
        if self._active_reasoning_engine_name is None:
            self._active_reasoning_engine_name = name
        logger.info("Registered reasoning engine: %s", name)

    def set_active_reasoning_engine(self, name: str) -> None:
        """P2-8: 显式设置活跃推理引擎。

        Args:
            name: 已注册的引擎名称

        Raises:
            KeyError: 当 name 未注册时
        """
        if name not in self._reasoning_engines:
            raise KeyError(f"reasoning engine '{name}' not registered")
        self._active_reasoning_engine_name = name
        logger.info("Set active reasoning engine: %s", name)

    def get_reasoning_engine(self, name: str) -> Optional[BaseReasoningEngine]:
        return self._reasoning_engines.get(name)

    def get_active_reasoning_engine(self) -> Optional[BaseReasoningEngine]:
        """P2-8: 返回活跃推理引擎。

        优先返回通过 ``set_active_reasoning_engine`` 显式指定的引擎；
        若未显式指定则回退到首个注册引擎（保持单引擎场景的兼容性）。
        """
        if not self._reasoning_engines:
            return None
        active_name = self._active_reasoning_engine_name
        if active_name and active_name in self._reasoning_engines:
            return self._reasoning_engines[active_name]
        # 回退：返回首个注册引擎（兼容未显式设置活跃引擎的场景）
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

    # ------------------------------------------------------------------
    # P1: Skills 管理
    # ------------------------------------------------------------------

    def register_skill(self, skill: BaseSkill) -> None:
        """注册 Skill（可插拔核心）。

        注册时自动把 Skill 内含工具也注册进 ``_tools``，
        使 Skill 工具经统一 ``build_langchain_tools`` 通路进入图。

        Args:
            skill: 实现 BaseSkill 的实例

        Raises:
            TypeError: 当 skill 未实现 BaseSkill 时
        """
        if not isinstance(skill, BaseSkill):
            raise TypeError(f"skill must implement BaseSkill, got {type(skill)}")
        if not skill.is_available():
            logger.warning("Skill '%s' unavailable (is_available=False), skipped", skill.name())
            return
        self._skills[skill.name()] = skill
        # 自动注册 Skill 内含工具（可插拔关键：Skill 注册即工具就位）
        # 工具经 SkillToolWrapper 包装，落实执行隔离（P5 降级机制）
        for tool in skill.tools():
            if tool.name() in self._tools:
                logger.warning(
                    "Skill '%s' tool '%s' name conflicts with existing tool, skipping tool",
                    skill.name(), tool.name(),
                )
                continue
            try:
                from skills.adapter import SkillToolWrapper
                self.register_tool(SkillToolWrapper(tool, skill_name=skill.name()))
            except Exception:  # noqa: BLE001 - 包装失败则退回原始工具
                self.register_tool(tool)
        logger.info(
            "Registered skill: %s (tools=%d)", skill.name(), len(skill.tools())
        )

    def get_skill(self, name: str) -> Optional[BaseSkill]:
        return self._skills.get(name)

    def list_skills(self) -> Dict[str, Dict[str, Any]]:
        return {
            name: {
                "name": s.name(),
                "description": s.description(),
                "version": s.version(),
                "tags": s.tags(),
                "tool_count": len(s.tools()),
            }
            for name, s in self._skills.items()
        }

    def unregister_skill(self, name: str) -> bool:
        if name in self._skills:
            del self._skills[name]
            logger.info("Unregistered skill: %s", name)
            return True
        return False

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
            "skill": self._skills,
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
            "skills": list(self._skills.keys()),
        }


_registry: Optional[ComponentRegistry] = None


def get_registry(override: Optional[ComponentRegistry] = None) -> ComponentRegistry:
    """获取全局 ComponentRegistry 单例。

    P2-1: 新增 `override` 参数用于测试隔离。
    ComponentRegistry 本身支持非全局实例化（可直接 `ComponentRegistry()` 创建），
    测试中可构造专属实例后通过 override 注入。
    生产代码不应使用此参数；测试在 teardown 中应调用 `reset_registry()` 清理。

    Args:
        override: 测试时注入的实例。若提供，将替换全局单例并返回。

    Returns:
        全局 ComponentRegistry 实例
    """
    global _registry
    if override is not None:
        _registry = override
    if _registry is None:
        _registry = ComponentRegistry()
    return _registry


def reset_registry() -> None:
    """重置全局 registry 单例（测试清理用）。"""
    global _registry
    _registry = None


@contextmanager
def override_registry(registry: ComponentRegistry) -> Iterator[ComponentRegistry]:
    """P2-1: 测试用上下文管理器——临时替换全局 registry 单例，退出时自动恢复。"""
    global _registry
    old = _registry
    _registry = registry
    try:
        yield _registry
    finally:
        _registry = old
