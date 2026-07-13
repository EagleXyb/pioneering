import { useRef, useEffect } from 'react';
import type { ChatStatus } from '../../../types/tdesign';
import { ChatMessage } from '@tdesign-react/chat';
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
}

export function ChatMessageList({
  messages,
  status,
  onReplay,
  hasMoreHistory,
  loadingMoreHistory,
  onLoadMoreHistory,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  // 底部哨兵：判断用户是否在底部附近，用于自动滚动
  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { isNearBottomRef.current = entry.isIntersecting; },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 顶部哨兵：当用户滚动到顶部时加载更早的历史消息
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

  // 计算最后一条消息的文本总长度，作为流式内容增长的依赖项。
  // 仅依赖 messages.length 无法捕获流式增量；依赖 messages 引用则过于频繁。
  const lastContentLen = messages.length > 0
    ? (messages[messages.length - 1].content?.reduce(
        (sum: number, c: any) => sum + (typeof c.data === 'string' ? c.data.length : 0), 0,
      ) ?? 0)
    : 0;

  // 仅在以下情况自动滚动到底部：
  //   1. 新消息加入（messages.length 变化）
  //   2. 流式内容增长（lastContentLen 变化）
  //   3. 状态切换（如 pending → streaming）
  // 且仅当用户在底部附近时才滚动，避免打断用户向上翻阅历史。
  useEffect(() => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages.length, lastContentLen, status]);

  return (
    <div className="chat-messages">
      {/* 顶部加载更多哨兵：用户滚动到顶部时触发加载更早消息 */}
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
        <ChatMessageItem key={msg.id} message={msg} onReplay={onReplay} />
      ))}
      {status === 'pending' && (
        <ChatMessage
          role="assistant"
          avatar=""
          variant="base"
          content={[]}
          animation="dots"
        />
      )}
      <div ref={bottomRef} />
    </div>
  );
}
