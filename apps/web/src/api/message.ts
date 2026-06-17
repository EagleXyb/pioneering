/**
 * 消息相关 API
 * 包含：历史消息获取、编辑、反馈、重新生成、停止生成
 */
import { get, post, put } from './client';
import type {
  Message,
  MessageListResponse,
  EditMessageRequest,
  FeedbackRequest,
  RegenerateRequest,
  StopGenerationRequest,
} from './types';

/** 获取历史消息（游标分页） */
export function getMessages(
  sessionId: string,
  cursor?: string,
  limit = 30,
  direction: 'before' | 'after' = 'before',
): Promise<MessageListResponse> {
  return get<MessageListResponse>(
    `/chat/sessions/${sessionId}/messages`,
    { cursor, limit, direction },
  );
}

/** 编辑用户消息 */
export function editMessage(
  sessionId: string,
  messageId: string,
  data: EditMessageRequest,
): Promise<Message> {
  return put<Message>(
    `/chat/sessions/${sessionId}/messages/${messageId}`,
    data,
  );
}

/** 消息反馈（点赞/点踩） */
export function feedbackMessage(
  messageId: string,
  feedback: 'like' | 'dislike' | 'none',
): Promise<void> {
  return post<void>(
    `/chat/messages/${messageId}/feedback`,
    { messageId, feedback } as FeedbackRequest,
  );
}

/** 重新生成 AI 回复 */
export function regenerateMessage(
  messageId: string,
  data?: RegenerateRequest,
): Promise<Message> {
  return post<Message>(
    `/chat/messages/${messageId}/regenerate`,
    data,
  );
}

/** 停止生成 */
export function stopGeneration(data: StopGenerationRequest): Promise<void> {
  return post<void>('/chat/completions/stop', data);
}
