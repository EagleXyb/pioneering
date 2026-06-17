/**
 * 会话管理 API
 * 对应后端 /chat/sessions 系列接口
 */
import { get, post, put, del } from './client';
import type {
  Session,
  SessionListResponse,
  CreateSessionRequest,
  UpdateSessionRequest,
} from './types';

/** 获取会话列表 */
export function getSessions(
  page = 1,
  pageSize = 20,
  archived = false,
): Promise<SessionListResponse> {
  return get<SessionListResponse>('/chat/sessions', { page, pageSize, archived });
}

/** 创建新会话 */
export function createSession(data: CreateSessionRequest = {}): Promise<Session> {
  return post<Session>('/chat/sessions', data);
}

/** 获取会话详情 */
export function getSession(sessionId: string): Promise<Session> {
  return get<Session>(`/chat/sessions/${sessionId}`);
}

/** 更新会话（重命名、切换模型等） */
export function updateSession(
  sessionId: string,
  data: UpdateSessionRequest,
): Promise<Session> {
  return put<Session>(`/chat/sessions/${sessionId}`, data);
}

/** 删除/归档会话 */
export function deleteSession(sessionId: string, archive = true): Promise<void> {
  return del<void>(`/chat/sessions/${sessionId}`, { archive });
}
