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
 *   - 复制取纯文本（text/markdown 片段拼接），不含 reasoning 等非用户内容。
 */
import { useMemo } from 'react';
import { Copy, Info, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Markdown } from '@/components/Markdown';
import { formatMessageTime } from '@/lib/formatTime';
import { useMessageEdit } from '@/hooks/useMessageEdit';
import type { ChatMessageData } from '@/api/converter';

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
            <div className="chat-msg-user-bubble">
              {hasAttachmentMarkdown(raw) ? <Markdown content={raw} /> : raw}
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
                  <Pencil size={14} />
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
