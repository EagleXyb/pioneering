import { useState, useCallback, useRef, useEffect } from 'react';
import type { DisplayMessage } from './types';
import { MAX_INPUT_LENGTH, MAX_CONTEXT_MESSAGES, MAX_CONTEXT_TOKENS, MODEL_TO_PROVIDER, estimateTokens } from './types';
import { useStreamChat } from './useStreamChat';
import type { ChatMessage } from '../../services/llmService';
import chatConversationService from '../../services/chatConversationService';

// 本地消息与数据库消息的映射：localMsgId -> dbMsgId
type MsgIdMap = Map<string, number>;

export function useChat() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [conversationId, setConversationId] = useState<number | null>(null);
  const msgIdMapRef = useRef<MsgIdMap>(new Map());

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

  // 将 DB 消息加载到 DisplayMessage
  const loadConversation = useCallback(async (convId: number) => {
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
      // 重建 id 映射
      const newMap = new Map<string, number>();
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
      aiConfig: { apiKey: string; provider: string; model: string; prompt: string } | null,
      selectedModel: string,
    ) => {
      const trimmed = inputValue.trim();
      if (!trimmed || isGenerating) return;
      if (trimmed.length > MAX_INPUT_LENGTH) return;

      const provider = aiConfig?.provider || MODEL_TO_PROVIDER[selectedModel] || 'minimax';
      const config = aiConfig || { apiKey: '', provider, model: selectedModel, prompt: '' };

      let convId = conversationId;
      if (convId === null) {
        try {
          const conv = await chatConversationService.createConversation({
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

      if (convId !== null) {
        Promise.all([
          chatConversationService.createMessage(convId, {
            role: 'user',
            content: trimmed,
            status: 'success',
          }).then(dbMsg => {
            msgIdMapRef.current.set(userMsg.id, dbMsg.id);
          }).catch(e => console.error('保存用户消息失败:', e)),
          chatConversationService.createMessage(convId, {
            role: 'assistant',
            content: '',
            status: 'loading',
          }).then(dbMsg => {
            msgIdMapRef.current.set(assistantMsg.id, dbMsg.id);
          }).catch(e => console.error('保存助手消息失败:', e)),
        ]);
      }

      const contextMessages = getContextMessages();
      contextMessages.push({ role: 'user', content: trimmed });

      const currentConvId = convId;

      startStream(
        assistantMsg.id,
        config,
        contextMessages,
        (accumulatedContent, thinkingContent, answerContent) => {
          updateMessage(assistantMsg.id, {
            content: accumulatedContent,
            thinkingContent,
            answerContent,
            status: 'success',
          });
          setIsGenerating(false);

          const dbMsgId = msgIdMapRef.current.get(assistantMsg.id);
          if (currentConvId !== null && dbMsgId !== undefined) {
            chatConversationService.updateMessage(currentConvId, dbMsgId, {
              content: accumulatedContent,
              thinkingContent: thinkingContent || undefined,
              answerContent: answerContent || undefined,
              status: 'success',
            }).catch(e => console.error('更新助手消息失败:', e));
          }
        },
        (error, accumulatedContent) => {
          updateMessage(assistantMsg.id, {
            content: accumulatedContent || '',
            status: 'error',
            error,
          });
          setIsGenerating(false);

          const dbMsgId = msgIdMapRef.current.get(assistantMsg.id);
          if (currentConvId !== null && dbMsgId !== undefined) {
            chatConversationService.updateMessage(currentConvId, dbMsgId, {
              content: accumulatedContent || '',
              status: 'error',
              error,
            }).catch(e => console.error('更新助手消息失败:', e));
          }
        },
      );
    },
    [inputValue, isGenerating, conversationId, getContextMessages, startStream, updateMessage],
  );

  const handleStopGeneration = useCallback(() => {
    stopStream(messages, (msgId, hasContent) => {
      updateMessage(msgId, {
        status: hasContent ? 'success' : 'error',
        error: hasContent ? undefined : '生成已停止',
      });

      // 停止生成时也持久化最终状态
      const dbMsgId = msgIdMapRef.current.get(msgId);
      const msg = messages.find(m => m.id === msgId);
      if (conversationId !== null && dbMsgId !== undefined && msg) {
        chatConversationService.updateMessage(conversationId, dbMsgId, {
          content: msg.content,
          thinkingContent: msg.thinkingContent || undefined,
          answerContent: msg.answerContent || undefined,
          status: hasContent ? 'success' : 'error',
          error: hasContent ? undefined : '生成已停止',
        }).catch(e => console.error('更新消息失败:', e));
      }
    });
  }, [messages, conversationId, stopStream, updateMessage]);

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

      const eligibleMessages = messages.slice(0, userMsgIndex)
        .filter(m => m.role !== 'system' && m.status === 'success');
      const contextMsgs = eligibleMessages.slice(-MAX_CONTEXT_MESSAGES);

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

      const currentConvId = conversationId;
      if (currentConvId !== null) {
        chatConversationService.createMessage(currentConvId, {
          role: 'assistant',
          content: '',
          status: 'loading',
        }).then(dbMsg => {
          msgIdMapRef.current.set(assistantMsg.id, dbMsg.id);
        }).catch(e => console.error('保存助手消息失败:', e));
      }

      const provider = aiConfig?.provider || MODEL_TO_PROVIDER[selectedModel] || 'minimax';
      const config = aiConfig || { apiKey: '', provider, model: selectedModel, prompt: '' };

      const contextMessages: ChatMessage[] = contextMsgs.map(m => ({ role: m.role, content: m.content }));
      contextMessages.push({ role: 'user', content: userContent });

      startStream(
        assistantMsg.id,
        config,
        contextMessages,
        (accumulatedContent, thinkingContent, answerContent) => {
          updateMessage(assistantMsg.id, {
            content: accumulatedContent,
            thinkingContent,
            answerContent,
            status: 'success',
          });
          setIsGenerating(false);

          const dbMsgId = msgIdMapRef.current.get(assistantMsg.id);
          if (currentConvId !== null && dbMsgId !== undefined) {
            chatConversationService.updateMessage(currentConvId, dbMsgId, {
              content: accumulatedContent,
              thinkingContent: thinkingContent || undefined,
              answerContent: answerContent || undefined,
              status: 'success',
            }).catch(e => console.error('更新助手消息失败:', e));
          }
        },
        (error, accumulatedContent) => {
          updateMessage(assistantMsg.id, {
            content: accumulatedContent || '',
            status: 'error',
            error,
          });
          setIsGenerating(false);

          const dbMsgId = msgIdMapRef.current.get(assistantMsg.id);
          if (currentConvId !== null && dbMsgId !== undefined) {
            chatConversationService.updateMessage(currentConvId, dbMsgId, {
              content: accumulatedContent || '',
              status: 'error',
              error,
            }).catch(e => console.error('更新助手消息失败:', e));
          }
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

  // 切换到指定会话
  const handleSwitchConversation = useCallback(async (convId: number) => {
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
