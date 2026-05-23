import { useCallback } from 'react';
import { useAppStore } from '@/store';
import { filterSensitive } from '@/utils/sensitive';
import type { ChatMessage, SessionItem } from '@/types/chat';

// ====== 生成幂等消息 ID ======
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function useConversation(_sessionId: string) {
  const addSession = useAppStore((s) => s.addSession);
  const setCurrentSessionId = useAppStore((s) => s.setCurrentSessionId);
  const addMessage = useAppStore((s) => s.addMessage);
  const updateMessage = useAppStore((s) => s.updateMessage);
  const updateSession = useAppStore((s) => s.updateSession);
  const getContextWindow = useAppStore((s) => s.getContextWindow);

  // 新建会话
  const createSession = useCallback((): string => {
    const newSession: SessionItem = {
      id: `session_${Date.now()}`,
      title: '新的对话',
      preview: '开始一段全新的对话...',
      updatedAt: Date.now(),
    };
    addSession(newSession);
    setCurrentSessionId(newSession.id);
    return newSession.id;
  }, [addSession, setCurrentSessionId]);

  // 构建上下文
  const buildContext = useCallback(
    (sid: string): ChatMessage[] => {
      return getContextWindow(sid, 10);
    },
    [getContextWindow],
  );

  // 校验并构建用户消息
  const buildUserMessage = useCallback(
    (sid: string, content: string): { passed: boolean; message?: ChatMessage; reason?: string } => {
      // 长度校验
      if (content.length > 2000) {
        return { passed: false, reason: '输入内容过长，请限制在 2000 字以内' };
      }

      // 敏感词过滤
      const filterResult = filterSensitive(content);
      if (!filterResult.passed) {
        return { passed: false, reason: filterResult.reason };
      }

      const msg: ChatMessage = {
        id: generateMessageId(),
        sessionId: sid,
        content: filterResult.filtered || content,
        isUser: true,
        status: 'done',
        timestamp: Date.now(),
      };

      addMessage(sid, msg);
      return { passed: true, message: msg };
    },
    [addMessage],
  );

  // 创建 AI 占位消息（pending 状态）
  const createAIMessage = useCallback(
    (sid: string): ChatMessage => {
      const msg: ChatMessage = {
        id: `ai_${Date.now()}`,
        sessionId: sid,
        content: '',
        isUser: false,
        status: 'pending',
        timestamp: Date.now(),
      };
      addMessage(sid, msg);
      return msg;
    },
    [addMessage],
  );

  // 更新 AI 消息
  const updateAIMessage = useCallback(
    (sid: string, msgId: string, partial: Partial<ChatMessage>) => {
      updateMessage(sid, msgId, partial);
    },
    [updateMessage],
  );

  // 更新会话预览
  const updateSessionPreview = useCallback(
    (sid: string, content: string) => {
      updateSession(sid, {
        preview: content.slice(0, 30),
        updatedAt: Date.now(),
      });
    },
    [updateSession],
  );

  return {
    createSession,
    buildContext,
    buildUserMessage,
    createAIMessage,
    updateAIMessage,
    updateSessionPreview,
  };
}