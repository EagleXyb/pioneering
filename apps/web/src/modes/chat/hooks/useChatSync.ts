import { useEffect, useRef } from 'react';
import type { ChatMessagesData } from '../../../types/tdesign';
import { useConversationStore } from '../../../store/conversationStore';

export function useChatSync(conversationId: string | null, messages: ChatMessagesData[]) {
  const updatePreview = useConversationStore((s) => s.updatePreview);
  const updateTitle = useConversationStore((s) => s.updateTitle);
  const doneRef = useRef(false);
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
      if (firstUser) {
        const userText = firstUser.content?.find((c: any) => c.type === 'text' || c.type === 'markdown');
        const rawTitle = typeof userText?.data === 'string' ? userText.data.trim() : '';
        if (rawTitle) {
          const title = rawTitle.length > 30 ? rawTitle.slice(0, 30) + '...' : rawTitle;
          // 临时会话尚未有真实 ID，跳过 updateTitle 避免后端 404；
          // 待后端创建完成、conversationId 变为真实 ID 后 doneRef 会重置，届时再更新
          if (!conversationId.startsWith('temp_')) {
            updateTitle(conversationId, title).catch(() => {});
            doneRef.current = true;
          }
        } else {
          // 无有效标题文本，标记完成避免反复尝试
          doneRef.current = true;
        }
      }
    }
  }, [conversationId, messages]);
}