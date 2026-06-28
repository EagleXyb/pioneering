import { useState, useEffect, useRef, useCallback } from 'react';
import { useChat } from '@tdesign-react/chat';
import { ChatMessageList } from './components/ChatMessageList';
import { ChatInput } from './components/ChatInput';
import { useConversationStore } from '../../store/conversationStore';
import { useChatSync } from './hooks/useChatSync';
import { getMessages, stopGeneration } from '../../api/message';
import { convertMessages } from '../../api/converter';
import { getAuthHeader } from '../../api/client';
import type { ChatMessagesData } from 'tdesign-web-components/lib/chat-engine';
import './chat.css';

// ─── 子组件：持有 useChat 实例 ─────────────────────────────────────
// 通过 key={activeId} 强制重挂载，确保 defaultMessages 在切换会话时重新生效
function ChatSession({
  activeId,
  historyMessages,
  inputValue,
  onInputChange,
}: {
  activeId: string | null;
  historyMessages: ChatMessagesData[];
  inputValue: string;
  onInputChange: (v: string) => void;
}) {
  const create = useConversationStore((s) => s.create);
  const [r1Active, setR1Active] = useState(false);
  const [searchActive, setSearchActive] = useState(false);

  // 用 ref 保持最新值，避免 onRequest 闭包捕获陈旧值
  const r1ActiveRef = useRef(r1Active);
  const searchActiveRef = useRef(searchActive);
  r1ActiveRef.current = r1Active;
  searchActiveRef.current = searchActive;

  const { chatEngine, messages, status } = useChat({
    chatServiceConfig: {
      endpoint: '/api/chat/completions',
      stream: true,
      protocol: 'agui',
      onRequest: (params) => {
        // 从 store 读取最新值，避免 useChat 闭包捕获过期值
        const store = useConversationStore.getState();
        return {
          ...params,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader(),
          },
          body: JSON.stringify({
            sessionId: store.activeId,
            message: params.prompt,
            stream: true,
            deepThink: r1ActiveRef.current,
            netSearch: searchActiveRef.current,
          }),
        };
      },
    },
    defaultMessages: historyMessages,
  });

  useChatSync(activeId, messages);

  // 统一发送逻辑：创建会话 + 发送消息
  const handleSend = useCallback(async (text: string) => {
    if (!activeId) {
      try {
        await create('chat');
      } catch {
        // 创建会话失败，不继续发送（P0-3 修复）
        return;
      }
    }
    chatEngine.sendUserMessage({ prompt: text });
  }, [activeId, create, chatEngine]);

  // 建议词点击：直接发送
  const handleSuggestionClick = useCallback((suggestion: string) => {
    handleSend(suggestion);
  }, [handleSend]);

  // 停止生成
  const handleStop = useCallback(() => {
    chatEngine.abortChat();
    const store = useConversationStore.getState();
    if (store.activeId) {
      // 取最后一条 assistant 消息，避免误取用户消息（P0-4 修复）
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      if (lastAssistant) {
        stopGeneration({ sessionId: store.activeId, messageId: lastAssistant.id }).catch(() => {});
      }
    }
  }, [chatEngine, messages]);

  return (
    <>
      <div className="chat-scroll-area">
        {/* 空态 */}
        {messages.length === 0 ? (
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
        ) : (
          <ChatMessageList messages={messages} status={status} />
        )}
      </div>

      <ChatInput
        status={status}
        value={inputValue}
        onChange={onInputChange}
        onSend={handleSend}
        onStop={handleStop}
        r1Active={r1Active}
        onR1Change={setR1Active}
        searchActive={searchActive}
        onSearchChange={setSearchActive}
      />
    </>
  );
}

// ─── 顶层容器 ─────────────────────────────────────────────────────
export default function ChatMode() {
  const activeId = useConversationStore((s) => s.activeId);

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

  return (
    <div className="chat-mode">
      {/*
        关键修复 P0-1：
        用 key={activeId || 'empty'} 强制 React 重挂载 ChatSession，
        使内部 useChat 重新初始化，从而 defaultMessages = historyMessages 生效。
      */}
      <ChatSession
        key={activeId || 'empty'}
        activeId={activeId}
        historyMessages={historyMessages}
        inputValue={inputValue}
        onInputChange={setInputValue}
      />
    </div>
  );
}
