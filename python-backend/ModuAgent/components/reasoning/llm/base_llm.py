from __future__ import annotations

import json
import logging
from typing import Any, Dict, Generator, List, Optional

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
    ) -> str:
        messages = self._build_messages(prompt, context)
        temperature = kwargs.get("temperature", 0.7)
        max_tokens = kwargs.get("max_tokens", 512)
        model = kwargs.get("model", self._default_model)

        url = f"{self._base_url}/chat/completions"
        headers = self._build_headers()
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }

        with httpx.Client(timeout=self._timeout) as client:
            response = client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        logger.debug(
            "LLM response: model=%s tokens=%s",
            data.get("model", model),
            data.get("usage", {}).get("total_tokens", 0),
        )
        return content

    def stream(
        self,
        prompt: str,
        context: Dict[str, Any],
    ) -> Generator[str, None, None]:
        messages = self._build_messages(prompt, context)
        url = f"{self._base_url}/chat/completions"
        headers = self._build_headers()
        payload = {
            "model": self._default_model,
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 512,
            "stream": True,
        }

        with httpx.Client(timeout=self._timeout) as client:
            with client.stream("POST", url, json=payload, headers=headers) as response:
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

    def _build_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    def _build_messages(self, prompt: str, context: Dict[str, Any]) -> List[Dict[str, str]]:
        messages: List[Dict[str, str]] = []

        if self._system_prompt:
            messages.append({"role": "system", "content": self._system_prompt})

        history = context.get("history")
        if isinstance(history, list):
            for entry in history:
                if isinstance(entry, dict) and "role" in entry and "content" in entry:
                    messages.append({"role": entry["role"], "content": entry["content"]})

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

        messages.append({"role": "user", "content": prompt})
        return messages
