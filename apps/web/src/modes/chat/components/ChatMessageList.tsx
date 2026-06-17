import { useRef, useEffect } from 'react';
import type { ChatMessagesData, ChatStatus } from 'tdesign-web-components/lib/chat-engine';
import { ChatMessage } from '@tdesign-react/chat';
import { ChatMessageItem } from './ChatMessageItem';

interface Props {
  messages: ChatMessagesData[];
  status: ChatStatus;
}

export function ChatMessageList({ messages, status }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="chat-messages-empty">
        <div className="chat-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
        </div>
        <div className="chat-empty-title">有什么可以帮你的？</div>
        <div className="chat-empty-desc">开始对话，我会记住上下文并持续回答</div>
      </div>
    );
  }

  return (
    <div className="chat-messages">
      {messages.map((msg) => (
        <ChatMessageItem key={msg.id} message={msg} />
      ))}
      {status === 'streaming' && (
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
