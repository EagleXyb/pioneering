/**
 * 消息格式转换工具
 * 将后端 Message 格式转换为 @tdesign-react/chat 的 ChatMessagesData 格式
 */
import type { Message } from '../api/types';
import type { ChatMessagesData } from 'tdesign-web-components/lib/chat-engine';

/** 将后端 Message 转换为 ChatMessagesData */
export function convertMessages(messages: Message[]): ChatMessagesData[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      if (m.role === 'user') {
        return {
          id: m.id,
          role: 'user' as const,
          content: [{ type: 'text' as const, data: m.content }],
          datetime: m.createdAt,
        };
      }

      return {
        id: m.id,
        role: 'assistant' as const,
        content: [{ type: 'markdown' as const, data: m.content, status: 'complete' as const }],
        datetime: m.createdAt,
      };
    });
}
