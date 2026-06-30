import { useState, useEffect, useRef, useCallback } from 'react';
import { useChat } from '@tdesign-react/chat';
import { ChatMessageList } from './components/ChatMessageList';
import { ChatInput } from './components/ChatInput';
import { useConversationStore } from '../../store/conversationStore';
import { useChatSync } from './hooks/useChatSync';
import { getMessages, stopGeneration } from '../../api/message';
import { convertMessages } from '../../api/converter';
import type { ChatMessageData } from '../../api/converter';
import { getAuthHeader } from '../../api/client';
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
  historyMessages: ChatMessageData[];
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
    // 不再依赖 defaultMessages 同步历史消息（改用下方手动同步）
    defaultMessages: [],
  });

  // 手动同步历史消息到 chatEngine，绕过 useChat 内部 length > 0 守卫
  useEffect(() => {
    chatEngine.setMessages(historyMessages, 'replace');
  }, [historyMessages, chatEngine]);

  useChatSync(activeId, messages);

  // 统一发送逻辑：创建会话 + 发送消息
  // 通过 store.getState() 读取最新状态，避免闭包捕获陈旧的 activeId
  // 利用 createPromise 实现并发去重：多次快速点击只创建一个会话
  const handleSend = useCallback(async (text: string) => {
    const store = useConversationStore.getState();

    if (!store.activeId) {
      // 无活跃会话，创建新会话
      try {
        await create('chat');
      } catch {
        return;
      }
    } else if (store.activeId.startsWith('temp_')) {
      // 当前是乐观更新的临时会话，等待后端创建完成再用真实 ID 发送
      if (store.createPromise) {
        try {
          await store.createPromise;
        } catch {
          return;
        }
      } else {
        // 异常状态（临时 ID 但无创建 Promise），不发送
        return;
      }
    }

    chatEngine.sendUserMessage({ prompt: text });
  }, [create, chatEngine]);

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

  // 重新生成：找到触发该回复的用户消息，重新发送以触发流式生成
  const handleReplay = useCallback((messageId: string) => {
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    // 向前找到最近的一条 user 消息
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const userMsg = messages[i];
        const textBlock = userMsg.content?.find(
          (c: any) => c.type === 'text' || c.type === 'markdown',
        );
        const text = typeof textBlock?.data === 'string' ? textBlock.data : '';
        if (text) {
          chatEngine.sendUserMessage({ prompt: text });
        }
        return;
      }
    }
  }, [messages, chatEngine]);

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
          <ChatMessageList messages={messages} status={status} onReplay={handleReplay} />
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
  const [historyMessages, setHistoryMessages] = useState<ChatMessageData[]>([]);
  const loadingHistory = useRef(false);

  // 切换会话时加载历史消息（含竞态保护）
  useEffect(() => {
    if (!activeId) {
      setHistoryMessages([]);
      return;
    }
    // 立即清空，令 chatEngine.setMessages([]) 先清除旧消息
    setHistoryMessages([]);
    loadingHistory.current = true;
    const loadingForId = activeId;
    getMessages(activeId, undefined, 50, 'before')
      .then((resp) => {
        // 竞态保护：仅在当前会话仍活跃时应用响应
        if (loadingForId === useConversationStore.getState().activeId) {
          setHistoryMessages(convertMessages(resp.messages));
        }
      })
      .catch(() => {
        if (loadingForId === useConversationStore.getState().activeId) {
          setHistoryMessages([]);
        }
      })
      .finally(() => {
        loadingHistory.current = false;
      });
  }, [activeId]);

  return (
    <div className="chat-mode">
      {/*
        不再使用 key 强制重挂载，改用 chatEngine.setMessages 手动同步历史消息。
        见 ChatSession 内部 useEffect。
      */}
      <ChatSession
        activeId={activeId}
        historyMessages={historyMessages}
        inputValue={inputValue}
        onInputChange={setInputValue}
      />
    </div>
  );
}
