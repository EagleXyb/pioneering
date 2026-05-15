import React from 'react';
import type { DisplayMessage } from '../types';
import { useChatMessages } from '../hooks/useChatMessages';
import { useChatScroll } from '../hooks/useChatScroll';

interface NormalChatPanelProps {
  messages: DisplayMessage[];
  onRetry: (messageId: string) => void;
}

const NormalChatPanel: React.FC<NormalChatPanelProps> = ({ messages, onRetry }) => {
  const { renderMessageContent } = useChatMessages(messages);
  const {
    showScrollBottom,
    isScrolling,
    chatContainerRef,
    messagesEndRef,
    scrollToBottom,
    handleScroll,
  } = useChatScroll(messages.length);

  return (
    <div className={`chat-container ${isScrolling ? 'scrolling' : ''}`} ref={chatContainerRef} onScroll={handleScroll}>
      <div className="chat-welcome">
        <div className="chat-welcome-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" fill="#8B5CF6"/>
            <path d="M8 12l2 2 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <span>IAC Incubator</span>
      </div>
      {messages.map((message) => (
        <div key={message.id} className="chat-message-wrapper">
          {renderMessageContent(message, onRetry)}
        </div>
      ))}
      <div ref={messagesEndRef} />
      {showScrollBottom && (
        <button className="scroll-bottom-btn" onClick={scrollToBottom}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12l7 7 7-7"/>
          </svg>
        </button>
      )}
    </div>
  );
};

export default NormalChatPanel;
