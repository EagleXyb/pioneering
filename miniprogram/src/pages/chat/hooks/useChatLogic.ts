import { useState, useEffect, useCallback } from 'react';
import Taro from '@tarojs/taro';
import { useAppStore, type SessionItem } from '@/store';
import type { ChatMessage } from '@/types/chat';
import { chatApi } from '@/services';
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
  const setSessions = useAppStore((s) => s.setSessions);
  const setMessages = useAppStore((s) => s.setMessages);

  // ---- Hooks ----
  const conv = useConversation(currentSessionId);
  const sse = useSSE(currentSessionId);

  // ---- Local state ----
  const [inputValue, setInputValue] = useState('');
  const [deepThinkActive, setDeepThinkActive] = useState(false);
  const [netSearchActive, setNetSearchActive] = useState(false);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);

  // 当前会话消息（使用响应式 currentSessionId）
  const messages: ChatMessage[] = messagesMap[currentSessionId] || [];

  // 启动时从后端加载会话列表
  useEffect(() => {
    if (sessionsLoaded) return;
    (async () => {
      try {
        const backendSessions = await chatApi.getSessions();
        const mapped: SessionItem[] = backendSessions.map((s) => ({
          id: s.id,
          title: s.title,
          preview: s.preview || '',
          updatedAt: new Date(s.updatedAt).getTime(),
        }));
        setSessions(mapped);
      } catch {
        // 首次加载失败静默处理
        console.log('[Chat] 加载会话列表失败，使用空列表');
      } finally {
        setSessionsLoaded(true);
      }
    })();
  }, [sessionsLoaded, setSessions]);

  // 加载指定会话的历史消息
  const loadSessionMessages = useCallback(
    async (sessionId: string) => {
      try {
        const backendMessages = await chatApi.getSessionMessages(sessionId);
        const mapped: ChatMessage[] = backendMessages.map((m) => ({
          id: m.id,
          sessionId,
          content: m.content || '',
          isUser: m.role === 'user',
          status: 'done' as const,
          timestamp: new Date(m.createdAt).getTime(),
        }));
        setMessages(sessionId, mapped);
      } catch {
        console.log('[Chat] 加载历史消息失败');
      }
    },
    [setMessages],
  );

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

  /** 新建会话（通过后端 API 创建） */
  const handleNewChat = useCallback(async () => {
    try {
      const backendSession = await chatApi.createSession();
      const newSession: SessionItem = {
        id: backendSession.id,
        title: backendSession.title,
        preview: backendSession.preview || '',
        updatedAt: new Date(backendSession.updatedAt).getTime(),
      };
      addSession(newSession);
      setCurrentSessionId(newSession.id);
      sse.reset();
    } catch (err) {
      console.log('[Chat] 创建会话失败，使用本地会话', err);
      // 降级：本地创建
      const fallbackSession: SessionItem = {
        id: `session_${Date.now()}`,
        title: '新的对话',
        preview: '开始一段全新的对话...',
        updatedAt: Date.now(),
      };
      addSession(fallbackSession);
      setCurrentSessionId(fallbackSession.id);
      sse.reset();
    }
  }, [addSession, setCurrentSessionId, sse]);

  /** 发送消息 */
  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;

    if (sse.status === 'streaming' || sse.status === 'connecting') return;

    let sid = currentSessionId;
    if (!sid) {
      // 没有当前会话时，在后端创建
      chatApi
        .createSession()
        .then((backendSession) => {
          const newSession: SessionItem = {
            id: backendSession.id,
            title: backendSession.title,
            preview: text.slice(0, 30),
            updatedAt: new Date(backendSession.updatedAt).getTime(),
          };
          addSession(newSession);
          setCurrentSessionId(newSession.id);

          const result = conv.buildUserMessage(newSession.id, text);
          if (!result.passed) {
            Taro.showToast({ title: result.reason || '发送失败', icon: 'none' });
            return;
          }
          const aiMsg = conv.createAIMessage(newSession.id);
          conv.updateSessionPreview(newSession.id, text);
          setChatPhase('thinking');
          sse.startStream(aiMsg.id, text, deepThinkActive, netSearchActive);
        })
        .catch(() => {
          Taro.showToast({ title: '创建会话失败，请重试', icon: 'none' });
        });
      setInputValue('');
      return;
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

    sse.startStream(aiMsgId, text, deepThinkActive, netSearchActive);
  }, [inputValue, currentSessionId, sse, conv, setChatPhase, deepThinkActive, netSearchActive, addSession, setCurrentSessionId]);

  /** 停止生成 */
  const handleStop = useCallback(() => {
    if (!currentSessionId) return;

    sse.stopStream();

    const msgs = messagesMap[currentSessionId] || [];
    const lastAi = [...msgs].reverse().find((m) => !m.isUser);
    if (lastAi) {
      conv.updateAIMessage(currentSessionId, lastAi.id, { status: 'stopped' });
      // 调用后端停止接口
      chatApi.stopMessage(currentSessionId, lastAi.id).catch(() => {});
    } else {
      chatApi.stopMessage(currentSessionId).catch(() => {});
    }

    setChatPhase('completed');
  }, [currentSessionId, sse, messagesMap, conv, setChatPhase]);

  /** 重新生成（传入当前 AI 消息的前一条用户消息 ID） */
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
      sse.startStream(msgId, prevUser.content, deepThinkActive, netSearchActive);

      // 异步调用后端 regenerate（传父消息 ID）
      chatApi.regenerate(prevUser.id).catch(() => {});
    },
    [currentSessionId, messagesMap, sse, conv, setChatPhase, deepThinkActive, netSearchActive],
  );

  /** 切换会话（加载历史消息） */
  const handleSwitchSession = useCallback(
    (id: string) => {
      setCurrentSessionId(id);
      sse.reset();
      setChatPhase('idle');
      // 如果该会话还没有消息记录，从后端加载
      if (!messagesMap[id] || messagesMap[id].length === 0) {
        loadSessionMessages(id);
      }
    },
    [setCurrentSessionId, sse, setChatPhase, messagesMap, loadSessionMessages],
  );

  /** 删除会话 */
  const handleDeleteSession = useCallback(
    (id: string) => {
      removeSession(id);
      clearMessages(id);
      // 异步调用后端删除
      chatApi.deleteSession(id).catch(() => {});
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
    inputValue,
    deepThinkActive,
    netSearchActive,
    chatPhase,
    isBusy,
    hasActiveSession,
    // 操作
    setInputValue,
    handleDeepThinkTap,
    handleNetSearchTap,
    handleSend,
    handleStop,
    handleRegenerate,
    handleNewChat,
    handleSwitchSession,
    handleDeleteSession,
    handleInputFocus,
    // SSE
    sseStatus: sse.status,
    sseError: sse.error,
  };
}