import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import type { ChatMessagesData, ChatStatus } from '../../../types/tdesign';
import { useScrollToMessage } from '@/hooks/useScrollToMessage';
import { extractCodeBlocks, isPreviewable } from '@/components/ArtifactPreview/extractCodeBlocks';
import { useArtifactStore } from '@/store/artifactStore';

interface Props {
  messages: ChatMessagesData[];
  status: ChatStatus;
}

/**
 * 将消息的 content 数组拼接为纯文本（保留原 getMessageText 行为）
 *
 * 兼容性说明：原实现将 text/markdown/thinking 类型用 \n 拼接，
 * 这里完全保留该行为，避免对流式 / 历史消息的渲染产生回归。
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
 * 单条消息渲染：纯文本 + 可预览代码块
 *
 * 设计要点：
 *   - 保留原有文本渲染（white-space: pre-wrap）
 *   - 仅对 assistant 消息扫描代码块（user 消息一般不含可预览 artifact）
 *   - 可预览代码块（html/svg）替换为带"预览"按钮的卡片
 *   - 其他代码块保留为 <pre><code> 展示
 */
function MessageContent({ msg, text }: { msg: ChatMessagesData; text: string }) {
  const openArtifact = useArtifactStore((s) => s.openArtifact);
  const isAssistant = msg.role === 'assistant';

  // 仅对 assistant 消息提取代码块；user 消息直接走纯文本
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

  // 无代码块时走原渲染路径
  if (!segments) {
    return <div className="task-message-text">{text}</div>;
  }

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

  return (
    <div className="task-message-text">
      {segments.map((seg, idx) => {
        if (seg.type === 'text') {
          return <span key={idx}>{seg.value}</span>;
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

export function TaskMessageList({ messages, status }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 反向联动：监听 highlightMessageId，滚动到对应消息并高亮
  useScrollToMessage(containerRef);

  // 保留原有"消息变化时滚到底部"行为
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
    <div className="task-messages" ref={containerRef}>
      <div className="task-messages-inner">
      {messages.map((msg) => {
        const isUser = msg.role === 'user';
        const text = getMessageText(msg);
        return (
          <div
            key={msg.id}
            data-message-id={msg.id}
            className={`task-message${isUser ? ' task-message-user' : ' task-message-assistant'}`}
          >
            {!isUser && (
              <div className="task-message-avatar task-message-avatar-ai">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 2a4 4 0 014 4c0 2.5-1.5 4-4 6-2.5-2-4-3.5-4-6a4 4 0 014-4z"/>
                  <path d="M8 14c-3 1-6 3-6 6v1h20v-1c0-3-3-5-6-6"/>
                </svg>
              </div>
            )}
            <div className={`task-message-content${isUser ? ' task-message-content-user' : ''}`}>
              <MessageContent msg={msg} text={text} />
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
    </div>
  );
}
