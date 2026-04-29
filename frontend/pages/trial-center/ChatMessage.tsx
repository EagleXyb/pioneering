import React, { useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ThumbsUp, ThumbsDown, ChevronRight, ChevronDown, Share, Sparkles } from 'lucide-react';
import type { DisplayMessage } from './types';
import FloatingCursor from './FloatingCursor';
import type { FloatingCursorRef } from './FloatingCursor';
import { useFloatingCursor } from './useFloatingCursor';

/**
 * 清除思考内容中可能残留的 <think...> 和 </think> 标签
 * 防止 HTML 标签干扰 ReactMarkdown 解析
 */
function stripThinkTags(content: string): string {
  return content
    .replace(/<think[^>]*>/gi, '')
    .replace(/<\/think\s*>/gi, '');
}

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
  onForward: (messageId: string) => void;
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
  onForward,
}) => {
  const markdownContainerRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<FloatingCursorRef>(null);
  const thinkingContent = stripThinkTags(message.thinkingContent || '');
  const answerContent = message.answerContent || message.content;
  const isLoading = message.status === 'loading';
  const isThinkingInProgress = isLoading && thinkingContent.length > 0 && answerContent.length === 0;
  const hasThinking = thinkingContent.length > 0;
  const hasAnswer = answerContent.length > 0;

  useFloatingCursor(answerContent, isLoading, markdownContainerRef, cursorRef);

  return (
    <div className="chat-message-row assistant-row">
      <div className="chat-message-bubble assistant-bubble">
        {isLoading && !hasThinking && !hasAnswer && (
          <div className="chat-thinking-animation">
            <Sparkles className="thinking-icon animate" />
            <span>正在思考...</span>
          </div>
        )}
        {hasThinking && (
          <button className="thinking-toggle-btn" onClick={onToggleThinking}>
            <Sparkles className={`thinking-icon ${isLoading && isThinkingInProgress ? 'animate' : ''}`} />
            <span>{isLoading && isThinkingInProgress ? '思考中...' : '已完成思考'}</span>
            {showThinking ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
        {showThinking && hasThinking && (
          <div className="thinking-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{thinkingContent}</ReactMarkdown>
            {!isLoading && (
              <div className="thinking-complete-marker">
                <span className="thinking-check-icon">✓</span>
                <span>已完成</span>
              </div>
            )}
          </div>
        )}
        {hasAnswer && (
          <div className="chat-message-markdown" ref={markdownContainerRef} style={{ position: 'relative' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {answerContent}
            </ReactMarkdown>
            <FloatingCursor ref={cursorRef} />
          </div>
        )}
        {isLoading && hasThinking && !hasAnswer && (
          <div className="chat-thinking-animation">
            <Sparkles className="thinking-icon animate" />
            <span>正在组织回答...</span>
          </div>
        )}
        {message.status === 'error' && (
          <div className="chat-message-error">
            <span className="error-text">{message.error || '网络异常，请重试'}</span>
            <button className="retry-btn" onClick={() => onRetry(message.id)}>重新生成</button>
          </div>
        )}
        {message.status === 'success' && (hasAnswer || hasThinking) && (
          <div className="chat-message-actions">
            <button className="action-btn" onClick={() => onCopy(answerContent || thinkingContent)} title="复制">
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
            <button className="action-btn" onClick={() => onForward(message.id)} title="分享">
              <Share size={14} />
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
