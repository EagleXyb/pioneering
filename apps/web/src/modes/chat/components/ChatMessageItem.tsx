/**
 * 单条聊天消息
 *
 * - 用户消息：右侧灰色气泡；助手消息：通栏 Markdown 渲染
 * - reasoning 块折叠展示（历史默认折叠、流式过程默认展开）
 * - 操作栏五按钮（copy/good/bad/share/replay）
 * - comment 随消息反馈状态同步（useEffect），
 *   历史刷新/重新加载不再出现按钮高亮与数据不一致
 */
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import {
  ChevronRight,
  Copy,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  AIMessageContent,
  ChatComment,
  ReferenceItem,
} from '../../../types/chat';
import type { ChatMessageData } from '../../../api/converter';
import { feedbackMessage } from '../../../api/message';
import { useSourcesPanelStore } from '../../../store/sourcesPanelStore';
import { Markdown } from '@/components/Markdown';
import { UserMessageBubble } from '@/components/message/UserMessageBubble';
import {
  ReplayRotateIcon,
  ShareForwardIcon,
  ThinkingIcon,
  type ActionIconProps,
} from '@/components/icons/customIcons';
import { SourceFavicon } from './SourcesPanel/SourceFavicon';

interface Props {
  message: ChatMessageData;
  onReplay?: (messageId: string) => void;
  /** 用户消息是否可编辑（流式中/临时会话为 false） */
  editable?: boolean;
  /** 当前是否处于编辑态 */
  editing?: boolean;
  /** 编辑提交中 */
  submittingEdit?: boolean;
  onStartEdit?: (messageId: string) => void;
  onCancelEdit?: () => void;
  onSubmitEdit?: (messageId: string, nextText: string) => void | Promise<void>;
}

/** 提取 reasoning 块文本（data 为 text/markdown 片段数组） */
function extractReasoning(content: AIMessageContent[] | undefined): string {
  const block = content?.find((c) => c.type === 'reasoning');
  if (!block || block.type !== 'reasoning') return '';
  return block.data
    .map((c) => (typeof c.data === 'string' ? c.data : ''))
    .join('\n');
}

function getTextBlocks(message: ChatMessageData) {
  return (message.content ?? []).filter((c) => c.type === 'text' || c.type === 'markdown');
}

/** 提取联网搜索结构化来源（search 内容块） */
function extractReferences(content: AIMessageContent[] | undefined): ReferenceItem[] {
  const block = content?.find((c) => c.type === 'search');
  if (!block || block.type !== 'search') return [];
  return Array.isArray(block.data?.references) ? block.data.references : [];
}

export function ChatMessageItem({
  message,
  onReplay,
  editable = false,
  editing = false,
  submittingEdit = false,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
}: Props) {
  // assistant 分支的消息（含后端回写的 comment）
  const aiMessage = message as Extract<ChatMessageData, { role: 'assistant' }>;
  const [comment, setComment] = useState<ChatComment>(aiMessage.comment ?? '');

  // 以下 assistant 专用 hooks 提前调用，避免在 user 早返回之后形成条件调用
  const openSources = useSourcesPanelStore((s) => s.openSources);
  const isSourcesPanelOpen = useSourcesPanelStore(
    (s) => s.open && s.messageId === message.id,
  );
  const reasoningBlock = message.content?.find((c) => c.type === 'reasoning');
  // 历史消息默认折叠（converter 写 ext.collapsed=true），流式消息默认展开；
  // 之后由用户点击受控切换（流式过程中也允许手动折叠）
  const [reasoningOpen, setReasoningOpen] = useState<boolean>(() => {
    const collapsed =
      (reasoningBlock?.ext as { collapsed?: boolean } | undefined)?.collapsed ??
      (message.status === 'complete' || message.status === 'stop');
    return !collapsed;
  });

  // P2-5：消息引用变化（历史刷新、反馈回写）时同步按钮高亮状态
  useEffect(() => {
    setComment(aiMessage.comment ?? '');
  }, [aiMessage.comment, aiMessage.id]);

  if (message.role === 'user') {
    return (
      <UserMessageBubble
        message={message}
        editable={editable}
        editing={editing}
        submitting={submittingEdit}
        onStartEdit={() => onStartEdit?.(message.id)}
        onCancelEdit={onCancelEdit}
        onSubmitEdit={(next) => onSubmitEdit?.(message.id, next)}
      />
    );
  }

  // assistant
  const reasoning = extractReasoning(message.content);
  const references = extractReferences(message.content);
  const textBlocks = getTextBlocks(message);
  const text = textBlocks.map((c) => (c.data as string) ?? '').join('\n');
  // 流式进行中（含思考阶段与正文阶段）：标题显示"深度思考中…"，图标呼吸
  const isReasoningStreaming = message.status === 'streaming' || message.status === 'pending';
  const isFinal =
    message.status === 'complete' ||
    message.status === 'stop' ||
    (!message.status && text.length > 0);
  const isStreaming = message.status === 'streaming';

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
    {
      key: 'replay',
      label: '重新生成',
      icon: ReplayRotateIcon,
      onClick: () => onReplay?.(message.id),
    },
  ];

  return (
    <div className="chat-msg-row chat-msg-row--ai">
      <div className="chat-msg-ai-body">
        {reasoning && (
          <div
            className={`chat-reasoning${reasoningOpen ? ' is-open' : ''}${
              isReasoningStreaming ? ' is-streaming' : ''
            }`}
          >
            <button
              type="button"
              className="chat-reasoning-header"
              onClick={() => setReasoningOpen((v) => !v)}
              aria-expanded={reasoningOpen}
            >
              <ThinkingIcon className="chat-reasoning-icon" />
              <span className="chat-reasoning-title">
                {isReasoningStreaming ? '深度思考中…' : '已完成思考'}
              </span>
              <ChevronRight
                size={14}
                strokeWidth={2.2}
                className="chat-reasoning-chevron"
              />
            </button>
            <div
              className={`chat-reasoning-body-wrap${reasoningOpen ? ' is-open' : ''}`}
              aria-hidden={!reasoningOpen}
              inert={!reasoningOpen ? true : undefined}
            >
              <div className="chat-reasoning-body-inner">
                <div className="chat-reasoning-body">
                  <Markdown content={reasoning} />
                </div>
              </div>
            </div>
          </div>
        )}

        {text ? (
          <Markdown content={text} />
        ) : isStreaming ? (
          <span className="chat-streaming-placeholder" />
        ) : null}

        {isFinal && (
          <div
            className={`chat-action-bar${references.length > 0 ? ' has-sources' : ''}`}
            role="toolbar"
            aria-label="消息操作"
          >
            <span className="chat-action-group">
              {actions.map((a) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.key}
                    type="button"
                    className={`chat-action-btn chat-tooltip${a.active ? ' is-active' : ''}`}
                    aria-label={a.label}
                    data-tooltip={a.label}
                    aria-pressed={a.active ?? false}
                    onClick={a.onClick}
                  >
                    <Icon size={15} />
                  </button>
                );
              })}
            </span>
            {references.length > 0 && (
              <button
                type="button"
                className={`chat-sources-chip chat-tooltip${isSourcesPanelOpen ? ' is-active' : ''}`}
                aria-pressed={isSourcesPanelOpen}
                onClick={() => openSources(message.id, references)}
                data-tooltip="查看参考来源"
              >
                <span className="chat-sources-favicons">
                  {references.slice(0, 3).map((r, i) => (
                    <SourceFavicon key={`${r.url}-${i}`} source={r} size={15} />
                  ))}
                </span>
                {references.length}篇来源
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
