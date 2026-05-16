import React from 'react';
import type { DisplayMessage } from '../../types';
import { useChatMessages } from '../hooks/useChatMessages';
import { useChatScroll } from '../hooks/useChatScroll';

interface ChatPanelProps {
  messages: DisplayMessage[];
  onRetry: (messageId: string) => void;
  className?: string;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ messages, onRetry, className = '' }) => {
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
    <div className={`chat-container ${className} ${isScrolling ? 'scrolling' : ''}`} ref={chatContainerRef} onScroll={handleScroll}>
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

export default ChatPanel;
