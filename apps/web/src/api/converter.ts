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

      // assistant 消息：从 contentBlocks 提取思考内容
      const content: any[] = [];
      if (m.contentBlocks && Array.isArray(m.contentBlocks)) {
        const block = (m.contentBlocks as any[]).find((b) => b.reasoningContent);
        if (block?.reasoningContent) {
          // 结构需与 AGUI event-mapper 的 createReasoningContent 产物对齐：
          // { type: 'reasoning', data: [{type:'text', data, status}], status, ext: { collapsed } }
          content.push({
            type: 'reasoning' as const,
            data: [{ type: 'text' as const, data: block.reasoningContent, status: 'complete' as const }],
            status: 'complete' as const,
            ext: { collapsed: true },
          });
        }
      }
      content.push({
        type: 'markdown' as const,
        data: m.content,
        status: 'complete' as const,
      });

      return {
        id: m.id,
        role: 'assistant' as const,
        content,
        datetime: m.createdAt,
      };
    });
}
