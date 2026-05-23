import { useState, useEffect, useCallback } from 'react';
import Taro from '@tarojs/taro';
import { useAppStore, type SessionItem } from '@/store';
import type { ChatMessage } from '@/types/chat';
import { useConversation } from '@/hooks/useConversation';
import { useSSE } from '@/hooks/useSSE';

export function useChatLogic() {
  // ---- Store ----
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const messagesMap = useAppStore((s) => s.messagesMap);
  const chatPhase = useAppStore((s) => s.chatPhase);
  const setChatPhase = useAppStore((s) => s.setChatPhase);
  const addSession = useAppStore((s) => s.addSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const setCurrentSessionId = useAppStore((s) => s.setCurrentSessionId);
  const clearMessages = useAppStore((s) => s.clearMessages);

  // ---- Hooks ----
  const conv = useConversation(currentSessionId);
  const sse = useSSE(currentSessionId);

  // ---- Local state ----
  const [inputValue, setInputValue] = useState('');
  const [deepThinkActive, setDeepThinkActive] = useState(false);
  const [netSearchActive, setNetSearchActive] = useState(false);

  // 当前会话消息（使用响应式 currentSessionId）
  const messages: ChatMessage[] = messagesMap[currentSessionId] || [];

  // SSE 流式内容同步到 Store
  useEffect(() => {
    if (!currentSessionId) return;

    const msgs = messagesMap[currentSessionId] || [];
    const lastAi = [...msgs].reverse().find((m) => !m.isUser);
    if (!lastAi) return;

    if (sse.status === 'streaming') {
      conv.updateAIMessage(currentSessionId, lastAi.id, {
        content: sse.streamingContent,
        thinkingContent: sse.thinkingContent || undefined,
        status: 'streaming',
      });
      setChatPhase('generating');
    } else if (sse.status === 'done') {
      conv.updateAIMessage(currentSessionId, lastAi.id, {
        content: sse.streamingContent,
        thinkingContent: sse.thinkingContent || undefined,
        status: 'done',
      });
      setChatPhase('completed');
    } else if (sse.status === 'error') {
      conv.updateAIMessage(currentSessionId, lastAi.id, {
        content: sse.streamingContent || '暂时无法回答，请换种方式提问',
        status: 'error',
        error: sse.error || '生成失败',
      });
      setChatPhase('completed');
    }
  }, [sse.status, sse.streamingContent, sse.thinkingContent, sse.error, currentSessionId, messagesMap, conv, setChatPhase]);

  // ---- 操作 ----

  const handleNewChat = useCallback(() => {
    const newSession: SessionItem = {
      id: `session_${Date.now()}`,
      title: '新的对话',
      preview: '开始一段全新的对话...',
      updatedAt: Date.now(),
    };
    addSession(newSession);
    setCurrentSessionId(newSession.id);
    sse.reset();
  }, [addSession, setCurrentSessionId, sse]);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;

    if (sse.status === 'streaming' || sse.status === 'connecting') return;

    let sid = currentSessionId;
    if (!sid) {
      sid = conv.createSession();
    }

    const result = conv.buildUserMessage(sid, text);
    if (!result.passed) {
      Taro.showToast({ title: result.reason || '发送失败', icon: 'none' });
      return;
    }

    setInputValue('');

    const aiMsg = conv.createAIMessage(sid);
    const aiMsgId = aiMsg.id;

    conv.updateSessionPreview(sid, text);

    setChatPhase('thinking');

    sse.startStream(aiMsgId, text, deepThinkActive);
  }, [inputValue, currentSessionId, sse, conv, setChatPhase, deepThinkActive]);

  const handleStop = useCallback(() => {
    if (!currentSessionId) return;

    sse.stopStream();

    const msgs = messagesMap[currentSessionId] || [];
    const lastAi = [...msgs].reverse().find((m) => !m.isUser);
    if (lastAi) {
      conv.updateAIMessage(currentSessionId, lastAi.id, { status: 'stopped' });
    }

    setChatPhase('completed');
  }, [currentSessionId, sse, messagesMap, conv, setChatPhase]);

  const handleRegenerate = useCallback(
    (msgId: string) => {
      if (!currentSessionId) return;
      if (sse.status === 'streaming' || sse.status === 'connecting') return;

      const msgs = messagesMap[currentSessionId] || [];
      const aiIdx = msgs.findIndex((m) => m.id === msgId);
      if (aiIdx < 1) return;

      const prevUser = msgs[aiIdx - 1];
      if (!prevUser?.isUser) return;

      conv.updateAIMessage(currentSessionId, msgId, { content: '', status: 'pending' });

      setChatPhase('thinking');
      sse.startStream(msgId, prevUser.content, deepThinkActive);
    },
    [currentSessionId, messagesMap, sse, conv, setChatPhase, deepThinkActive],
  );

  const handleSwitchSession = useCallback(
    (id: string) => {
      setCurrentSessionId(id);
      sse.reset();
      setChatPhase('idle');
    },
    [setCurrentSessionId, sse, setChatPhase],
  );

  const handleDeleteSession = useCallback(
    (id: string) => {
      removeSession(id);
      clearMessages(id);
      if (id === currentSessionId) {
        setCurrentSessionId('');
        sse.reset();
        setChatPhase('idle');
      }
    },
    [currentSessionId, removeSession, setCurrentSessionId, clearMessages, sse, setChatPhase],
  );

  const handleDeepThinkTap = useCallback(() => {
    setDeepThinkActive((prev) => !prev);
  }, []);

  const handleNetSearchTap = useCallback(() => {
    setNetSearchActive((prev) => !prev);
  }, []);

  const handleInputFocus = useCallback(() => {
    setTimeout(() => {
      try {
        const query = Taro.createSelectorQuery();
        query.select('.textarea').boundingClientRect();
        query.exec((res: any) => {
          if (res && res[0]) {
            const { top } = res[0];
            const systemInfo = Taro.getSystemInfoSync();
            const windowHeight = systemInfo.windowHeight || 667;
            if (top > windowHeight * 0.5) {
              Taro.pageScrollTo({
                scrollTop: top - windowHeight * 0.3,
                duration: 200,
              });
            }
          }
        });
      } catch (e) {
        console.warn('输入框聚焦滚动失败:', e);
      }
    }, 300);
  }, []);

  const isBusy = sse.status === 'streaming' || sse.status === 'connecting';
  const hasActiveSession = !!currentSessionId;

  return {
    // 状态
    currentSessionId,
    sessions,
    messages,
    chatPhase,
    inputValue,
    deepThinkActive,
    netSearchActive,
    isBusy,
    hasActiveSession,
    sseStatus: sse.status,

    // 操作
    setInputValue,
    handleNewChat,
    handleSend,
    handleStop,
    handleRegenerate,
    handleSwitchSession,
    handleDeleteSession,
    handleDeepThinkTap,
    handleNetSearchTap,
    handleInputFocus,
  };
}
