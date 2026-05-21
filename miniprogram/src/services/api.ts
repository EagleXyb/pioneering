import request from './request';

// ====== 类型定义 ======
export interface ChatMessageRequest {
  sessionId: string;
  content: string;
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

// ====== API 接口（最小闭环：仅发消息 + 收回复）======
export const chatApi = {
  /** 发送消息 */
  sendMessage(data: ChatMessageRequest) {
    return request.post<SendChatResponse>('/chat/message', data as unknown as Record<string, unknown>);
  },
};
