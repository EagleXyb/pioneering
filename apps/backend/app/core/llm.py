import json
import uuid
from collections.abc import AsyncGenerator


import httpx

from app.config import settings


class LlmService:
    def __init__(self):
        self.api_key = settings.llm_api_key
        self.base_url = settings.llm_base_url
        self.default_model = settings.llm_default_model

    async def chat_completion(
        self,
        messages: list[dict],
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> dict:
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model or self.default_model,
            "messages": messages,
            "stream": False,
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            return response.json()

    async def stream_agui(
        self,
        messages: list[dict],
        assistant_msg_id: str,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[str, None]:
        """
        AG-UI 协议流式输出，产生 SSE 事件字符串。
        事件类型: RUN_STARTED, THINKING_START, THINKING_TEXT_MESSAGE_START,
                 THINKING_TEXT_MESSAGE_CONTENT, THINKING_TEXT_MESSAGE_END,
                 THINKING_END, TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT,
                 TEXT_MESSAGE_END, RUN_FINISHED, RUN_ERROR
        """
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model or self.default_model,
            "messages": messages,
            "stream": True,
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        text_msg_started = False
        think_started = False
        think_text_started = False

        def _ensure_text_start():
            nonlocal text_msg_started
            if not text_msg_started:
                text_msg_started = True
                return f'data: {json.dumps({"type": "TEXT_MESSAGE_START", "messageId": assistant_msg_id, "role": "assistant"}, ensure_ascii=False)}\n\n'
            return ""

        def _ensure_think_start():
            """首次收到 reasoning_content 时发送 THINKING_START + THINKING_TEXT_MESSAGE_START。

            前端 AGUI event-mapper 的 handleThinkingTextContent 依赖
            THINKING_TEXT_MESSAGE_START 预先在 reasoningContext.currentData 中
            创建一条 text 内容，否则所有 THINKING_TEXT_MESSAGE_CONTENT 增量
            都因找不到可合并的目标而返回 null，导致思考内容被静默丢弃。
            """
            nonlocal think_started, think_text_started
            parts = []
            if not think_started:
                think_started = True
                parts.append(f'data: {json.dumps({"type": "THINKING_START"}, ensure_ascii=False)}\n\n')
            if not think_text_started:
                think_text_started = True
                parts.append(f'data: {json.dumps({"type": "THINKING_TEXT_MESSAGE_START"}, ensure_ascii=False)}\n\n')
            return "".join(parts)

        def _close_thinking():
            """关闭思考阶段：先发 THINKING_TEXT_MESSAGE_END，再发 THINKING_END。"""
            nonlocal think_started, think_text_started
            parts = []
            if think_text_started:
                parts.append(f'data: {json.dumps({"type": "THINKING_TEXT_MESSAGE_END"}, ensure_ascii=False)}\n\n')
                think_text_started = False
            if think_started:
                parts.append(f'data: {json.dumps({"type": "THINKING_END"}, ensure_ascii=False)}\n\n')
                think_started = False
            return "".join(parts)

        def _flush_end():
            nonlocal text_msg_started
            parts = [_close_thinking()]
            if text_msg_started:
                parts.append(f'data: {json.dumps({"type": "TEXT_MESSAGE_END", "messageId": assistant_msg_id}, ensure_ascii=False)}\n\n')
                text_msg_started = False
            return "".join(parts)

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream("POST", url, json=payload, headers=headers) as response:
                    if response.status_code != 200:
                        error_body = await response.aread()
                        error_text = error_body.decode()[:500]
                        yield f'data: {json.dumps({"type": "RUN_ERROR", "message": f"LLM API error: {response.status_code}", "code": "LLM_ERROR"}, ensure_ascii=False)}\n\n'
                        return

                    async for line in response.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        data = line[6:]
                        if data.strip() == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                        except json.JSONDecodeError:
                            continue

                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        reasoning_content = delta.get("reasoning_content", "")
                        content = delta.get("content", "")

                        if reasoning_content:
                            yield _ensure_think_start()
                            yield f'data: {json.dumps({"type": "THINKING_TEXT_MESSAGE_CONTENT", "delta": reasoning_content}, ensure_ascii=False)}\n\n'

                        if content:
                            if think_started:
                                yield _close_thinking()
                            yield _ensure_text_start()
                            yield f'data: {json.dumps({"type": "TEXT_MESSAGE_CONTENT", "messageId": assistant_msg_id, "delta": content}, ensure_ascii=False)}\n\n'

            # 流结束
            yield _flush_end()

        except Exception as e:
            yield _flush_end()
            yield f'data: {json.dumps({"type": "RUN_ERROR", "message": str(e), "code": "STREAM_ERROR"}, ensure_ascii=False)}\n\n'


llm_service = LlmService()