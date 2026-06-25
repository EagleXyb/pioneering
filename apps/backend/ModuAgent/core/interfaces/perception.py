from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional


class BasePerception(ABC):
    @abstractmethod
    def perceive(
        self,
        input_type: str,
        raw_content: bytes,
        language: Optional[str] = None,
        sensitivity_level: int = 0,
    ) -> Dict[str, Any]:
        pass


class BaseSensor(ABC):
    @abstractmethod
    def sensor_type(self) -> str:
        pass

    @abstractmethod
    def capture(self, context: Dict[str, Any]) -> bytes:
        pass
