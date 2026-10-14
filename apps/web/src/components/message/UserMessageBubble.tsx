/**
 * 用户消息气泡（chat / pro / task 三模式共享）
 *
 * 只读态：灰底气泡 + 悬停元信息行（时间 / 编辑 / 复制）
 * 编辑态：带边框的编辑卡片（多行文本框 + 提示条 + 取消 / 发送）
 *
 * 设计要点：
 *   - 编辑态由父层受控（`editing`），保证同一会话同一时刻只有一条消息可编辑；
 *   - 悬停显示逻辑走 CSS（`.chat-user-meta`），触屏用 `@media (hover:none)` 常显，
 *     与助手操作栏 `.chat-action-bar` 保持完全一致的信息呈现范式；
 *   - 复制取纯文本（text/markdown 片段拼接），不含 reasoning 等非用户内容；
 *   - 超过 5 行的长消息默认折叠（底部渐隐，见 .chat-msg-user-bubble.is-collapsed），
 *     点击气泡或右下角浮标展开/收起；溢出判定用 scrollHeight（不受 max-height 裁剪影响）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Info, PencilLine } from 'lucide-react';
import { toast } from 'sonner';
import { Markdown } from '@/components/Markdown';
import { formatMessageTime } from '@/lib/formatTime';
import { useMessageEdit } from '@/hooks/useMessageEdit';
import type { ChatMessageData } from '@/api/converter';

/** 折叠态展示的正文行数（与 .chat-msg-user-bubble.is-collapsed 的 max-height 公式一致） */
const COLLAPSED_LINES = 5;

/** computed style 不可用（jsdom 等）时的回退行高：14px 字号 × 1.6 = 22.4px */
const FALLBACK_LINE_HEIGHT = 14 * 1.6;

/** 行高（px）：优先取计算样式，取不到时按字号估算 */
function lineHeightOf(el: HTMLElement): number {
  const lh = parseFloat(window.getComputedStyle(el).lineHeight);
  return Number.isFinite(lh) && lh > 0 ? lh : FALLBACK_LINE_HEIGHT;
}

export interface UserMessageBubbleProps {
  message: ChatMessageData;
  /** 是否允许编辑；为 false 时仅提供「时间 + 复制」（默认 false） */
  editable?: boolean;
  /** 是否处于编辑态（受控） */
  editing?: boolean;
  /** 正在提交编辑（禁用取消/发送并置 aria-busy） */
  submitting?: boolean;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  /** 提交编辑后的新文本；父层负责消息定位、截断与重新生成 */
  onSubmitEdit?: (nextText: string) => void | Promise<void>;
}

/** 提取用户消息纯文本（text/markdown 片段按换行拼接） */
export function extractUserText(message: ChatMessageData): string {
  return (message.content ?? [])
    .filter(
      (c): c is { type: 'text'; data: string } | { type: 'markdown'; data: string } =>
        c.type === 'text' || c.type === 'markdown',
    )
    .map((c) => c.data)
    .join('\n');
}

/** 含附件（上传图片/文件拼入的 Markdown 图片或链接）时交给 Markdown 渲染 */
function hasAttachmentMarkdown(raw: string): boolean {
  return /!?\[[^\]]*\]\(https?:\/\//i.test(raw);
}

/** 编辑提示：明确"重新开始对话"的后果与产物保留策略 */
const EDIT_HINT = '编辑后将从此处重新开始对话，后续消息会被新回复替换；已有产物不会被删除';

function UserMessageEditor({
  initialText,
  submitting,
  onSubmit,
  onCancel,
}: {
  initialText: string;
  submitting: boolean;
  onSubmit: (text: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const {
    value,
    setValue,
    textareaRef,
    handleKeyDown,
    handleCompositionStart,
    handleCompositionEnd,
    handleSubmit,
    canSubmit,
    useCtrlEnterToSend,
  } = useMessageEdit({ initialText, submitting, onSubmit, onCancel });

  return (
    <div className="chat-user-editor" aria-busy={submitting || undefined}>
      <textarea
        ref={textareaRef}
        className="chat-user-editor-textarea"
        aria-label="编辑消息"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        rows={1}
        spellCheck={false}
      />
      <div className="chat-user-editor-footer">
        <span className="chat-user-editor-hint">
          <Info size={13} className="chat-user-editor-hint-icon" aria-hidden="true" />
          {EDIT_HINT}
        </span>
        <span className="chat-user-editor-actions">
          <button
            type="button"
            className="chat-user-editor-cancel"
            onClick={onCancel}
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="button"
            className="chat-user-editor-send chat-tooltip"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-tooltip={useCtrlEnterToSend ? '发送（Ctrl/⌘ + Enter）' : '发送（Enter）'}
          >
            {submitting ? '发送中…' : '发送'}
          </button>
        </span>
      </div>
    </div>
  );
}

export function UserMessageBubble({
  message,
  editable = false,
  editing = false,
  submitting = false,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
}: UserMessageBubbleProps) {
  const raw = useMemo(() => extractUserText(message), [message]);
  const time = formatMessageTime(message.datetime);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  const canToggle = overflowing;
  const collapsed = overflowing && !expanded;

  // 溢出判定：测量正文内容层高度 —— 不受折叠 max-height 裁剪、也不含按钮行的预留
  // padding，折叠 / 展开两态判定一致；内容或宽度变化（图片加载、窗口缩放）时重测。
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      const over =
        content.offsetHeight > lineHeightOf(content) * COLLAPSED_LINES + 1;
      setOverflowing((prev) => (prev === over ? prev : over));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(content);
    return () => ro.disconnect();
  }, [raw, editing]);

  // 组件实例被复用到另一条消息时回到折叠态
  useEffect(() => {
    setExpanded(false);
  }, [message.id]);

  /** 点击气泡本体切换折叠；拖选文本或点击气泡内链接时不触发 */
  const handleBubbleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('a')) return;
    if (window.getSelection()?.toString()) return;
    setExpanded((v) => !v);
  };

  const handleCopy = () => {
    if (!raw.trim()) {
      toast.info('暂无可复制的内容');
      return;
    }
    navigator.clipboard
      .writeText(raw)
      .then(() => toast.success('已复制'))
      .catch(() => toast.error('复制失败，请手动选择文本'));
  };

  const handleSubmit = onSubmitEdit ?? (() => {});

  return (
    <div className="chat-msg-row chat-msg-row--user" data-message-id={message.id}>
      <div className={`chat-user-col${editing ? ' is-editing' : ''}`}>
        {editing ? (
          <UserMessageEditor
            initialText={raw}
            submitting={submitting}
            onSubmit={handleSubmit}
            onCancel={() => onCancelEdit?.()}
          />
        ) : (
          <>
            <div
              className={`chat-msg-user-bubble${collapsed ? ' is-collapsed' : ''}${canToggle ? ' is-collapsible' : ''}`}
              onClick={canToggle ? handleBubbleClick : undefined}
            >
              {/* 折叠裁剪层（is-collapsed 时限高 5 行）> 正文测量层：
                  测量层自身高度始终为完整内容高度（父级裁剪不改变其布局高度），
                  折叠 / 展开两态判定一致 */}
              <div className="chat-user-bubble-content">
                <div ref={contentRef} className="chat-user-bubble-body">
                  {hasAttachmentMarkdown(raw) ? <Markdown content={raw} /> : raw}
                </div>
              </div>
              {/* 超长消息的折叠开关（气泡右下角文字按钮，仅内容超 5 行时出现） */}
              {canToggle && (
                <button
                  type="button"
                  className="chat-user-collapse-toggle"
                  aria-label={expanded ? '收起消息' : '展开消息'}
                  aria-expanded={expanded}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded((v) => !v);
                  }}
                >
                  {expanded ? '收起' : '展开'}
                  {expanded ? (
                    <ChevronUp size={13} />
                  ) : (
                    <ChevronDown size={13} />
                  )}
                </button>
              )}
            </div>
            <div className="chat-user-meta" role="toolbar" aria-label="消息操作">
              {time && <span className="chat-user-meta-time">{time}</span>}
              {editable && (
                <button
                  type="button"
                  className="chat-action-btn chat-tooltip"
                  aria-label="编辑"
                  data-tooltip="编辑"
                  onClick={() => onStartEdit?.()}
                >
                  <PencilLine size={14} />
                </button>
              )}
              <button
                type="button"
                className="chat-action-btn chat-tooltip"
                aria-label="复制"
                data-tooltip="复制"
                onClick={handleCopy}
              >
                <Copy size={14} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
