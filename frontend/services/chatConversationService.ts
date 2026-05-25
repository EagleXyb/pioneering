import { API_ENDPOINTS } from '@shared/api/endpoints';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export interface SessionItem {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number };
}

export interface MessageItem {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinkingContent?: string;
  answerContent?: string;
  status: 'loading' | 'success' | 'error';
  error?: string;
  createdAt: string;
}

export interface CreateSessionPayload {
  title: string;
  model: string;
}

export interface UpdateMessagePayload {
  content?: string;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token') || '';
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

class ChatConversationService {
  private static instance: ChatConversationService;

  private constructor() {}

  static getInstance(): ChatConversationService {
    if (!ChatConversationService.instance) {
      ChatConversationService.instance = new ChatConversationService();
    }
    return ChatConversationService.instance;
  }

  // ===== 会话 =====

  async getSessions(): Promise<SessionItem[]> {
    const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.SESSIONS}`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error('获取会话列表失败');
    const data = await res.json();
    return Array.isArray(data) ? data : (data.sessions || []);
  }

  async createSession(payload: CreateSessionPayload): Promise<SessionItem> {
    const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.SESSIONS}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('创建会话失败');
    return res.json();
  }

  async updateSession(id: string, payload: { title?: string }): Promise<SessionItem> {
    const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.SESSION_BY_ID(id)}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('更新会话失败');
    return res.json();
  }

  async deleteSession(id: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.SESSION_BY_ID(id)}?archive=false`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error('删除会话失败');
  }

  // ===== 消息 =====

  async getMessages(sessionId: string): Promise<MessageItem[]> {
    const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.MESSAGES(sessionId)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error('获取消息列表失败');
    const data = await res.json();
    return Array.isArray(data) ? data : (data.messages || []);
  }

  async editMessage(
    sessionId: string,
    msgId: string,
    payload: UpdateMessagePayload,
  ): Promise<MessageItem> {
    const res = await fetch(
      `${API_BASE_URL}${API_ENDPOINTS.CHAT.MESSAGE_BY_ID(sessionId, msgId)}`,
      {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) throw new Error('更新消息失败');
    return res.json();
  }
}

const chatConversationService = ChatConversationService.getInstance();
export default chatConversationService;
