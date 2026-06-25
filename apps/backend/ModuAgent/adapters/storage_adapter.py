from __future__ import annotations

import logging
import time
import uuid
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

    def _get_memory_by_name(self, name: str) -> Optional[BaseMemory]:
        return get_registry().get_memory(name)

    def query_all(
        self,
        user_id: str,
        context_window: str,
        required_fields: List[str],
        query_text: str = "",
        short_term_name: str = "short_term",
        long_term_name: str = "long_term",
    ) -> Dict[str, Any]:
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

        history: List[Dict[str, Any]] = []
        knowledge: List[Dict[str, Any]] = []

        short_term = self._get_memory_by_name(short_term_name)
        if short_term is not None:
            try:
                st_result = short_term.query(
                    user_id=user_id,
                    context_window=context_window,
                    required_fields=required_fields,
                )
                history = st_result.get("history", [])
            except Exception as e:
                logger.error("Short-term memory query error: %s", str(e))
        else:
            logger.warning("Short-term memory '%s' not registered", short_term_name)

        long_term = self._get_memory_by_name(long_term_name)
        if long_term is not None and query_text:
            try:
                lt_result = long_term.query(
                    user_id=user_id,
                    context_window=query_text,
                    required_fields=required_fields,
                )
                knowledge = lt_result.get("results", [])
            except Exception as e:
                logger.error("Long-term memory query error: %s", str(e))
        elif long_term is None:
            logger.warning("Long-term memory '%s' not registered", long_term_name)

        return {
            "status": "success",
            "error_code": "",
            "data": {
                "history": history,
                "knowledge": knowledge,
            },
        }

    def update_all(
        self,
        user_id: str,
        new_data: Dict[str, Any],
        metadata: Dict[str, Any],
        short_term_name: str = "short_term",
        long_term_name: str = "long_term",
    ) -> Dict[str, Any]:
        if not user_id:
            return {
                "status": "error",
                "error_code": ErrorCode.MEMORY_FIELD_MISSING,
                "data": {"message": "user_id is required"},
            }

        st_success = False
        lt_success = False

        short_term = self._get_memory_by_name(short_term_name)
        if short_term is not None:
            try:
                st_success = short_term.update(
                    user_id=user_id,
                    new_data=new_data,
                    metadata=metadata,
                )
            except Exception as e:
                logger.error("Short-term memory update error: %s", str(e))
        else:
            logger.warning("Short-term memory '%s' not registered", short_term_name)

        long_term = self._get_memory_by_name(long_term_name)
        if long_term is not None:
            try:
                vectorization_text = self._build_vectorization_text(new_data)
                if vectorization_text:
                    lt_metadata = dict(metadata)
                    lt_metadata.setdefault("doc_id", str(uuid.uuid4()))
                    lt_metadata.setdefault("created_at", int(time.time()))
                    lt_metadata["source_type"] = "conversation"
                    lt_success = long_term.update(
                        user_id=user_id,
                        new_data={"text": vectorization_text},
                        metadata=lt_metadata,
                    )
            except Exception as e:
                logger.error("Long-term memory update error: %s", str(e))
        else:
            logger.warning("Long-term memory '%s' not registered", long_term_name)

        overall_success = st_success or lt_success
        return {
            "status": "success" if overall_success else "error",
            "error_code": "",
            "data": {
                "short_term_updated": st_success,
                "long_term_updated": lt_success,
            },
        }

    @staticmethod
    def _build_vectorization_text(new_data: Dict[str, Any]) -> str:
        parts: List[str] = []

        prompt = new_data.get("prompt", "")
        if prompt:
            parts.append(f"User: {prompt}")

        tool_calls = new_data.get("tool_calls", [])
        for tc in tool_calls:
            tool_name = tc.get("tool", "")
            tool_result = tc.get("result", {})
            if tool_name:
                parts.append(f"Tool[{tool_name}]: {tool_result}")

        response = new_data.get("response", "")
        if response:
            parts.append(f"Assistant: {response}")

        return "\n".join(parts)

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
