"""进化层模块包（P2-3: 补充模块导出，P0-1: 新增 EvolutionOrchestrator）。

提供组件版本管理、进化策略、回滚机制与闭环编排。
"""

from evolution.evolution_orchestrator import EvolutionOrchestrator
from evolution.registry.rollback_mechanism import RollbackMechanism
from evolution.registry.versioned_store import VersionedComponentStore
from evolution.strategy.component_swap import ComponentSwapStrategy
from evolution.strategy.parameter_tune import ParameterTuneStrategy

__all__ = [
    "EvolutionOrchestrator",
    "RollbackMechanism",
    "VersionedComponentStore",
    "ComponentSwapStrategy",
    "ParameterTuneStrategy",
]
