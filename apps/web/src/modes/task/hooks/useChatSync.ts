import { useEffect, useRef } from 'react';
import type { ChatMessagesData } from '../../../types/tdesign';
import { useConversationStore } from '../../../store/conversationStore';

export function useChatSync(conversationId: string | null, messages: ChatMessagesData[]) {
  const updatePreview = useConversationStore((s) => s.updatePreview);
  const updateTitle = useConversationStore((s) => s.updateTitle);
  const doneRef = useRef(false);

  // 会话切换时重置 doneRef，确保新会话的标题能正常更新
  useEffect(() => {
    doneRef.current = false;
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || messages.length === 0) return;

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