import React, { useRef, useEffect } from 'react';
import type { ChatMessagesData, ChatStatus } from 'tdesign-web-components/lib/chat-engine';

interface Props {
  messages: ChatMessagesData[];
  status: ChatStatus;
}

function getMessageText(msg: ChatMessagesData): string {
  if (!msg.content || msg.content.length === 0) return '';
  return msg.content
    .map((c: any) => {
      if (c.type === 'text' || c.type === 'markdown') return c.data || '';
      if (c.type === 'thinking') return `[思考: ${c.data?.title || c.data?.text || ''}]`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export function TaskMessageList({ messages, status }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="task-messages-empty">
        <div className="task-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="1" y="1" width="22" height="22" rx="2"/>
            <path d="M7 8h10M7 12h6M7 16h8"/>
          </svg>
        </div>
        <div className="task-empty-title">任务模式</div>
        <div className="task-empty-desc">创建任务，Agent 将自动规划并执行多步骤操作</div>
      </div>
    );
  }

  return (
    <div className="task-messages">
      {messages.map((msg) => {
        const isUser = msg.role === 'user';
        const text = getMessageText(msg);
        return (
          <div key={msg.id} className={`task-message${isUser ? ' task-message-user' : ' task-message-assistant'}`}>
            {!isUser && (
              <div className="task-message-avatar task-message-avatar-ai">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 2a4 4 0 014 4c0 2.5-1.5 4-4 6-2.5-2-4-3.5-4-6a4 4 0 014-4z"/>
                  <path d="M8 14c-3 1-6 3-6 6v1h20v-1c0-3-3-5-6-6"/>
                </svg>
              </div>
            )}
            <div className={`task-message-content${isUser ? ' task-message-content-user' : ''}`}>
              <div className="task-message-text">{text}</div>
            </div>
            {isUser && (
              <div className="task-message-avatar task-message-avatar-user">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="8" r="4"/>
                  <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                </svg>
              </div>
            )}
          </div>
        );
      })}
      {status === 'streaming' && (
        <div className="task-message task-message-assistant">
          <div className="task-message-avatar task-message-avatar-ai">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2a4 4 0 014 4c0 2.5-1.5 4-4 6-2.5-2-4-3.5-4-6a4 4 0 014-4z"/>
              <path d="M8 14c-3 1-6 3-6 6v1h20v-1c0-3-3-5-6-6"/>
            </svg>
          </div>
          <div className="task-message-content">
            <div className="task-thinking-indicator">
              <span className="task-dot" />
              <span className="task-dot" />
              <span className="task-dot" />
            </div>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}