from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Generator, List, Optional


class BaseReasoningEngine(ABC):
    @abstractmethod
    def reason(
        self,
        prompt: str,
        context: Dict[str, Any],
        **kwargs,
    ) -> str:
        pass

    @abstractmethod
    def stream(
        self,
        prompt: str,
        context: Dict[str, Any],
    ) -> Generator[str, None, None]:
        pass


class BaseReasoningStrategy(ABC):
    @abstractmethod
    def name(self) -> str:
        pass

    @abstractmethod
    def select_engine(self, context: Dict[str, Any]) -> BaseReasoningEngine:
        pass

    @abstractmethod
    def should_fallback(self, error: Optional[Exception] = None) -> bool:
        pass
