import { useState, useCallback, useRef, useEffect } from 'react';
import type { DisplayMessage } from './types';
import { MAX_INPUT_LENGTH, MAX_CONTEXT_MESSAGES } from './types';
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
    const contextMsgs = messages
      .filter(m => m.role !== 'system' && m.status === 'success')
      .slice(-MAX_CONTEXT_MESSAGES);
    return contextMsgs.map(m => ({ role: m.role, content: m.content }));
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

      const config = aiConfig || { apiKey: '', provider: 'minimax', model: selectedModel, prompt: '' };

      // 首次发送消息时创建会话
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

      // 持久化用户消息
      if (convId !== null) {
        try {
          const dbMsg = await chatConversationService.createMessage(convId, {
            role: 'user',
            content: trimmed,
            status: 'success',
          });
          msgIdMapRef.current.set(userMsg.id, dbMsg.id);
        } catch (e) {
          console.error('保存用户消息失败:', e);
        }

        // 持久化 assistant 占位消息
        try {
          const dbMsg = await chatConversationService.createMessage(convId, {
            role: 'assistant',
            content: '',
            status: 'loading',
          });
          msgIdMapRef.current.set(assistantMsg.id, dbMsg.id);
        } catch (e) {
          console.error('保存助手消息失败:', e);
        }
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

          // 流式完成后更新 DB 中的 assistant 消息
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

          // 流式出错时更新 DB
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

      // 持久化新的 assistant 占位消息
      if (conversationId !== null) {
        chatConversationService.createMessage(conversationId, {
          role: 'assistant',
          content: '',
          status: 'loading',
        }).then(dbMsg => {
          msgIdMapRef.current.set(assistantMsg.id, dbMsg.id);
        }).catch(e => console.error('保存助手消息失败:', e));
      }

      const config = aiConfig || { apiKey: '', provider: 'minimax', model: selectedModel, prompt: '' };

      const contextMsgs = messages.slice(0, userMsgIndex)
        .filter(m => m.role !== 'system' && m.status === 'success')
        .slice(-MAX_CONTEXT_MESSAGES);
      const contextMessages: ChatMessage[] = contextMsgs.map(m => ({ role: m.role, content: m.content }));
      contextMessages.push({ role: 'user', content: userContent });

      const currentConvId = conversationId;

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
