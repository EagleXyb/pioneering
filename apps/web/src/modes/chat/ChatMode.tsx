import { useState, useEffect, useRef } from 'react';
import { useChat } from '@tdesign-react/chat';
import { ChatMessageList } from './components/ChatMessageList';
import { ChatInput } from './components/ChatInput';
import { useConversationStore } from '../../store/conversationStore';
import { useChatSync } from './hooks/useChatSync';
import { getMessages } from '../../api/message';
import { stopGeneration } from '../../api/message';
import { convertMessages } from '../../api/converter';
import { getToken } from '../../api/client';
import type { ChatMessagesData } from 'tdesign-web-components/lib/chat-engine';
import './chat.css';

export default function ChatMode() {
  const activeId = useConversationStore((s) => s.activeId);
  const create = useConversationStore((s) => s.create);

  const [inputValue, setInputValue] = useState('');
  const [historyMessages, setHistoryMessages] = useState<ChatMessagesData[]>([]);
  const loadingHistory = useRef(false);

  // 切换会话时加载历史消息
  useEffect(() => {
    if (!activeId) {
      setHistoryMessages([]);
      return;
    }
    loadingHistory.current = true;
    getMessages(activeId, undefined, 50, 'before')
      .then((resp) => {
        setHistoryMessages(convertMessages(resp.messages));
      })
      .catch(() => {
        setHistoryMessages([]);
      })
      .finally(() => {
        loadingHistory.current = false;
      });
  }, [activeId]);

  const { chatEngine, messages, status } = useChat({
    chatServiceConfig: {
      endpoint: '/api/chat/completions',
      stream: true,
      protocol: 'agui',
      onRequest: (params) => {
        return {
          ...params,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
          },
          body: JSON.stringify({
            sessionId: activeId,
            message: params.prompt,
            model: 'gpt-4o-mini',
            stream: true,
          }),
        };
      },
    },
    defaultMessages: historyMessages,
  });

  useChatSync(activeId, messages);

  // 统一发送逻辑：创建会话 + 发送消息
  const handleSend = async (text: string) => {
    if (!activeId) {
      await create('chat');
    }
    chatEngine.sendUserMessage({ prompt: text });
    setInputValue('');
  };

  // 建议词点击：直接发送
  const handleSuggestionClick = (suggestion: string) => {
    handleSend(suggestion);
  };

  // 停止生成
  const handleStop = () => {
    chatEngine.abortChat();
    if (activeId) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg) {
        stopGeneration({ sessionId: activeId, messageId: lastMsg.id }).catch(() => {});
      }
    }
  };

  if (!activeId) {
    return (
      <div className="chat-mode">
        <div className="chat-messages-empty">
          <div className="chat-empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
          </div>
          <div className="chat-empty-title">你好，有什么可以帮你的？</div>
          <div className="chat-suggestions-list">
            {['帮我分析销售流失原因', '本季度渠道回报如何', '新开产品线需要什么'].map((s, i) => (
              <button
                key={i}
                className="chat-suggestion-btn"
                onClick={() => handleSuggestionClick(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <ChatInput
          status={status}
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSend}
          onStop={handleStop}
        />
      </div>
    );
  }

  return (
    <div className="chat-mode">
      <ChatMessageList messages={messages} status={status} />
      <ChatInput
        status={status}
        value={inputValue}
        onChange={setInputValue}
        onSend={handleSend}
        onStop={handleStop}
      />
    </div>
  );
}
