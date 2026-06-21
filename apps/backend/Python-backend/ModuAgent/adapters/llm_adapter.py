from __future__ import annotations

import logging
from typing import Any, Dict, Generator, List, Optional, Tuple

from core.interfaces.reasoning import BaseReasoningEngine
from core.registry import get_registry

logger = logging.getLogger(__name__)


class LLMAdapter:
    def __init__(self, engine_name: Optional[str] = None):
        self._engine_name = engine_name
        self._engine: Optional[BaseReasoningEngine] = None

    @property
    def engine(self) -> Optional[BaseReasoningEngine]:
        if self._engine is None:
            registry = get_registry()
            if self._engine_name:
                self._engine = registry.get_reasoning_engine(self._engine_name)
            else:
                self._engine = registry.get_active_reasoning_engine()
        return self._engine

    def set_engine(self, name: str) -> None:
        self._engine_name = name
        self._engine = None
        logger.info("LLM adapter switched to engine: %s", name)

    def generate(
        self,
        prompt: str,
        context: Dict[str, Any],
        temperature: float = 0.7,
        max_tokens: int = 512,
    ) -> Tuple[str, Dict[str, int], List[Dict[str, Any]]]:
        if self.engine is None:
            raise RuntimeError("No reasoning engine available")
        if "trace_id" not in context:
            raise ValueError("context must contain trace_id")
        if "session_id" not in context:
            raise ValueError("context must contain session_id")
        return self.engine.reason(
            prompt=prompt,
            context=context,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    def stream(
        self,
        prompt: str,
        context: Dict[str, Any],
    ) -> Generator[str, None, None]:
        if self.engine is None:
            raise RuntimeError("No reasoning engine available")
        if "trace_id" not in context:
            raise ValueError("context must contain trace_id")
        if "session_id" not in context:
            raise ValueError("context must contain session_id")
        yield from self.engine.stream(
            prompt=prompt,
            context=context,
        )
