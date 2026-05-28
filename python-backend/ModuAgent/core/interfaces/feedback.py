from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional


class BaseFeedbackLoop(ABC):
    @abstractmethod
    def evaluate(
        self,
        output: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        pass

    @abstractmethod
    def should_evolve(
        self,
        metrics: Dict[str, float],
        threshold: float,
    ) -> bool:
        pass


class BaseEvolutionSignal(ABC):
    @abstractmethod
    def signal_type(self) -> str:
        pass

    @abstractmethod
    def generate(
        self,
        source: str,
        metrics: Dict[str, float],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        pass
