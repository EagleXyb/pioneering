import { useState, useCallback, useRef } from 'react';
import { ScriptStrategy, AIStrategy } from '../strategy';
import { PHASE_NAMES, PHASE_LABELS } from '../scripts/conversation';
import type { ChatMessage } from '../strategy/types';
import type { InsightData } from '../scripts/conversation';

// ====== 对话模式 ======
export type ChatMode = 'script' | 'ai';

// ====== 对外暴露的类型（供组件使用）======
export type { ChatMessage } from '../strategy/types';
export type { InsightData, ActionData, ActionItem } from '../scripts/conversation';

/**
 * 对话 Session Hook
 * 通过策略模式切换脚本模式 / AI 模式，组件层无需关心底层实现
 */
export function useChatSession(mode: ChatMode = 'script') {
  const strategyRef = useRef(mode === 'script' ? new ScriptStrategy() : new AIStrategy());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentPhase, setCurrentPhase] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [started, setStarted] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const phaseName = PHASE_NAMES[currentPhase] + '中';
  const phaseLabel = PHASE_LABELS[currentPhase];

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  /** 模拟打字延迟（脚本模式使用） */
  const simulateTyping = useCallback(
    (content: string, callback: () => void) => {
      setIsTyping(true);
      setQuickReplies([]);
      const delay = Math.min(800 + content.length * 15, 2500);
      typingTimerRef.current = setTimeout(callback, delay);
    },
    [],
  );

  /** 处理策略返回结果 */
  const handleResult = useCallback(
    (result: { message: ChatMessage; quickReplies: string[]; phase: number }, isScriptMode: boolean) => {
      if (isScriptMode) {
        // 脚本模式：模拟打字效果
        simulateTyping(result.message.content, () => {
          setIsTyping(false);
          addMessage(result.message);
          setCurrentPhase(result.phase);
          if (result.quickReplies.length > 0) {
            const delay = result.message.type !== 'text' ? 1200 : 500;
            setTimeout(() => setQuickReplies(result.quickReplies), delay);
          }
        });
      } else {
        // AI 模式：直接展示（网络延迟已自然产生等待感）
        setIsTyping(false);
        addMessage(result.message);
        setCurrentPhase(result.phase);
        setQuickReplies(result.quickReplies);
      }
    },
    [addMessage, simulateTyping],
  );

  const startChat = useCallback(() => {
    setStarted(true);
    strategyRef.current.reset();
    setMessages([]);
    setCurrentPhase(0);

    const isScriptMode = mode === 'script';
    setIsTyping(true);
    setQuickReplies([]);

    strategyRef.current.start().then((result) => {
      handleResult(result, isScriptMode);
    });
  }, [mode, handleResult]);

  const selectQuickReply = useCallback(
    (text: string) => {
      if (text === '✍️ 我想自己说') {
        setQuickReplies([]);
        return;
      }
      // 添加用户消息
      const userMsg: ChatMessage = {
        id: `user_${Date.now()}`,
        content: text,
        isUser: true,
        type: 'text',
        timestamp: Date.now(),
      };
      addMessage(userMsg);
      setQuickReplies([]);

      const isScriptMode = mode === 'script';
      setIsTyping(true);

      // 脚本模式加延迟，AI 模式直接请求
      const delay = isScriptMode ? 600 : 0;
      setTimeout(() => {
        strategyRef.current.selectReply(text).then((result) => {
          if (result) handleResult(result, isScriptMode);
        });
      }, delay);
    },
    [mode, addMessage, handleResult],
  );

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim() || isTyping) return;

      const userMsg: ChatMessage = {
        id: `user_${Date.now()}`,
        content: text.trim(),
        isUser: true,
        type: 'text',
        timestamp: Date.now(),
      };
      addMessage(userMsg);
      setQuickReplies([]);

      const isScriptMode = mode === 'script';
      setIsTyping(true);

      const delay = isScriptMode ? 600 : 0;
      setTimeout(() => {
        strategyRef.current.sendMessage(text.trim()).then((result) => {
          if (result) {
            handleResult(result, isScriptMode);
          } else {
            setIsTyping(false);
          }
        });
      }, delay);
    },
    [mode, isTyping, addMessage, handleResult],
  );

  const acceptInsight = useCallback(
    (msgId: string) => {
      // 更新消息状态（不再使用 as any）
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id === msgId && m.type === 'insight' && m.insightData) {
            const updatedInsight: InsightData = { ...m.insightData, accepted: true };
            return { ...m, insightData: updatedInsight };
          }
          return m;
        }),
      );

      const isScriptMode = mode === 'script';
      setIsTyping(true);

      const delay = isScriptMode ? 1000 : 0;
      setTimeout(() => {
        strategyRef.current.acceptInsight(msgId).then((result) => {
          if (result) handleResult(result, isScriptMode);
        });
      }, delay);
    },
    [mode, handleResult],
  );

  const reviseInsight = useCallback(
    (msgId: string) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id === msgId && m.type === 'insight' && m.insightData) {
            const updatedInsight: InsightData = { ...m.insightData, revised: true };
            return { ...m, insightData: updatedInsight };
          }
          return m;
        }),
      );

      const userMsg: ChatMessage = {
        id: `user_${Date.now()}`,
        content: '部分对，让我再说说……',
        isUser: true,
        type: 'text',
        timestamp: Date.now(),
      };
      addMessage(userMsg);

      const isScriptMode = mode === 'script';
      setIsTyping(true);

      const delay = isScriptMode ? 800 : 0;
      setTimeout(() => {
        strategyRef.current.reviseInsight(msgId, '').then((result) => {
          if (result) handleResult(result, isScriptMode);
        });
      }, delay);
    },
    [mode, addMessage, handleResult],
  );

  const selectAction = useCallback(
    (title: string) => {
      const userMsg: ChatMessage = {
        id: `user_${Date.now()}`,
        content: title + '，我想深入了解一下',
        isUser: true,
        type: 'text',
        timestamp: Date.now(),
      };
      addMessage(userMsg);
      setIsTyping(true);

      const isScriptMode = mode === 'script';
      const delay = isScriptMode ? 1500 : 0;
      setTimeout(() => {
        strategyRef.current.selectAction(title).then((result) => {
          if (result) handleResult(result, isScriptMode);
        });
      }, delay);
    },
    [mode, addMessage, handleResult],
  );

  const resetChat = useCallback(() => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    strategyRef.current.reset();
    setMessages([]);
    setQuickReplies([]);
    setIsTyping(false);
    setCurrentPhase(0);
    setStarted(true);

    const isScriptMode = mode === 'script';
    setIsTyping(true);

    strategyRef.current.start().then((result) => {
      handleResult(result, isScriptMode);
    });
  }, [mode, handleResult]);

  return {
    messages,
    currentPhase,
    isTyping,
    quickReplies,
    started,
    phaseName,
    phaseLabel,
    startChat,
    selectQuickReply,
    sendMessage,
    acceptInsight,
    reviseInsight,
    selectAction,
    resetChat,
  };
}
