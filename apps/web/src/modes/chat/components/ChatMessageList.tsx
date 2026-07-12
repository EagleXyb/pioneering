import { useRef, useEffect } from 'react';
import type { ChatStatus } from '../../../types/tdesign';
import { ChatMessage } from '@tdesign-react/chat';
import type { ChatMessageData } from '../../../api/converter';
import { ChatMessageItem } from './ChatMessageItem';

interface Props {
  messages: ChatMessageData[];
  status: ChatStatus;
  onReplay?: (messageId: string) => void;
}

export function ChatMessageList({ messages, status, onReplay }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  // 使用 IntersectionObserver 监听底部哨兵元素是否可见，
  // 从而判断用户是否在滚动容器底部附近。用户向上翻阅时哨兵离开视口，
  // isNearBottomRef 变为 false，阻止自动滚动干扰用户阅读。
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
