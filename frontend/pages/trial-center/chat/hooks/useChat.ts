import { useState, useCallback, useRef, useEffect } from 'react';
import type { DisplayMessage } from '../../types';
import { MAX_INPUT_LENGTH, MAX_CONTEXT_MESSAGES, MAX_CONTEXT_TOKENS, MODEL_TO_PROVIDER } from '../../types/constants';
import { estimateTokens } from '../../utils/estimateTokens';
import { useStreamChat } from './useStreamChat';
import type { ChatMessage } from '../../../../services/llmService';
import chatConversationService from '../../../../services/chatConversationService';

type MsgIdMap = Map<string, string>;

// 自增计数器，确保同一毫秒内生成的 ID 不会重复
let _msgIdCounter = 0
function nextMsgId(prefix: string): string {
  return `${prefix}${Date.now()}_${++_msgIdCounter}`
}

export function useChat() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const msgIdMapRef = useRef<MsgIdMap>(new Map());
  const messagesRef = useRef<DisplayMessage[]>([]);
  messagesRef.current = messages;

  const updateMessage = useCallback((id: string, updates: Partial<DisplayMessage>) => {
    setMessages(prev => prev.map(msg => msg.id === id ? { ...msg, ...updates } : msg));
  }, []);

  const { startStream, stopStream, cleanupStream } = useStreamChat(updateMessage, setIsGenerating);

  useEffect(() => {
    return () => {
      cleanupStream();
    };
  }, [cleanupStream]);

  const getContextMessages = useCallback((): ChatMessage[] => {
    const eligible = messages
      .filter(m => m.role !== 'system' && m.status === 'success')
      .reverse();
    const result: ChatMessage[] = [];
    let tokenCount = 0;
    for (const m of eligible) {
      const msgTokens = estimateTokens(m.content);
      if (result.length >= MAX_CONTEXT_MESSAGES) break;
      if (tokenCount + msgTokens > MAX_CONTEXT_TOKENS) break;
      result.push({ role: m.role, content: m.content });
      tokenCount += msgTokens;
    }
    return result.reverse();
  }, [messages]);

  const loadConversation = useCallback(async (convId: string) => {
    try {
      const dbMessages = await chatConversationService.getMessages(convId);
      const displayMsgs: DisplayMessage[] = dbMessages.map(m => ({
        id: `db_${m.id}`,
        role: m.role,
        content: m.content,
        thinkingContent: m.thinkingContent || undefined,
        answerContent: m.answerContent || undefined,
        status: m.status,
        error: m.error || undefined,
        timestamp: new Date(m.createdAt).getTime(),
      }));
      const newMap = new Map<string, string>();
      dbMessages.forEach(m => {
        newMap.set(`db_${m.id}`, m.id);
      });
      msgIdMapRef.current = newMap;
      setConversationId(convId);
      setMessages(displayMsgs);
    } catch (e) {
      console.error('加载会话失败:', e);
    }
  }, []);

  const handleSend = useCallback(
    async (
      aiConfig: { provider: string; model: string; prompt: string } | null,
      selectedModel: string,
    ) => {
      const trimmed = inputValue.trim();
      if (!trimmed || isGenerating) return;
      if (trimmed.length > MAX_INPUT_LENGTH) return;

      const provider = aiConfig?.provider || MODEL_TO_PROVIDER[selectedModel] || 'minimax';
      const config = aiConfig || { provider, model: selectedModel, prompt: '' };

      let convId = conversationId;
      if (convId === null) {
        try {
          const conv = await chatConversationService.createSession({
            title: trimmed.slice(0, 20),
            model: selectedModel,
          });
          convId = conv.id;
          setConversationId(convId);
        } catch (e) {
          console.error('创建会话失败:', e);
          return;
        }
      }

      const userMsg: DisplayMessage = {
        id: nextMsgId('user_'),
        role: 'user',
        content: trimmed,
        status: 'success',
        timestamp: Date.now(),
      };

      const assistantMsg: DisplayMessage = {
        id: nextMsgId('assistant_'),
        role: 'assistant',
        content: '',
        status: 'loading',
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, userMsg, assistantMsg]);
      setInputValue('');
      setIsGenerating(true);

      const currentConvId = convId;

      startStream(
        assistantMsg.id,
        currentConvId!,
        trimmed,
        config.model,
        (accumulatedContent, thinkingContent, answerContent) => {
          updateMessage(assistantMsg.id, {
            content: accumulatedContent,
            thinkingContent,
            answerContent,
            status: 'success',
          });
          setIsGenerating(false);
        },
        (error, accumulatedContent) => {
          updateMessage(assistantMsg.id, {
            content: accumulatedContent || '',
            status: 'error',
            error,
          });
          setIsGenerating(false);
        },
      );
    },
    [inputValue, isGenerating, conversationId, getContextMessages, startStream, updateMessage],
  );

  const handleStopGeneration = useCallback(() => {
    stopStream(messagesRef.current, (msgId, hasContent) => {
      updateMessage(msgId, {
        status: hasContent ? 'success' : 'error',
        error: hasContent ? undefined : '生成已停止',
      });
    });
  }, [stopStream, updateMessage]);

  const handleRetry = useCallback(
    (
      messageId: string,
      aiConfig: { provider: string; model: string; prompt: string } | null,
      selectedModel: string,
    ) => {
      const msgIndex = messages.findIndex(m => m.id === messageId);
      if (msgIndex === -1) return;

      const userMsgIndex = msgIndex - 1;
      if (userMsgIndex < 0 || messages[userMsgIndex].role !== 'user') return;

      const userContent = messages[userMsgIndex].content;

      setMessages(prev => prev.slice(0, userMsgIndex + 1));

      const assistantMsg: DisplayMessage = {
        id: nextMsgId('assistant_'),
        role: 'assistant',
        content: '',
        status: 'loading',
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, assistantMsg]);
      setIsGenerating(true);

      const provider = aiConfig?.provider || MODEL_TO_PROVIDER[selectedModel] || 'minimax';
      const config = aiConfig || { provider, model: selectedModel, prompt: '' };

      const currentConvId = conversationId;

      startStream(
        assistantMsg.id,
        currentConvId!,
        userContent,
        config.model,
        (accumulatedContent, thinkingContent, answerContent) => {
          updateMessage(assistantMsg.id, {
            content: accumulatedContent,
            thinkingContent,
            answerContent,
            status: 'success',
          });
          setIsGenerating(false);
        },
        (error, accumulatedContent) => {
          updateMessage(assistantMsg.id, {
            content: accumulatedContent || '',
            status: 'error',
            error,
          });
          setIsGenerating(false);
        },
      );
    },
    [messages, conversationId, startStream, updateMessage],
  );

  const handleNewChat = useCallback(() => {
    if (isGenerating) return;
    setMessages([]);
    setInputValue('');
    setConversationId(null);
    msgIdMapRef.current = new Map();
  }, [isGenerating]);

  const handleSwitchConversation = useCallback(async (convId: string) => {
    if (isGenerating) return;
    await loadConversation(convId);
  }, [isGenerating, loadConversation]);

  const canSend = inputValue.trim().length > 0 && inputValue.trim().length <= MAX_INPUT_LENGTH && !isGenerating;

  return {
    messages,
    isGenerating,
    inputValue,
    setInputValue,
    canSend,
    updateMessage,
    handleSend,
    handleStopGeneration,
    handleRetry,
    handleNewChat,
    conversationId,
    handleSwitchConversation,
    loadConversation,
  };
}
