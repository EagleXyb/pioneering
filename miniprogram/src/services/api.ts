import request from './request';
import { connectSSE } from './sse';
import type { SSEParams } from '@/types/chat';

// ====== 类型定义 ======
export interface ChatMessageRequest {
  sessionId: string;
  content: string;
  messageId: string;
  deepThink?: boolean;
  netSearch?: boolean;
}

export interface ChatMessageResponse {
  id: string;
  content: string;
  type: string;
}

export interface SendChatResponse {
  message: ChatMessageResponse;
  quickReplies: string[];
  phase: number;
}

// ====== 流式回调类型 ======
export interface StreamCallbacks {
  onChunk: (data: { type: 'thinking' | 'content'; data: string }) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

// ====== API 接口 ======
export const chatApi = {
  /** 非流式发送消息 */
  sendMessage(data: ChatMessageRequest) {
    return request.post<SendChatResponse>('/chat/message', data as unknown as Record<string, unknown>);
  },

  /** 流式发送消息 */
  sendMessageStream(params: SSEParams, callbacks: StreamCallbacks) {
    const conn = connectSSE(params);
    conn.onChunk(callbacks.onChunk);
    conn.onDone(callbacks.onDone);
    conn.onError(callbacks.onError);
    return conn;
  },

  /** 停止生成 */
  stopMessage(sessionId: string, messageId: string) {
    return request.post('/chat/stop', { sessionId, messageId });
  },

  /** 重新生成 */
  regenerate(sessionId: string, messageId: string) {
    return request.post('/chat/regenerate', { sessionId, messageId });
  },
};