import { API_ENDPOINTS } from '@shared/api/endpoints';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export interface ConversationItem {
  id: number;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
}

export interface MessageItem {
  id: number;
  conversationId: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinkingContent?: string;
  answerContent?: string;
  status: 'loading' | 'success' | 'error';
  error?: string;
  createdAt: string;
}

export interface CreateConversationPayload {
  title: string;
  model: string;
}

export interface CreateMessagePayload {
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinkingContent?: string;
  answerContent?: string;
  status: 'loading' | 'success' | 'error';
  error?: string;
}

export interface UpdateMessagePayload {
  content?: string;
  thinkingContent?: string;
  answerContent?: string;
  status?: 'loading' | 'success' | 'error';
  error?: string;
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

  async getConversations(): Promise<ConversationItem[]> {
    const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.CONVERSATIONS}`);
    if (!res.ok) throw new Error('获取会话列表失败');
    return res.json();
  }

  async createConversation(payload: CreateConversationPayload): Promise<ConversationItem> {
    const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.CONVERSATIONS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('创建会话失败');
    return res.json();
  }

  async updateConversation(id: number, payload: { title?: string }): Promise<ConversationItem> {
    const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.CONVERSATION_BY_ID(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('更新会话失败');
    return res.json();
  }

  async deleteConversation(id: number): Promise<void> {
    const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.CONVERSATION_BY_ID(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('删除会话失败');
  }

  // ===== 消息 =====

  async getMessages(conversationId: number): Promise<MessageItem[]> {
    const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.MESSAGES(conversationId)}`);
    if (!res.ok) throw new Error('获取消息列表失败');
    return res.json();
  }

  async createMessage(conversationId: number, payload: CreateMessagePayload): Promise<MessageItem> {
    const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.MESSAGES(conversationId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('保存消息失败');
    return res.json();
  }

  async updateMessage(
    conversationId: number,
    msgId: number,
    payload: UpdateMessagePayload,
  ): Promise<MessageItem> {
    const res = await fetch(
      `${API_BASE_URL}${API_ENDPOINTS.CHAT.MESSAGE_BY_ID(conversationId, msgId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) throw new Error('更新消息失败');
    return res.json();
  }
}

const chatConversationService = ChatConversationService.getInstance();
export default chatConversationService;
