import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ThumbsUp, ThumbsDown, Lightbulb } from 'lucide-react';
import { filterThinkingChain, extractThinkingChain } from '@shared/utils';
import type { DisplayMessage } from './types';

interface ChatMessageProps {
  message: DisplayMessage;
  showThinking: boolean;
  isLiked: boolean;
  isDisliked: boolean;
  onToggleThinking: () => void;
  onToggleLike: () => void;
  onToggleDislike: () => void;
  onCopy: (content: string) => void;
  onRetry: (messageId: string) => void;
}

export const UserMessage: React.FC<{ message: DisplayMessage }> = ({ message }) => (
  <div className="chat-message-row user-row">
    <div className="chat-message-bubble user-bubble">
      <div className="chat-message-text">{message.content}</div>
    </div>
  </div>
);

export const AssistantMessage: React.FC<ChatMessageProps> = ({
  message,
  showThinking,
  isLiked,
  isDisliked,
  onToggleThinking,
  onToggleLike,
  onToggleDislike,
  onCopy,
  onRetry,
}) => {
  const thinkingContent = extractThinkingChain(message.content);
  const filteredContent = filterThinkingChain(message.content);
  const isLoading = message.status === 'loading';
  const hasVisibleContent = filteredContent.length > 0;

  return (
    <div className="chat-message-row assistant-row">
      <div className="chat-message-bubble assistant-bubble">
        {isLoading && !hasVisibleContent && (
          <div className="chat-skeleton">
            <div className="skeleton-line skeleton-line-long"></div>
            <div className="skeleton-line skeleton-line-medium"></div>
            <div className="skeleton-line skeleton-line-short"></div>
          </div>
        )}
        {thinkingContent && (
          <button className="thinking-toggle-btn" onClick={onToggleThinking}>
            <Lightbulb className={`thinking-icon ${isLoading ? 'animate' : ''}`} />
            <span>思考过程</span>
            <svg
              className={`thinking-arrow ${showThinking ? 'expanded' : ''}`}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}
        {showThinking && thinkingContent && (
          <div className="thinking-content">{thinkingContent}</div>
        )}
        {hasVisibleContent && (
          <div className="chat-message-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {filteredContent}
            </ReactMarkdown>
            {isLoading && <span className="chat-cursor">▊</span>}
          </div>
        )}
        {message.status === 'error' && (
          <div className="chat-message-error">
            <span className="error-text">{message.error || '网络异常，请重试'}</span>
            <button className="retry-btn" onClick={() => onRetry(message.id)}>重新生成</button>
          </div>
        )}
        {message.status === 'success' && message.content && (
          <div className="chat-message-actions">
            <button className="action-btn" onClick={() => onCopy(message.content)} title="复制">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
            </button>
            <button className="action-btn" onClick={() => onRetry(message.id)} title="重新生成">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1 4v6h6"/>
                <path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
              </svg>
            </button>
            <div className="action-divider"></div>
            <button className={`action-btn ${isLiked ? 'action-btn-active' : ''}`} onClick={onToggleLike} title="点赞">
              <ThumbsUp size={14} />
            </button>
            <button className={`action-btn ${isDisliked ? 'action-btn-active' : ''}`} onClick={onToggleDislike} title="反对">
              <ThumbsDown size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export const SystemMessage: React.FC<{ message: DisplayMessage }> = ({ message }) => (
  <div className="chat-message-system">{message.content}</div>
);
