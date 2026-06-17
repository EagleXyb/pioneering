import { useEffect, useRef } from 'react';
import type { ChatMessagesData } from 'tdesign-web-components/lib/chat-engine';
import { useConversationStore } from '../../../store/conversationStore';

export function useChatSync(conversationId: string | null, messages: ChatMessagesData[]) {
  const updatePreview = useConversationStore((s) => s.updatePreview);
  const updateTitle = useConversationStore((s) => s.updateTitle);
  const doneRef = useRef(false);

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
        const title = typeof userText?.data === 'string' ? userText.data.slice(0, 30) : '新会话';
        updateTitle(conversationId, title).catch(() => {});
        doneRef.current = true;
      }
    }
  }, [conversationId, messages]);
}