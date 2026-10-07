import React, { useRef, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import {
  Copy,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  ChatComment,
  ChatMessagesData,
  ChatStatus,
} from '../../../types/chat';
import type { AgentRunData } from '../../../api/agent';
import { RunTrace } from '../../../components/run-trace/RunTrace';
import { Markdown } from '@/components/Markdown';
import { feedbackMessage } from '@/api/message';

interface Props {
  messages: ChatMessagesData[];
  status: ChatStatus;
  /** messageId → 该消息对应的 run（执行轨迹） */
  runByMessage?: ReadonlyMap<string, AgentRunData>;
}

/** 提取消息中所有 text/markdown 片段拼成纯文本（复制用） */
function extractText(message: ChatMessagesData): string {
  if (message.role === 'system') {
    return message.content.map((c) => c.data).join('\n');
  }
  return (message.content ?? [])
    .filter(
      (c): c is { type: 'text'; data: string } | { type: 'markdown'; data: string } =>
        c.type === 'text' || c.type === 'markdown',
    )
    .map((c) => c.data)
    .join('\n');
}

/** 操作栏图标属性 */
interface ActionIconProps {
  size?: number;
  className?: string;
}

/**
 * 分享：弧形转发箭头；round 线帽/连接与复制、赞、踩风格统一，
 * stroke=currentColor 自动继承按钮颜色。
 */
function ShareForwardIcon({ size = 15, className }: ActionIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12.5 4L22 12L12.5 20V14.9C7.5 14.9 4 16.5 1.5 20C2.5 15 5.5 10 12.5 9L12.5 4Z" />
    </svg>
  );
}

/** 单条分析消息：用户右对齐气泡；助手通栏 Markdown + 操作栏 + 执行轨迹 */
function AnalysisMessageItem({
  message,
  runByMessage,
}: {
  message: ChatMessagesData;
  runByMessage?: ReadonlyMap<string, AgentRunData>;
}) {
  if (message.role === 'user') {
    const raw = extractText(message);
    // 含附件（上传图片/文件拼入的 Markdown 图片或链接）时用 Markdown 渲染
    const hasAttachmentMarkdown = /!?\[[^\]]*\]\(https?:\/\//i.test(raw);
    return (
      <div className="chat-msg-row chat-msg-row--user">
        <div className="chat-msg-user-bubble">
          {hasAttachmentMarkdown ? <Markdown content={raw} /> : raw}
        </div>
      </div>
    );
  }

  return (
    <AnalysisAssistantItem message={message} runByMessage={runByMessage} />
  );
}

function AnalysisAssistantItem({
  message,
  runByMessage,
}: {
  message: ChatMessagesData;
  runByMessage?: ReadonlyMap<string, AgentRunData>;
}) {
  // converter 下发的历史反馈（like/dislike/none）→ 评论状态
  const feedback = (message as { feedback?: string }).feedback;
  const [comment, setComment] = useState<ChatComment>(
    (message as { comment?: ChatComment }).comment ??
      (feedback === 'like' ? 'good' : feedback === 'dislike' ? 'bad' : ''),
  );

  const text = extractText(message);
  const isStreaming = message.status === 'streaming';
  const isFinal =
    message.status === 'complete' ||
    message.status === 'stop' ||
    message.status === 'error' ||
    (!message.status && text.length > 0);

  /** 点踩/点赞：再点一次取消 */
  const toggleFeedback = (next: 'good' | 'bad') => {
    const newComment: ChatComment = comment === next ? '' : next;
    const previous = comment;
    setComment(newComment);
    const apiValue = { '': 'none', good: 'like', bad: 'dislike' } as const;
    feedbackMessage(message.id, apiValue[newComment]).catch(() => {
      setComment(previous);
      toast.error('反馈失败，请重试');
    });
  };

  const handleCopy = () => {
    if (!text) {
      toast.info('暂无可复制的内容');
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success('已复制'))
      .catch(() => toast.error('复制失败，请手动选择文本'));
  };

  const handleShare = () => {
    if (!text) {
      toast.info('暂无可分享的内容');
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success('已复制消息内容，可粘贴分享'))
      .catch(() => toast.info('复制失败，请手动选择文本'));
  };

  const actions: ReadonlyArray<{
    key: string;
    label: string;
    icon: ComponentType<ActionIconProps>;
    active?: boolean;
    onClick: () => void;
  }> = [
    { key: 'copy', label: '复制', icon: Copy, onClick: handleCopy },
    {
      key: 'good',
      label: '赞',
      icon: ThumbsUp,
      active: comment === 'good',
      onClick: () => toggleFeedback('good'),
    },
    {
      key: 'bad',
      label: '踩',
      icon: ThumbsDown,
      active: comment === 'bad',
      onClick: () => toggleFeedback('bad'),
    },
    { key: 'share', label: '分享', icon: ShareForwardIcon, onClick: handleShare },
  ];

  return (
    <div className="chat-msg-row chat-msg-row--ai">
      <div className="chat-msg-ai-body">
        {text ? (
          <Markdown content={text} />
        ) : isStreaming ? (
          <span className="chat-streaming-placeholder" />
        ) : null}

        {isFinal && (
          <>
            <div className="chat-action-bar" role="toolbar" aria-label="消息操作">
              <span className="chat-action-group">
                {actions.map((a) => {
                  const Icon = a.icon;
                  return (
                    <button
                      key={a.key}
                      type="button"
                      className={`chat-action-btn${a.active ? ' is-active' : ''}`}
                      aria-label={a.label}
                      title={a.label}
                      aria-pressed={a.active ?? false}
                      onClick={a.onClick}
                    >
                      <Icon size={15} />
                    </button>
                  );
                })}
              </span>
            </div>
            {runByMessage?.has(message.id) && (
              <RunTrace
                runId={runByMessage.get(message.id)!.id}
                initialRun={runByMessage.get(message.id)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="chat-msg-row chat-msg-row--ai">
      <div className="chat-typing" aria-label="正在输入">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export function AnalysisMessageList({ messages, status, runByMessage }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  // 底部哨兵：判断用户是否在底部附近，用于自动滚动
  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        isNearBottomRef.current = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages, status]);

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
      <div className="chat-messages">
        {messages.map((msg) => (
          <AnalysisMessageItem
            key={msg.id}
            message={msg}
            runByMessage={runByMessage}
          />
        ))}
        {status === 'pending' && <TypingDots />}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
