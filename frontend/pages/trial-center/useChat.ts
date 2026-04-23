import { useState, useCallback } from 'react';
import type { DisplayMessage } from './types';
import { MAX_INPUT_LENGTH, MAX_CONTEXT_MESSAGES } from './types';
import { useStreamChat } from './useStreamChat';
import type { ChatMessage } from '../../services/llmService';

export function useChat() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const updateMessage = useCallback((id: string, updates: Partial<DisplayMessage>) => {
    setMessages(prev => prev.map(msg => msg.id === id ? { ...msg, ...updates } : msg));
  }, []);

  const { startStream, stopStream } = useStreamChat(updateMessage, setIsGenerating);

  const getContextMessages = useCallback((): ChatMessage[] => {
    const contextMsgs = messages
      .filter(m => m.role !== 'system' && m.status === 'success')
      .slice(-MAX_CONTEXT_MESSAGES);
    return contextMsgs.map(m => ({ role: m.role, content: m.content }));
  }, [messages]);

  const handleSend = useCallback(
    async (
      aiConfig: { apiKey: string; provider: string; model: string; prompt: string } | null,
      selectedModel: string,
    ) => {
      const trimmed = inputValue.trim();
      if (!trimmed || isGenerating) return;
      if (trimmed.length > MAX_INPUT_LENGTH) return;

      const userMsg: DisplayMessage = {
        id: `user_${Date.now()}`,
        role: 'user',
        content: trimmed,
        status: 'success',
        timestamp: Date.now(),
      };

      const assistantMsg: DisplayMessage = {
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: '',
        status: 'loading',
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, userMsg, assistantMsg]);
      setInputValue('');
      setIsGenerating(true);

      const config = aiConfig || { apiKey: '', provider: 'minimax', model: selectedModel, prompt: '' };

      const contextMessages = getContextMessages();
      contextMessages.push({ role: 'user', content: trimmed });

      startStream(
        assistantMsg.id,
        config,
        contextMessages,
        (accumulatedContent) => {
          updateMessage(assistantMsg.id, { content: accumulatedContent, status: 'success' });
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
    [inputValue, isGenerating, getContextMessages, startStream, updateMessage],
  );

  const handleStopGeneration = useCallback(() => {
    stopStream(messages, (msgId, hasContent) => {
      updateMessage(msgId, {
        status: hasContent ? 'success' : 'error',
        error: hasContent ? undefined : '生成已停止',
      });
    });
  }, [messages, stopStream, updateMessage]);

  const handleRetry = useCallback(
    (
      messageId: string,
      aiConfig: { apiKey: string; provider: string; model: string; prompt: string } | null,
      selectedModel: string,
    ) => {
      const msgIndex = messages.findIndex(m => m.id === messageId);
      if (msgIndex === -1) return;

      const userMsgIndex = msgIndex - 1;
      if (userMsgIndex < 0 || messages[userMsgIndex].role !== 'user') return;

      const userContent = messages[userMsgIndex].content;

      setMessages(prev => prev.slice(0, userMsgIndex + 1));

      const assistantMsg: DisplayMessage = {
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: '',
        status: 'loading',
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, assistantMsg]);
      setIsGenerating(true);

      const config = aiConfig || { apiKey: '', provider: 'minimax', model: selectedModel, prompt: '' };

      const contextMsgs = messages.slice(0, userMsgIndex).filter(m => m.role !== 'system' && m.status === 'success');
      const contextMessages: ChatMessage[] = contextMsgs.map(m => ({ role: m.role, content: m.content }));
      contextMessages.push({ role: 'user', content: userContent });

      startStream(
        assistantMsg.id,
        config,
        contextMessages,
        (accumulatedContent) => {
          updateMessage(assistantMsg.id, { content: accumulatedContent, status: 'success' });
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
    [messages, startStream, updateMessage],
  );

  const handleNewChat = useCallback(() => {
    if (isGenerating) return;
    setMessages([]);
    setInputValue('');
  }, [isGenerating]);

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
  };
}
