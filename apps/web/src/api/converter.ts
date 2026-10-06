/**
 * 消息格式转换工具
 * 将后端 Message 格式转换为前端统一的 ChatMessagesData 格式（types/chat.ts）
 */
import type { Message, FeedbackType } from '../api/types';
import type { ChatMessagesData } from '../types/chat';

/**
 * 扩展的聊天消息类型，添加前端需要的反馈字段。
 * 历史消息从后端加载时通过 convertMessages 填充此字段；
 * 流式生成的新消息也兼容此类型（feedback 为 undefined 时等同于 'none'）。
 *
 * metadata 字段用于任务模式判断 assistant 消息是否含 plan 数据
 * （metadata.plan_phase 存在则该消息关联了持久化的时间轴步骤）。
 */
export type ChatMessageData = ChatMessagesData & {
  feedback?: FeedbackType;
  metadata?: Record<string, any>;
};

/** 将后端 Message 转换为 ChatMessageData */
export function convertMessages(messages: Message[]): ChatMessageData[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      if (m.role === 'user') {
        return {
          id: m.id,
          role: 'user' as const,
          content: [{ type: 'text' as const, data: m.content }],
          datetime: m.createdAt,
          feedback: m.feedback,
          metadata: m.metadata,
        } as ChatMessageData;
      }

      // assistant 消息：从 contentBlocks 提取思考内容与联网搜索来源
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

        // 联网搜索结构化来源（与 SSE WEB_SEARCH_SOURCES 产物一致），
        // 供消息操作栏"N 篇来源"入口与右侧来源面板使用
        const sourcesBlock = (m.contentBlocks as any[]).find(
          (b) => Array.isArray(b.sources) && b.sources.length > 0,
        );
        if (sourcesBlock) {
          content.push({
            type: 'search' as const,
            data: { references: sourcesBlock.sources },
            status: 'complete' as const,
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
        feedback: m.feedback,
        metadata: m.metadata,
      } as ChatMessageData;
    });
}
