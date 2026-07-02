from __future__ import annotations

import json
import logging
from typing import Any, AsyncGenerator, Dict, Generator, List, Optional, Tuple

import httpx

from core.interfaces.reasoning import BaseReasoningEngine

logger = logging.getLogger(__name__)


class BaseLLMReasoner(BaseReasoningEngine):
    def __init__(
        self,
        api_key: str,
        base_url: str,
        default_model: str,
        timeout: float = 120.0,
        system_prompt: Optional[str] = None,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._default_model = default_model
        self._timeout = timeout
        self._system_prompt = system_prompt
        # P2-12.3.1: 复用 httpx 连接池，避免每次调用创建/销毁 Client 的开销
        self._client = httpx.Client(timeout=self._timeout)
        self._async_client = httpx.AsyncClient(timeout=self._timeout)

    def close(self) -> None:
        """释放底层 httpx 连接池资源。"""
        try:
            self._client.close()
        except Exception:
            pass
        try:
            # AsyncClient.close 是协程，但在销毁场景下用同步关闭避免悬挂
            self._async_client.aclose()
        except Exception:
            pass

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass

    def _resolve_temperature(self, kwargs: Dict[str, Any]) -> float:
        """P1-5: temperature 默认值从 RuntimeConfig 读取，kwargs 优先覆盖。

        解析优先级：显式 kwargs > RuntimeConfig(llm.temperature) > 0.7 兜底。
        使用惰性导入避免循环依赖，配置不可用时安全降级。
        """
        if "temperature" in kwargs:
            return kwargs["temperature"]
        try:
            from config.runtime_config import get_config
            return get_config().get("llm.temperature", 0.7)
        except Exception:  # noqa: BLE001
            return 0.7

    def _resolve_max_tokens(self, kwargs: Dict[str, Any]) -> int:
        """P1-5: max_tokens 默认值从 RuntimeConfig 读取，kwargs 优先覆盖。

        解析优先级：显式 kwargs > RuntimeConfig(llm.max_tokens) > 512 兜底。
        """
        if "max_tokens" in kwargs:
            return kwargs["max_tokens"]
        try:
            from config.runtime_config import get_config
            return get_config().get("llm.max_tokens", 512)
        except Exception:  # noqa: BLE001
            return 512

    @property
    def api_key(self) -> str:
        return self._api_key

    @property
    def base_url(self) -> str:
        return self._base_url

    @property
    def default_model(self) -> str:
        return self._default_model

    def reason(
        self,
        prompt: str,
        context: Dict[str, Any],
        **kwargs: Any,
    ) -> Tuple[str, Dict[str, int], List[Dict[str, Any]]]:
        """同步推理（P2-12.3.1：复用实例级 httpx 连接池）。"""
        messages = self._build_messages(prompt, context)
        temperature = self._resolve_temperature(kwargs)
        max_tokens = self._resolve_max_tokens(kwargs)
        model = kwargs.get("model", self._default_model)
        tools = context.get("native_tools") or kwargs.get("tools")

        url = f"{self._base_url}/chat/completions"
        headers = self._build_headers()
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if tools:
            payload["tools"] = tools

        # P2-12.3.1: 复用实例级连接池，不再每次创建 httpx.Client
        response = self._client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

        message = data.get("choices", [{}])[0].get("message", {})
        content = message.get("content", "") or ""
        raw_tool_calls = message.get("tool_calls", [])

        usage_data = data.get("usage", {})
        usage = {
            "prompt_tokens": usage_data.get("prompt_tokens", 0),
            "completion_tokens": usage_data.get("completion_tokens", 0),
            "total_tokens": usage_data.get("total_tokens", 0),
        }

        parsed_tool_calls: List[Dict[str, Any]] = []
        for tc in raw_tool_calls:
            try:
                func = tc.get("function", {})
                tc_name = func.get("name", "")
                args_str = func.get("arguments", "{}")
                args = json.loads(args_str) if isinstance(args_str, str) else args_str
                if tc_name:
                    parsed_tool_calls.append({"tool": tc_name, "parameters": args})
            except (json.JSONDecodeError, TypeError) as e:
                logger.warning("Failed to parse tool_call arguments: %s", e)

        logger.debug(
            "LLM response: model=%s tokens=%s tool_calls=%d",
            data.get("model", model),
            usage,
            len(parsed_tool_calls),
        )
        return content, usage, parsed_tool_calls

    def stream(
        self,
        prompt: str,
        context: Dict[str, Any],
        **kwargs: Any,
    ) -> Generator[str, None, None]:
        """同步流式推理。

        P1-12.2.5：temperature/max_tokens 不再硬编码，通过 kwargs 覆盖。
        P2-12.3.1：复用实例级 httpx 连接池。
        """
        messages = self._build_messages(prompt, context)
        temperature = self._resolve_temperature(kwargs)
        max_tokens = self._resolve_max_tokens(kwargs)
        model = kwargs.get("model", self._default_model)
        url = f"{self._base_url}/chat/completions"
        headers = self._build_headers()
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }

        # P2-12.3.1: 复用实例级连接池（stream 上下文管理器仅管理流，不复用底层连接）
        with self._client.stream("POST", url, json=payload, headers=headers) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        yield content
                except json.JSONDecodeError:
                    continue

    async def areason(
        self,
        prompt: str,
        context: Dict[str, Any],
        **kwargs: Any,
    ) -> Tuple[str, Dict[str, int], List[Dict[str, Any]]]:
        """异步推理（P2-12.3.1：复用实例级 httpx.AsyncClient 连接池）。

        与 reason() 语义等价，但在 async 环境下不占用线程池。
        """
        messages = self._build_messages(prompt, context)
        temperature = self._resolve_temperature(kwargs)
        max_tokens = self._resolve_max_tokens(kwargs)
        model = kwargs.get("model", self._default_model)
        tools = context.get("native_tools") or kwargs.get("tools")

        url = f"{self._base_url}/chat/completions"
        headers = self._build_headers()
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if tools:
            payload["tools"] = tools

        # P2-12.3.1: 复用实例级 AsyncClient 连接池
        response = await self._async_client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

        message = data.get("choices", [{}])[0].get("message", {})
        content = message.get("content", "") or ""
        raw_tool_calls = message.get("tool_calls", [])

        usage_data = data.get("usage", {})
        usage = {
            "prompt_tokens": usage_data.get("prompt_tokens", 0),
            "completion_tokens": usage_data.get("completion_tokens", 0),
            "total_tokens": usage_data.get("total_tokens", 0),
        }

        parsed_tool_calls: List[Dict[str, Any]] = []
        for tc in raw_tool_calls:
            try:
                func = tc.get("function", {})
                tc_name = func.get("name", "")
                args_str = func.get("arguments", "{}")
                args = json.loads(args_str) if isinstance(args_str, str) else args_str
                if tc_name:
                    parsed_tool_calls.append({"tool": tc_name, "parameters": args})
            except (json.JSONDecodeError, TypeError) as e:
                logger.warning("Failed to parse tool_call arguments: %s", e)

        logger.debug(
            "LLM async response: model=%s tokens=%s tool_calls=%d",
            data.get("model", model),
            usage,
            len(parsed_tool_calls),
        )
        return content, usage, parsed_tool_calls

    async def astream(
        self,
        prompt: str,
        context: Dict[str, Any],
        **kwargs: Any,
    ) -> AsyncGenerator[str, None]:
        """异步流式推理。

        P1-12.2.5：temperature/max_tokens 不再硬编码，通过 kwargs 覆盖。
        P2-12.3.1：复用实例级 httpx.AsyncClient 连接池，发挥 async 优势。
        """
        messages = self._build_messages(prompt, context)
        temperature = self._resolve_temperature(kwargs)
        max_tokens = self._resolve_max_tokens(kwargs)
        model = kwargs.get("model", self._default_model)
        url = f"{self._base_url}/chat/completions"
        headers = self._build_headers()
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }

        # P2-12.3.1: 复用实例级 AsyncClient 连接池
        async with self._async_client.stream("POST", url, json=payload, headers=headers) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        yield content
                except json.JSONDecodeError:
                    continue

    def _build_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    def _build_messages(self, prompt: str, context: Dict[str, Any]) -> List[Dict[str, str]]:
        messages: List[Dict[str, str]] = []

        if self._system_prompt:
            messages.append({"role": "system", "content": self._system_prompt})

        memory_context = context.get("memory_context")
        if memory_context:
            messages.append({
                "role": "system",
                "content": f"Relevant context from memory:\n{memory_context}",
            })

        tool_descriptions = context.get("tool_descriptions")
        if tool_descriptions:
            messages.append({
                "role": "system",
                "content": f"Available tools:\n{tool_descriptions}",
            })

        history = context.get("history")
        if isinstance(history, list):
            for entry in history:
                if isinstance(entry, dict) and "role" in entry and "content" in entry:
                    messages.append({"role": entry["role"], "content": entry["content"]})

        messages.append({"role": "user", "content": prompt})
        return messages
