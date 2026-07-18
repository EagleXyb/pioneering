import { useState, useEffect, useRef, useCallback } from 'react';
import { useChat } from '@tdesign-react/chat';
import { MessagePlugin } from 'tdesign-react';
import { ChatMessageList } from './components/ChatMessageList';
import { ChatInput } from './components/ChatInput';
import { ChatWelcome } from './components/ChatWelcome';
import { useConversationStore } from '../../store/conversationStore';
import { useChatSync } from './hooks/useChatSync';
import { getMessages, stopGeneration, regenerateMessage } from '../../api/message';
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
  hasMoreHistory,
  loadingMoreHistory,
  onLoadMoreHistory,
  onReplay,
}: {
  activeId: string | null;
  historyMessages: ChatMessageData[];
  inputValue: string;
  onInputChange: (v: string) => void;
  hasMoreHistory: boolean;
  loadingMoreHistory: boolean;
  onLoadMoreHistory: () => void;
  onReplay: (messageId: string) => Promise<void>;
}) {
  const create = useConversationStore((s) => s.create);
  const [r1Active, setR1Active] = useState(false);

  // 用 ref 保持最新值，避免 onRequest 闭包捕获陈旧值
  const r1ActiveRef = useRef(r1Active);
  r1ActiveRef.current = r1Active;

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

  // 重新生成：P0-2 修复 —— 不再走 completions 重发用户消息（会重复写入）
  // 改为调用专用 regenerate 端点，复用既有 user 消息，仅生成新 assistant 消息
  const handleReplay = useCallback(async (messageId: string) => {
    await onReplay(messageId);
  }, [onReplay]);

  return (
    <>
      <div className="chat-scroll-area">
        {/* 空态 / 初始欢迎页 */}
        {messages.length === 0 ? (
          <ChatWelcome onSuggestion={handleSuggestionClick} />
        ) : (
          <ChatMessageList
            messages={messages}
            status={status}
            onReplay={handleReplay}
            hasMoreHistory={hasMoreHistory}
            loadingMoreHistory={loadingMoreHistory}
            onLoadMoreHistory={onLoadMoreHistory}
          />
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
  // 历史消息分页状态
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  /** 加载更多历史消息时保持滚动位置 */
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);

  // 切换会话时加载历史消息（含竞态保护）
  useEffect(() => {
    if (!activeId) {
      setHistoryMessages([]);
      setHasMoreHistory(false);
      setHistoryCursor(null);
      return;
    }
    // 立即清空，令 chatEngine.setMessages([]) 先清除旧消息
    setHistoryMessages([]);
    setHasMoreHistory(false);
    setHistoryCursor(null);
    loadingHistory.current = true;
    const loadingForId = activeId;
    getMessages(activeId, undefined, 50, 'before')
      .then((resp) => {
        // 竞态保护：仅在当前会话仍活跃时应用响应
        if (loadingForId === useConversationStore.getState().activeId) {
          setHistoryMessages(convertMessages(resp.messages));
          setHasMoreHistory(resp.hasMore);
          setHistoryCursor(resp.nextCursor);
        }
      })
      .catch(() => {
        if (loadingForId === useConversationStore.getState().activeId) {
          setHistoryMessages([]);
          setHasMoreHistory(false);
          setHistoryCursor(null);
        }
      })
      .finally(() => {
        loadingHistory.current = false;
      });
  }, [activeId]);

  // 加载更早的历史消息（向上分页）
  const handleLoadMoreHistory = useCallback(() => {
    if (!activeId || !historyCursor || loadingMoreHistory) return;
    setLoadingMoreHistory(true);
    // 记录加载前的滚动高度，加载后恢复以保持用户视觉位置
    const scrollArea = scrollAreaRef.current?.querySelector('.chat-messages');
    prevScrollHeightRef.current = scrollArea?.scrollHeight ?? 0;

    getMessages(activeId, historyCursor, 50, 'before')
      .then((resp) => {
        if (activeId !== useConversationStore.getState().activeId) return;
        // prepend 更早的消息到列表头部
        const older = convertMessages(resp.messages);
        setHistoryMessages((prev) => [...older, ...prev]);
        setHasMoreHistory(resp.hasMore);
        setHistoryCursor(resp.nextCursor);
        // 恢复滚动位置
        requestAnimationFrame(() => {
          const newScrollArea = scrollAreaRef.current?.querySelector('.chat-messages');
          if (newScrollArea && prevScrollHeightRef.current) {
            const diff = newScrollArea.scrollHeight - prevScrollHeightRef.current;
            newScrollArea.scrollTop += diff;
          }
        });
      })
      .catch(() => {
        // 加载失败不影响现有消息
      })
      .finally(() => {
        setLoadingMoreHistory(false);
      });
  }, [activeId, historyCursor, loadingMoreHistory]);

  // P0-2 修复：重新加载当前会话的历史消息（用于重新生成后刷新）
  const reloadHistory = useCallback(() => {
    if (!activeId) return;
    const loadingForId = activeId;
    getMessages(activeId, undefined, 50, 'before')
      .then((resp) => {
        if (loadingForId === useConversationStore.getState().activeId) {
          setHistoryMessages(convertMessages(resp.messages));
          setHasMoreHistory(resp.hasMore);
          setHistoryCursor(resp.nextCursor);
        }
      })
      .catch(() => {
        // 加载失败保持现有消息
      });
  }, [activeId]);

  // P0-2 修复：重新生成 —— 调用专用 regenerate 端点（不重复写入用户消息），
  // 成功后重新加载历史消息以显示新的 assistant 回复
  // P0-5：配额超限（429）或其他错误时弹 toast 提示
  const handleReplay = useCallback(async (messageId: string) => {
    try {
      await regenerateMessage(messageId);
      reloadHistory();
    } catch (e: any) {
      const msg = e?.message || '重新生成失败';
      MessagePlugin.info(msg);
    }
  }, [regenerateMessage, reloadHistory]);

  return (
    <div className="chat-mode" ref={scrollAreaRef}>
      {/*
        不再使用 key 强制重挂载，改用 chatEngine.setMessages 手动同步历史消息。
        见 ChatSession 内部 useEffect。
      */}
      <ChatSession
        activeId={activeId}
        historyMessages={historyMessages}
        inputValue={inputValue}
        onInputChange={setInputValue}
        hasMoreHistory={hasMoreHistory}
        loadingMoreHistory={loadingMoreHistory}
        onLoadMoreHistory={handleLoadMoreHistory}
        onReplay={handleReplay}
      />
    </div>
  );
}
