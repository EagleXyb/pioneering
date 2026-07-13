import { useEffect, useRef } from 'react';
import type { ChatMessagesData } from '../../../types/tdesign';
import { useConversationStore } from '../../../store/conversationStore';
import { generateTitle } from '../../../api/session';

export function useChatSync(conversationId: string | null, messages: ChatMessagesData[]) {
  const updatePreview = useConversationStore((s) => s.updatePreview);
  const updateTitle = useConversationStore((s) => s.updateTitle);
  const setTitle = useConversationStore((s) => s.setTitle);
  const doneRef = useRef(false);
  /** 临时截断标题是否已设置（防止重复调用 updateTitle） */
  const tempTitleRef = useRef(false);
  /** 上一次处理的 conversationId，用于检测会话切换 */
  const prevConvIdRef = useRef<string | null>(conversationId);
  /**
   * 会话切换瞬间捕获的 messages 引用（可能是上个会话残留的旧消息）。
   * 切换会话时 activeId 立即更新但 messages 状态滞后，若不防护，
   * useChatSync 会用新会话 ID + 旧会话消息调用 updateTitle，
   * 导致新会话标题被串改成上一个会话的标题。
   */
  const staleMessagesRef = useRef<ChatMessagesData[] | null>(null);

  useEffect(() => {
    // 会话切换检测（须在任何 early return 之前执行，否则切换到空会话时无法重置 doneRef）
    if (prevConvIdRef.current !== conversationId) {
      staleMessagesRef.current = messages;
      prevConvIdRef.current = conversationId;
      doneRef.current = false;
      tempTitleRef.current = false;
    }

    if (!conversationId || messages.length === 0) return;

    // 防护：messages 仍是切换瞬间捕获的旧引用 → 是上个会话残留消息，跳过避免串改标题
    if (messages === staleMessagesRef.current) {
      return;
    }
    staleMessagesRef.current = null;

    const last = messages[messages.length - 1];
    const textContent = last.content?.find((c: any) => c.type === 'text' || c.type === 'markdown');
    const preview = typeof textContent?.data === 'string' ? textContent.data.slice(0, 80) : '';
    updatePreview(conversationId, preview);

    if (!doneRef.current) {
      const firstUser = messages.find((m) => m.role === 'user');
      // P2-1 修复：检测助手是否已回复实际内容
      const hasAssistantContent = messages.some(
        (m) => m.role === 'assistant' && m.content?.some((c: any) => {
          const data = (c as any).data;
          return typeof data === 'string' && data.length > 0;
        }),
      );

      if (firstUser) {
        const userText = firstUser.content?.find((c: any) => c.type === 'text' || c.type === 'markdown');
        const rawTitle = typeof userText?.data === 'string' ? userText.data.trim() : '';

        if (hasAssistantContent && !conversationId.startsWith('temp_')) {
          // P2-1 修复：完整对话后用 AI 生成标题，替换截断逻辑
          const fallbackTitle = rawTitle
            ? (rawTitle.length > 30 ? rawTitle.slice(0, 30) + '...' : rawTitle)
            : '新对话';
          generateTitle(conversationId)
            .then((resp) => setTitle(conversationId, resp.title || fallbackTitle))
            .catch(() => setTitle(conversationId, fallbackTitle));
          doneRef.current = true;
        } else if (rawTitle && !conversationId.startsWith('temp_') && !tempTitleRef.current) {
          // 仅有用户消息时，先用截断做临时标题（不标记 doneRef，等助手回复后生成 AI 标题）
          const title = rawTitle.length > 30 ? rawTitle.slice(0, 30) + '...' : rawTitle;
          updateTitle(conversationId, title).catch(() => {});
          tempTitleRef.current = true;
        } else if (!rawTitle) {
          // 无有效标题文本，标记完成避免反复尝试
          doneRef.current = true;
        }
      }
    }
  }, [conversationId, messages]);
}
