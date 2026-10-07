import React, { useRef, useEffect, useMemo, useCallback, useState } from 'react';
import type { ComponentType } from 'react';
import { Copy, ThumbsDown, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import type {
  ChatComment,
  ChatMessagesData,
  ChatStatus,
} from '../../../types/chat';
import { useScrollToMessage } from '@/hooks/useScrollToMessage';
import { extractCodeBlocks, isPreviewable } from '@/components/ArtifactPreview/extractCodeBlocks';
import { Markdown } from '@/components/Markdown';
import { useArtifactStore } from '@/store/artifactStore';
import type { AgentRunData } from '@/api/agent';
import { RunTrace } from '@/components/run-trace/RunTrace';
import { feedbackMessage } from '@/api/message';

interface Props {
  messages: ChatMessagesData[];
  status: ChatStatus;
  /** messageId → 该消息对应的 run（执行轨迹） */
  runByMessage?: ReadonlyMap<string, AgentRunData>;
  /** HITL 暂停中：最后一条消息等待审批，不显示等待指示与操作栏 */
  paused?: boolean;
}

/**
 * 将消息的 content 数组拼接为纯文本
 * text/markdown/thinking 类型用 \n 拼接（保持既有行为）。
 */
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

/**
 * 助手消息内容渲染：纯文本段走 markdown，代码块走预览卡片。
 * 仅对 assistant 消息扫描代码块（user 消息不含可预览 artifact）。
 */
function MessageContent({ msg, text }: { msg: ChatMessagesData; text: string }) {
  const openArtifact = useArtifactStore((s) => s.openArtifact);
  const isAssistant = msg.role === 'assistant';

  const segments = useMemo(() => {
    if (!isAssistant || !text) return null;
    const blocks = extractCodeBlocks(text);
    if (blocks.length === 0) return null;

    // 将文本切分为 [文本, 代码块, 文本, ...] 序列
    const segs: Array<{ type: 'text'; value: string } | { type: 'code'; lang: string; code: string }> = [];
    let cursor = 0;
    for (const b of blocks) {
      if (b.start > cursor) {
        segs.push({ type: 'text', value: text.slice(cursor, b.start) });
      }
      segs.push({ type: 'code', lang: b.language, code: b.code });
      cursor = b.end;
    }
    if (cursor < text.length) {
      segs.push({ type: 'text', value: text.slice(cursor) });
    }
    return segs;
  }, [isAssistant, text]);

  const handlePreview = useCallback(
    (lang: string, code: string) => {
      openArtifact({
        messageId: msg.id,
        type: lang === 'html' ? 'html' : lang === 'svg' ? 'svg' : 'code',
        content: code,
        language: lang,
      });
    },
    [msg.id, openArtifact],
  );

  // 用户消息：保持纯文本
  if (!isAssistant) {
    return <div className="task-message-text">{text}</div>;
  }

  // 无代码块：整体 markdown 渲染
  if (!segments) {
    return <Markdown content={text} />;
  }

  return (
    <div className="task-message-markdown">
      {segments.map((seg, idx) => {
        if (seg.type === 'text') {
          return <Markdown key={idx} content={seg.value} />;
        }
        const previewable = isPreviewable(seg.lang);
        return (
          <div key={idx} className="task-code-block">
            <div className="task-code-block-header">
              <span className="task-code-block-lang">{seg.lang || 'text'}</span>
              {previewable && (
                <button
                  type="button"
                  className="task-code-block-preview-btn"
                  onClick={() => handlePreview(seg.lang, seg.code)}
                >
                  预览
                </button>
              )}
            </div>
            <pre className="task-code-block-pre">
              <code>{seg.code}</code>
            </pre>
          </div>
        );
      })}
    </div>
  );
}

/** 操作栏图标属性 */
interface ActionIconProps {
  size?: number;
  className?: string;
}

/** 分享：弧形转发箭头，风格与其他操作图标统一 */
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

/** 单条任务消息：用户右对齐气泡；助手通栏内容 + 操作栏 + 执行轨迹 */
function TaskMessageItem({
  msg,
  index,
  total,
  isLive,
  runByMessage,
}: {
  msg: ChatMessagesData;
  index: number;
  total: number;
  isLive: boolean;
  runByMessage?: ReadonlyMap<string, AgentRunData>;
}) {
  const text = getMessageText(msg);

  if (msg.role === 'user') {
    // 含附件（上传图片/文件拼入的 Markdown 图片或链接）时用 Markdown 渲染
    const hasAttachmentMarkdown = /!?\[[^\]]*\]\(https?:\/\//i.test(text);
    return (
      <div
        className="chat-msg-row chat-msg-row--user"
        data-message-id={msg.id}
      >
        <div className="chat-msg-user-bubble">
          {hasAttachmentMarkdown ? <Markdown content={text} /> : text}
        </div>
      </div>
    );
  }

  // assistant：task 消息不写终态，流式态仅属于最后一条消息
  const isStreaming = isLive && index === total - 1;
  const isFinal = !isStreaming;

  return (
    <div
      className="chat-msg-row chat-msg-row--ai"
      data-message-id={msg.id}
    >
      <div className="chat-msg-ai-body">
        {text ? (
          <MessageContent msg={msg} text={text} />
        ) : isStreaming ? (
          <div className="chat-typing" aria-label="正在输入">
            <span />
            <span />
            <span />
          </div>
        ) : null}

        {isFinal && (
          <TaskActions
            msg={msg}
            text={text}
            runByMessage={runByMessage}
          />
        )}
      </div>
    </div>
  );
}

/** 助手消息操作栏（copy/good/bad/share）+ 执行轨迹 */
function TaskActions({
  msg,
  text,
  runByMessage,
}: {
  msg: ChatMessagesData;
  text: string;
  runByMessage?: ReadonlyMap<string, AgentRunData>;
}) {
  // converter 下发的历史反馈（like/dislike）→ 评论状态
  const feedback = (msg as { feedback?: string }).feedback;
  const [comment, setComment] = useState<ChatComment>(
    (msg as { comment?: ChatComment }).comment ??
      (feedback === 'like' ? 'good' : feedback === 'dislike' ? 'bad' : ''),
  );

  /** 点踩/点赞：再点一次取消 */
  const toggleFeedback = (next: 'good' | 'bad') => {
    const newComment: ChatComment = comment === next ? '' : next;
    const previous = comment;
    setComment(newComment);
    const apiValue = { '': 'none', good: 'like', bad: 'dislike' } as const;
    feedbackMessage(msg.id, apiValue[newComment]).catch(() => {
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
      {runByMessage?.has(msg.id) && (
        <RunTrace
          runId={runByMessage.get(msg.id)!.id}
          initialRun={runByMessage.get(msg.id)}
        />
      )}
    </>
  );
}

export function TaskMessageList({ messages, status, runByMessage, paused }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  // 反向联动：监听 highlightMessageId，滚动到对应消息并高亮
  useScrollToMessage(containerRef);

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
      <div className="task-messages-empty">
        <div className="task-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="1" y="1" width="22" height="22" rx="2"/>
            <path d="M7 8h10M7 12h6M7 16h8"/>
          </svg>
        </div>
        <div className="task-empty-title">发送一条消息开始任务</div>
        <div className="task-empty-desc">Agent 将自动规划并执行多步骤操作</div>
      </div>
    );
  }

  const isLive =
    !paused && (status === 'streaming' || status === 'pending');
  // 防御：流式中但末尾没有 assistant 占位时，尾部补等待指示
  const showTrailingTyping =
    isLive && messages[messages.length - 1]?.role !== 'assistant';

  return (
    <div className="task-messages" ref={containerRef}>
      <div className="chat-messages">
        {messages.map((msg, index) => (
          <TaskMessageItem
            key={msg.id}
            msg={msg}
            index={index}
            total={messages.length}
            isLive={isLive}
            runByMessage={runByMessage}
          />
        ))}
        {showTrailingTyping && (
          <div className="chat-msg-row chat-msg-row--ai">
            <div className="chat-typing" aria-label="正在输入">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
