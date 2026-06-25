from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class BaseMemory(ABC):
    @abstractmethod
    def query(
        self,
        user_id: str,
        context_window: str,
        required_fields: List[str],
    ) -> Dict[str, Any]:
        pass

    @abstractmethod
    def update(
        self,
        user_id: str,
        new_data: Dict[str, Any],
        metadata: Dict[str, Any],
    ) -> bool:
        pass


class BaseStorageAdapter(ABC):
    @abstractmethod
    def adapter_type(self) -> str:
        pass

    @abstractmethod
    def load(self, key: str) -> Optional[Dict[str, Any]]:
        pass

    @abstractmethod
    def save(self, key: str, data: Dict[str, Any]) -> bool:
        pass
