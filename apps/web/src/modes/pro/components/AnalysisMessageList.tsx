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

export function AnalysisMessageList({ messages, status }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="pro-messages-empty">
        <div className="pro-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M2 2h4v4H2zM8 2h4v4H8zM2 8h4v4H2zM8 8h4v4H8z"/>
          </svg>
        </div>
        <div className="pro-empty-title">智能分析</div>
        <div className="pro-empty-desc">输入分析需求，Agent 将自动拆解步骤并执行</div>
      </div>
    );
  }

  return (
    <div className="pro-messages">
      {messages.map((msg) => {
        const isUser = msg.role === 'user';
        const text = getMessageText(msg);
        return (
          <div key={msg.id} className={`pro-message${isUser ? ' pro-message-user' : ' pro-message-assistant'}`}>
            {!isUser && (
              <div className="pro-message-avatar pro-message-avatar-ai">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 2a4 4 0 014 4c0 2.5-1.5 4-4 6-2.5-2-4-3.5-4-6a4 4 0 014-4z"/>
                  <path d="M8 14c-3 1-6 3-6 6v1h20v-1c0-3-3-5-6-6"/>
                </svg>
              </div>
            )}
            <div className={`pro-message-content${isUser ? ' pro-message-content-user' : ''}`}>
              <div className="pro-message-text">{text}</div>
            </div>
            {isUser && (
              <div className="pro-message-avatar pro-message-avatar-user">
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
        <div className="pro-message pro-message-assistant">
          <div className="pro-message-avatar pro-message-avatar-ai">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2a4 4 0 014 4c0 2.5-1.5 4-4 6-2.5-2-4-3.5-4-6a4 4 0 014-4z"/>
              <path d="M8 14c-3 1-6 3-6 6v1h20v-1c0-3-3-5-6-6"/>
            </svg>
          </div>
          <div className="pro-message-content">
            <div className="pro-thinking-indicator">
              <span className="pro-dot" />
              <span className="pro-dot" />
              <span className="pro-dot" />
            </div>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}