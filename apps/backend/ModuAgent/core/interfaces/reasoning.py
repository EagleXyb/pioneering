from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Generator, List, Optional, Tuple


class BaseReasoningEngine(ABC):
    @abstractmethod
    def reason(
        self,
        prompt: str,
        context: Dict[str, Any],
        **kwargs,
    ) -> Tuple[str, Dict[str, int], List[Dict[str, Any]]]:
        """返回 (content, usage, tool_calls)。

        tool_calls 为原生 function calling 解析结果，格式:
            [{"tool": "<name>", "parameters": {<params>}}, ...]
        无工具调用时返回空列表。
        """
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
