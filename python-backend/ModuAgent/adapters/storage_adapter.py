from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from core.interfaces.memory import BaseMemory
from core.registry import get_registry
from orchestration.communication.protocol import ErrorCode

logger = logging.getLogger(__name__)


class StorageAdapter:
    def __init__(self, memory_name: Optional[str] = None):
        self._memory_name = memory_name
        self._memory: Optional[BaseMemory] = None

    @property
    def memory(self) -> Optional[BaseMemory]:
        if self._memory is None:
            registry = get_registry()
            if self._memory_name:
                self._memory = registry.get_memory(self._memory_name)
            else:
                all_memories = registry.list_all().get("memories", [])
                if all_memories:
                    self._memory = registry.get_memory(all_memories[0])
        return self._memory

    def set_memory(self, name: str) -> None:
        self._memory_name = name
        self._memory = None
        logger.info("Storage adapter switched to memory: %s", name)

    def query(
        self,
        user_id: str,
        context_window: str,
        required_fields: List[str],
    ) -> Dict[str, Any]:
        if self.memory is None:
            return {
                "status": "error",
                "error_code": ErrorCode.MEMORY_FIELD_MISSING,
                "data": {"message": "No memory available"},
            }
        if not user_id:
            return {
                "status": "error",
                "error_code": ErrorCode.MEMORY_FIELD_MISSING,
                "data": {"message": "user_id is required"},
            }
        if not required_fields:
            return {
                "status": "error",
                "error_code": ErrorCode.MEMORY_FIELD_MISSING,
                "data": {"message": "required_fields must be explicitly declared"},
            }
        try:
            result = self.memory.query(
                user_id=user_id,
                context_window=context_window,
                required_fields=required_fields,
            )
            return {"status": "success", "error_code": "", "data": result}
        except Exception as e:
            logger.error("Memory query error: %s", str(e))
            return {
                "status": "error",
                "error_code": ErrorCode.MEMORY_CONTEXT_EXCEEDED,
                "data": {"message": str(e)},
            }

    def update(
        self,
        user_id: str,
        new_data: Dict[str, Any],
        metadata: Dict[str, Any],
    ) -> Dict[str, Any]:
        if self.memory is None:
            return {
                "status": "error",
                "error_code": ErrorCode.MEMORY_FIELD_MISSING,
                "data": {"message": "No memory available"},
            }
        if not user_id:
            return {
                "status": "error",
                "error_code": ErrorCode.MEMORY_FIELD_MISSING,
                "data": {"message": "user_id is required"},
            }
        try:
            success = self.memory.update(
                user_id=user_id,
                new_data=new_data,
                metadata=metadata,
            )
            return {
                "status": "success" if success else "error",
                "error_code": "",
                "data": {"updated": success},
            }
        except Exception as e:
            logger.error("Memory update error: %s", str(e))
            return {
                "status": "error",
                "error_code": ErrorCode.MEMORY_CONTEXT_EXCEEDED,
                "data": {"message": str(e)},
            }
