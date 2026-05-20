import request from './request';

// ====== 类型定义 ======
export interface ChatSession {
  id: string;
  title: string;
  preview: string;
  mode: string;
  time: number;
}

export interface ChatMessageRequest {
  sessionId: string;
  content: string;
  isUser: boolean;
}

export interface ChatMessageResponse {
  id: string;
  content: string;
  type: 'text' | 'insight' | 'action';
  insightData?: InsightData;
  actionData?: ActionData;
}

export interface InsightData {
  label: string;
  title: string;
  body: string;
  evidence: string[];
  accepted?: boolean;
  revised?: boolean;
}

export interface ActionItem {
  title: string;
  desc: string;
  risk: string;
  potential: string;
}

export interface ActionData {
  label: string;
  items: ActionItem[];
}

export interface StartChatResponse {
  sessionId: string;
  message: ChatMessageResponse;
  quickReplies: string[];
  phase: number;
}

export interface SendChatResponse {
  message: ChatMessageResponse;
  quickReplies: string[];
  phase: number;
}

export interface CaseItem {
  id: string;
  title: string;
  desc: string;
  mode: string;
}

// ====== API 接口 ======
export const chatApi = {
  /** 创建新对话 */
  start(mode: string) {
    return request.post<StartChatResponse>('/chat/start', { mode });
  },

  /** 发送消息 */
  sendMessage(data: ChatMessageRequest) {
    return request.post<SendChatResponse>('/chat/message', data as unknown as Record<string, unknown>);
  },

  /** 接受洞察 */
  acceptInsight(sessionId: string, messageId: string) {
    return request.post<SendChatResponse>('/chat/insight/accept', { sessionId, messageId });
  },

  /** 修正洞察 */
  reviseInsight(sessionId: string, messageId: string, feedback: string) {
    return request.post<SendChatResponse>('/chat/insight/revise', { sessionId, messageId, feedback });
  },

  /** 选择行动 */
  selectAction(sessionId: string, actionTitle: string) {
    return request.post<SendChatResponse>('/chat/action/select', { sessionId, actionTitle });
  },

  /** 获取最近对话列表 */
  getRecentSessions() {
    return request.get<ChatSession[]>('/chat/sessions/recent');
  },

  /** 获取精选案例 */
  getCases() {
    return request.get<CaseItem[]>('/chat/cases');
  },
};

export const userApi = {
  /** 登录 */
  login(code: string) {
    return request.post<{ token: string; openid: string }>('/user/login', { code });
  },

  /** 获取用户信息 */
  getProfile() {
    return request.get<{ nickname: string; avatar: string }>('/user/profile');
  },
};
