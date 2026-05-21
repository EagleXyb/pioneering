import React, { useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ThumbsUp, ThumbsDown, ChevronRight, ChevronDown, Sparkles } from 'lucide-react';
import type { DisplayMessage } from '../../types';
import FloatingCursor from './FloatingCursor';
import type { FloatingCursorRef } from './FloatingCursor';
import { useFloatingCursor } from '../hooks/useFloatingCursor';
import { stripThinkTags } from '../../utils/stripThinkTags';

const ShareIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} fill="currentColor" viewBox="0 0 1024 1024">
    <path d="M512 119.168c0-49.024 59.264-73.6 93.952-38.976l360.32 360.384a55.04 55.04 0 0 1 0 77.888l-360.32 360.32C571.264 913.536 512 888.96 512 839.936v-167.04c-126.08 8.96-220.096 70.592-284.544 133.568a595.5 595.5 0 0 0-96.96 124.544c-2.048 3.648-3.52 6.4-4.48 8.32l-1.088 1.92-.192.448-2.88 4.672A32 32 0 0 1 64 927.552c0-190.08 40.768-349.568 122.048-462.336C262.464 359.168 373.12 296.768 512 288.576V119.104zm64 200.32a32 32 0 0 1-32 32c-134.08 0-236.288 54.336-306.048 151.168-55.424 76.864-91.328 182.208-104.384 311.744 14.08-17.216 30.4-35.456 49.088-53.76C260.224 684.864 379.776 607.552 544 607.552a32 32 0 0 1 32 32v178.752l338.752-338.752L576 140.8v178.752z"/>
  </svg>
);

/** 将思考内容按段落拆分为时间线步骤 */
function parseThinkingSteps(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
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

  // 将思考内容解析为步骤列表
  const thinkingSteps = useMemo(() => parseThinkingSteps(thinkingContent), [thinkingContent]);

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
          <div className="thinking-timeline">
            {thinkingSteps.map((step, index) => (
              <div key={index} className="thinking-step">
                <div className="thinking-step-node" data-is-last={index === thinkingSteps.length - 1 && !isLoading}>
                  <span className="step-dot" />
                </div>
                <div className="thinking-step-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {step}
                  </ReactMarkdown>
                </div>
              </div>
            ))}
            {!isLoading && (
              <div className="thinking-step thinking-step-complete">
                <div className="thinking-step-node step-node-complete">
                  <svg className="step-check-svg" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M6 10l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="thinking-step-body step-body-complete">
                  <span>已完成思考</span>
                </div>
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
            <button className="action-btn" onClick={() => onCopy(answerContent || thinkingContent)} data-title="复制">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
            </button>
            <button className={`action-btn ${isLiked ? 'action-btn-active' : ''}`} onClick={onToggleLike} data-title="点赞">
              <ThumbsUp size={14} />
            </button>
            <button className={`action-btn ${isDisliked ? 'action-btn-active' : ''}`} onClick={onToggleDislike} data-title="点踩">
              <ThumbsDown size={14} />
            </button>
            <button className="action-btn" onClick={() => onForward(message.id)} data-title="分享">
              <ShareIcon />
            </button>
            <button className="action-btn" onClick={() => onRetry(message.id)} data-title="重新生成">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1 4v6h6"/>
                <path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
              </svg>
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
