// ====== 消息状态 ======
export type MessageStatus = 'pending' | 'streaming' | 'done' | 'stopped' | 'error';

// ====== 对话阶段（状态机） ======
export type ChatPhase = 'idle' | 'thinking' | 'generating' | 'completed';

// ====== 单条消息 ======
export interface ChatMessage {
  id: string;
  sessionId: string;
  content: string;
  thinkingContent?: string;
  isUser: boolean;
  status: MessageStatus;
  timestamp: number;
  error?: string;
}

// ====== 上下文窗口配置 ======
export interface ContextWindow {
  maxRounds: number;
  messages: ChatMessage[];
}

// ====== SSE 连接参数 ======
export interface SSEParams {
  sessionId: string;
  content: string;
  messageId: string;
  deepThink?: boolean;
  netSearch?: boolean;
}

// ====== SSE 连接句柄 ======
export interface SSEConnection {
  abort: () => void;
  onChunk: (callback: (data: SSEChunk) => void) => void;
  onDone: (callback: () => void) => void;
  onError: (callback: (err: Error) => void) => void;
}

// ====== SSE 数据块 ======
export interface SSEChunk {
  type: 'thinking' | 'content' | 'error' | 'done';
  data: string;
}

// ====== 会话项 ======
export interface SessionItem {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
}

// ====== 敏感词过滤结果 ======
export interface SensitiveFilterResult {
  passed: boolean;
  filtered?: string;
  reason?: string;
}