/**
 * 对话补全 API
 * 使用 AG-UI SSE 协议流式对话
 *
 * 后端发送 AG-UI 事件格式：
 *   {"type":"TEXT_MESSAGE_CONTENT","delta":"文本增量"}
 *   {"type":"THINKING_TEXT_MESSAGE_CONTENT","delta":"思考增量"}
 *   {"type":"RUN_FINISHED","threadId":"...","runId":"..."}
 *   {"type":"RUN_ERROR","message":"...","code":"..."}
 */
import { getAuthHeader } from './client';
import type { ChatCompletionRequest } from './types';

const BASE_URL = '/api';

/** AG-UI 流式数据块 */
export interface AguiEvent {
  type: string;
  delta?: string;
  message?: string;
  code?: string;
  threadId?: string;
  runId?: string;
}

/** 流式回调接口 */
export interface StreamCallbacks {
  /** 收到文本增量 */
  onChunk?: (delta: string) => void;
  /** 流结束 */
  onDone?: () => void;
  /** 错误 */
  onError?: (error: Error) => void;
}

/**
 * AG-UI 流式对话补全
 *
 * 使用 fetch + ReadableStream 读取 SSE 数据，
 * 按 AG-UI 事件协议解析后通过回调逐块返回。
 *
 * @returns AbortController（用于中止请求）
 */
export function streamChat(
  params: ChatCompletionRequest,
  callbacks: StreamCallbacks,
): AbortController {
  const controller = new AbortController();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getAuthHeader(),
  };

  fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...params, stream: true }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.message || `请求失败: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取响应流');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 按 SSE 协议解析：以 \n\n 分隔事件
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          const lines = event.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;

            const dataStr = line.slice(5).trim();
            if (!dataStr) continue;

            try {
              const data: AguiEvent = JSON.parse(dataStr);

              switch (data.type) {
                case 'TEXT_MESSAGE_CONTENT':
                case 'THINKING_TEXT_MESSAGE_CONTENT':
                  if (data.delta) {
                    callbacks.onChunk?.(data.delta);
                  }
                  break;

                case 'RUN_ERROR':
                  callbacks.onError?.(new Error(data.message || '流式生成出错'));
                  return;

                case 'RUN_FINISHED':
                  callbacks.onDone?.();
                  return;
              }
            } catch {
              // 忽略解析失败的行
            }
          }
        }
      }

      callbacks.onDone?.();
    })
    .catch((err) => {
      if (err.name === 'AbortError') {
        callbacks.onDone?.();
        return;
      }
      callbacks.onError?.(err);
    });

  return controller;
}


