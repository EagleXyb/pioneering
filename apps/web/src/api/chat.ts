/**
 * 对话补全 API
 * 支持流式 SSE 和非流式两种模式
 */
import { getToken } from './client';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
} from './types';

const BASE_URL = '/api';

/** 流式回调接口 */
export interface StreamCallbacks {
  /** 收到文本增量 */
  onChunk?: (delta: string) => void;
  /** 流结束 */
  onDone?: (response: ChatCompletionResponse | null) => void;
  /** 错误 */
  onError?: (error: Error) => void;
}

/**
 * 流式对话补全
 *
 * 使用 fetch + ReadableStream 读取 SSE 数据，
 * 解析后通过回调逐块返回文本增量。
 *
 * @returns AbortController（用于中止请求）
 */
export function streamChat(
  params: ChatCompletionRequest,
  callbacks: StreamCallbacks,
): AbortController {
  const controller = new AbortController();
  const token = getToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

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
      let finalResponse: ChatCompletionResponse | null = null;

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
            if (dataStr === '[DONE]') {
              callbacks.onDone?.(finalResponse);
              return;
            }

            try {
              const data: ChatCompletionResponse = JSON.parse(dataStr);
              finalResponse = data;

              const content = data.choices?.[0]?.delta?.content;
              if (content) {
                callbacks.onChunk?.(content);
              }
            } catch {
              // 忽略解析失败的行
            }
          }
        }
      }

      callbacks.onDone?.(finalResponse);
    })
    .catch((err) => {
      if (err.name === 'AbortError') {
        callbacks.onDone?.(null);
        return;
      }
      callbacks.onError?.(err);
    });

  return controller;
}

/**
 * 非流式对话补全
 */
export async function chatCompletions(
  params: ChatCompletionRequest,
): Promise<ChatCompletionResponse> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...params, stream: false }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => null);
    throw new Error(errData?.message || `请求失败: ${response.status}`);
  }

  return response.json();
}
