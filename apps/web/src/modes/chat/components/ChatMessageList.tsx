/**
 * 聊天消息列表
 * 自动滚动（底部哨兵 + 近底部判定）与顶部历史分页。
 */
import { useRef, useEffect } from 'react';
import type { ChatStatus } from '../../../types/chat';
import type { ChatMessageData } from '../../../api/converter';
import { ChatMessageItem } from './ChatMessageItem';

interface Props {
  messages: ChatMessageData[];
  status: ChatStatus;
  onReplay?: (messageId: string) => void;
  /** 是否还有更早的历史消息可加载 */
  hasMoreHistory?: boolean;
  /** 是否正在加载更早的历史消息 */
  loadingMoreHistory?: boolean;
  /** 加载更早历史消息的回调 */
  onLoadMoreHistory?: () => void;
  /** 用户消息是否可编辑（流式中禁用） */
  canEditUserMessage?: boolean;
  /** 当前处于编辑态的消息 id（同一时刻仅一条） */
  editingMessageId?: string | null;
  /** 编辑提交中（禁用发送/取消） */
  submittingEdit?: boolean;
  onStartEdit?: (messageId: string) => void;
  onCancelEdit?: () => void;
  onSubmitEdit?: (messageId: string, nextText: string) => void | Promise<void>;
}

function TypingDots() {
  return (
    <div className="chat-msg-row chat-msg-row--ai">
      <div className="chat-typing" aria-label="正在输入">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export function ChatMessageList({
  messages,
  status,
  onReplay,
  hasMoreHistory,
  loadingMoreHistory,
  onLoadMoreHistory,
  canEditUserMessage = false,
  editingMessageId = null,
  submittingEdit = false,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  // 底部哨兵：判断用户是否在底部附近，用于自动滚动
  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        isNearBottomRef.current = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 顶部哨兵：滚动到顶部时加载更早消息
  useEffect(() => {
    if (!hasMoreHistory || loadingMoreHistory || !onLoadMoreHistory) return;
    const el = topSentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMoreHistory();
        }
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMoreHistory, loadingMoreHistory, onLoadMoreHistory]);

  // 最后一条消息的文本长度（含 reasoning），作为流式增长的自动滚动依赖
  const lastContentLen =
    messages.length > 0
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((messages[messages.length - 1].content as any[] | undefined)?.reduce(
          (sum: number, c: any) => {
            if (typeof c?.data === 'string') return sum + c.data.length;
            if (Array.isArray(c?.data)) {
              return (
                sum +
                c.data.reduce(
                  (n: number, d: { data?: string }) =>
                    n + (typeof d.data === 'string' ? d.data.length : 0),
                  0,
                )
              );
            }
            return sum;
          },
          0,
        ) ?? 0)
      : 0;

  useEffect(() => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages.length, lastContentLen, status]);

  return (
    <div className="chat-messages">
      {hasMoreHistory && (
        <div ref={topSentinelRef} className="chat-load-more-top">
          {loadingMoreHistory ? (
            <span className="chat-load-more-text">加载历史消息...</span>
          ) : (
            <span className="chat-load-more-hint">滚动到顶部加载更多</span>
          )}
        </div>
      )}
      {messages.map((msg) => (
        <ChatMessageItem
          key={msg.id}
          message={msg}
          onReplay={onReplay}
          editable={canEditUserMessage && msg.role === 'user'}
          editing={msg.role === 'user' && editingMessageId === msg.id}
          submittingEdit={submittingEdit && editingMessageId === msg.id}
          onStartEdit={onStartEdit}
          onCancelEdit={onCancelEdit}
          onSubmitEdit={onSubmitEdit}
        />
      ))}
      {status === 'pending' && <TypingDots />}
      <div ref={bottomRef} />
    </div>
  );
}
