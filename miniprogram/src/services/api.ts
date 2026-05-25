import request from './request';
import { connectSSE } from './sse';
import type { SSEParams, SSEChunk } from '@/types/chat';

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

export interface BackendSession {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  messageCount: number;
}

export interface BackendMessage {
  id: string;
  content: string;
  role: string;
  createdAt: string;
}

// ====== 流式回调类型 ======
export interface StreamCallbacks {
  onChunk: (data: SSEChunk) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

// ====== API 接口 ======
export const chatApi = {
  /** 非流式发送消息 */
  sendMessage(data: ChatMessageRequest) {
    return request.post<SendChatResponse>('/chat/completions', {
      sessionId: data.sessionId,
      message: data.content,
      stream: false,
    } as unknown as Record<string, unknown>);
  },

  /** 流式发送消息 */
  sendMessageStream(params: SSEParams, callbacks: StreamCallbacks) {
    const conn = connectSSE(params);
    conn.onChunk(callbacks.onChunk);
    conn.onDone(callbacks.onDone);
    conn.onError(callbacks.onError);
    return conn;
  },

  /** 停止生成（messageId 可选） */
  stopMessage(sessionId: string, messageId?: string) {
    const payload: Record<string, string> = { sessionId };
    if (messageId) payload.messageId = messageId;
    return request.post('/chat/completions/stop', payload);
  },

  /** 重新生成（传入父消息 ID，即被重新生成的 AI 消息之前的那条用户消息 ID） */
  regenerate(parentMessageId: string) {
    return request.post(`/chat/messages/${parentMessageId}/regenerate`);
  },

  /** 获取会话列表 */
  getSessions() {
    return request.get<BackendSession[]>('/chat/sessions');
  },

  /** 创建会话 */
  createSession(title?: string) {
    return request.post<BackendSession>('/chat/sessions', {
      title: title || '新的对话',
    } as unknown as Record<string, unknown>);
  },

  /** 删除会话 */
  deleteSession(sessionId: string) {
    return request.delete<void>(`/chat/sessions/${sessionId}`);
  },

  /** 获取会话历史消息 */
  getSessionMessages(sessionId: string) {
    return request.get<BackendMessage[]>(`/chat/sessions/${sessionId}/messages`);
  },
};