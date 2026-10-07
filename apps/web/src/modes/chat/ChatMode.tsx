/**
 * Chat 模式（自研 useAguiChat）
 *
 * 会话级职责：
 * 历史消息手动同步（切换会话/向上分页/重生成后刷新）+ 竞态保护 + 滚动位置保持
 * 无会话/temp 会话时创建会话后再发送
 * 停止：前端 abort + 后端 /stop；重生成：专用 regenerate 端点后刷新历史
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { ChatMessageList } from './components/ChatMessageList';
import { ChatInput } from './components/ChatInput';
import { ChatWelcome } from './components/ChatWelcome';
import { useConversationStore } from '../../store/conversationStore';
import { useChatSync } from './hooks/useChatSync';
import { useAguiChat } from './hooks/useAguiChat';
import { getMessages, stopGeneration, regenerateMessage } from '../../api/message';
import { convertMessages } from '../../api/converter';
import type { ChatMessageData } from '../../api/converter';
import { useSourcesPanelStore } from '../../store/sourcesPanelStore';
import './chat.css';

// ─── 子组件：持有 useAguiChat 实例 ─────────────────────────────────
function ChatSession({
  activeId,
  historyMessages,
  hasMoreHistory,
  loadingMoreHistory,
  onLoadMoreHistory,
  onReplay,
}: {
  activeId: string | null;
  historyMessages: ChatMessageData[];
  hasMoreHistory: boolean;
  loadingMoreHistory: boolean;
  onLoadMoreHistory: () => void;
  onReplay: (messageId: string) => Promise<void>;
}) {
  const create = useConversationStore((s) => s.create);
  const [r1Active, setR1Active] = useState(false);
  const r1ActiveRef = useRef(r1Active);
  r1ActiveRef.current = r1Active;
  const [netSearchActive, setNetSearchActive] = useState(false);
  const netSearchRef = useRef(netSearchActive);
  netSearchRef.current = netSearchActive;

  const { messages, status, setMessages, sendUserMessage, abortChat } =
    useAguiChat(() => useConversationStore.getState().activeId);

  // 历史消息整包同步（会话切换/分页/重生成后由父组件下发）
  useEffect(() => {
    setMessages(historyMessages, 'replace');
  }, [historyMessages, setMessages]);

  useChatSync(activeId, messages);

  // 统一发送：必要时先建会话，再交给 hook 发起流式请求
  const handleSend = useCallback(
    async (text: string) => {
      const store = useConversationStore.getState();

      if (!store.activeId) {
        try {
          await create('chat');
        } catch {
          // 会话创建失败：侧边栏会展示列表错误，这里再给一次即时反馈，
          // 避免用户在对话区无任何感知
          toast.error('创建会话失败，请稍后重试');
          return;
        }
      } else if (store.activeId.startsWith('temp_')) {
        // 乐观创建的临时会话：等待真实 ID
        if (store.createPromise) {
          try {
            await store.createPromise;
          } catch {
            toast.error('创建会话失败，请稍后重试');
            return;
          }
        } else {
          return;
        }
      }

      sendUserMessage({
        prompt: text,
        deepThink: r1ActiveRef.current,
        netSearch: netSearchRef.current,
      });
    },
    [create, sendUserMessage],
  );

  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      handleSend(suggestion);
    },
    [handleSend],
  );

  // 停止：前端中止读取 + 通知后端停止生成（最后一条 assistant 消息）
  const handleStop = useCallback(() => {
    abortChat();
    const store = useConversationStore.getState();
    if (store.activeId) {
      const lastAssistant = [...messages]
        .reverse()
        .find((m) => m.role === 'assistant');
      if (lastAssistant) {
        stopGeneration({
          sessionId: store.activeId,
          messageId: lastAssistant.id,
        }).catch(() => {});
      }
    }
  }, [abortChat, messages]);

  return (
    <>
      <div className="chat-scroll-area">
        {messages.length === 0 ? (
          <ChatWelcome onSuggestion={handleSuggestionClick} />
        ) : (
          <ChatMessageList
            messages={messages}
            status={status}
            onReplay={(id) => void onReplay(id)}
            hasMoreHistory={hasMoreHistory}
            loadingMoreHistory={loadingMoreHistory}
            onLoadMoreHistory={onLoadMoreHistory}
          />
        )}
      </div>

      <ChatInput
        activeId={activeId}
        status={status}
        onSend={handleSend}
        onStop={handleStop}
        r1Active={r1Active}
        onR1Change={setR1Active}
        netSearchActive={netSearchActive}
        onNetSearchChange={setNetSearchActive}
      />
    </>
  );
}

// ─── 顶层容器：历史加载/分页/重生成 ─────────────────────────────────
export default function ChatMode() {
  const activeId = useConversationStore((s) => s.activeId);
  const resetSourcesPanel = useSourcesPanelStore((s) => s.reset);

  const loadingHistory = useRef(false);
  const [historyMessages, setHistoryMessages] = useState<ChatMessageData[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  /** 加载更多历史时保持滚动位置 */
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);

  // 切换会话时关闭参考来源面板（来源从属于具体消息，避免跨会话残留）
  useEffect(() => {
    resetSourcesPanel();
  }, [activeId, resetSourcesPanel]);

  // 切换会话时加载历史（竞态保护）
  useEffect(() => {
    if (!activeId) {
      setHistoryMessages([]);
      setHasMoreHistory(false);
      setHistoryCursor(null);
      return;
    }
    // 立即清空，令子组件先清空旧消息
    setHistoryMessages([]);
    setHasMoreHistory(false);
    setHistoryCursor(null);
    loadingHistory.current = true;
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

  // 向上分页
  const handleLoadMoreHistory = useCallback(() => {
    if (!activeId || !historyCursor || loadingMoreHistory) return;
    setLoadingMoreHistory(true);
    const scrollArea = scrollAreaRef.current?.querySelector('.chat-messages');
    prevScrollHeightRef.current = scrollArea?.scrollHeight ?? 0;

    getMessages(activeId, historyCursor, 50, 'before')
      .then((resp) => {
        if (activeId !== useConversationStore.getState().activeId) return;
        const older = convertMessages(resp.messages);
        setHistoryMessages((prev) => [...older, ...prev]);
        setHasMoreHistory(resp.hasMore);
        setHistoryCursor(resp.nextCursor);
        requestAnimationFrame(() => {
          const newScrollArea =
            scrollAreaRef.current?.querySelector('.chat-messages');
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

  // 重新生成后刷新历史
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

  // 重新生成：专用端点（不重复写入用户消息），成功后刷新历史
  const handleReplay = useCallback(
    async (messageId: string) => {
      try {
        await regenerateMessage(messageId);
        reloadHistory();
      } catch (e) {
        toast((e as { message?: string })?.message || '重新生成失败');
      }
    },
    [reloadHistory],
  );

  return (
    <div className="chat-mode" ref={scrollAreaRef}>
      <ChatSession
        activeId={activeId}
        historyMessages={historyMessages}
        hasMoreHistory={hasMoreHistory}
        loadingMoreHistory={loadingMoreHistory}
        onLoadMoreHistory={handleLoadMoreHistory}
        onReplay={handleReplay}
      />
    </div>
  );
}
