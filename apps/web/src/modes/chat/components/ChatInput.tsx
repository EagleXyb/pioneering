/**
 * chat 输入区（阶段 4.5 自建，替代 TDesign ChatSender）
 *
 * 直接复用 task 模式已验证的 useTaskInput：
 * IME 合成保护、Enter/Ctrl+Enter 发送策略（读 app:preferences.enterToSend）、
 * sessionStorage 草稿（按会话隔离，键前缀 chat-input-draft）、autosize、
 * Escape 停止。UI 为 shadcn Textarea + 工具栏卡片。
 *
 * 附件（+ 按钮）：上传图片 / 上传文件 → POST /upload，
 * 发送时以 Markdown 图片/链接拼入正文（见 useChatAttachments）。
 */
import { useRef } from 'react';
import { ArrowUp, Image as ImageIcon, Plus, Square, Brain, Globe, FileText } from 'lucide-react';
import { toast } from 'sonner';
import type { ChatStatus } from '../../../types/chat';
import { useTaskInput } from '../../task/hooks/useTaskInput';
import { Spinner } from '@/components/ui/spinner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  FILE_ACCEPT_ATTR,
  IMAGE_ACCEPT_ATTR,
} from '../../../api/upload';
import { AttachmentBar } from '@/components/attachments/AttachmentBar';
import { useAttachments } from '@/hooks/useAttachments';

interface Props {
  activeId: string | null;
  status: ChatStatus;
  onSend: (text: string) => void;
  onStop: () => void;
  r1Active: boolean;
  onR1Change: (v: boolean) => void;
  netSearchActive: boolean;
  onNetSearchChange: (v: boolean) => void;
}

export function ChatInput({
  activeId,
  status,
  onSend,
  onStop,
  r1Active,
  onR1Change,
  netSearchActive,
  onNetSearchChange,
}: Props) {
  const isBusy = status === 'streaming' || status === 'pending';

  // ---- 附件 ----
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    attachments,
    hasPending,
    addFiles,
    removeAttachment,
    takeMessageSuffix,
  } = useAttachments();

  /** 将文本与已完成附件的 Markdown 后缀组合为最终消息 */
  const composeWithAttachments = (text: string): string | null => {
    if (hasPending) {
      toast.error('附件仍在上传，请稍候');
      return null;
    }
    const suffix = takeMessageSuffix();
    const trimmed = text.trim();
    if (!trimmed && !suffix) return null;
    return `${trimmed}${suffix}`;
  };

  /** 按钮/键盘统一发送出口 */
  const dispatchSend = (rawText: string) => {
    const composed = composeWithAttachments(rawText);
    if (composed === null) return;
    onSend(composed);
    setValue('');
  };

  const {
    value,
    setValue,
    textareaRef,
    handleKeyDown,
    handleCompositionStart,
    handleCompositionEnd,
    canSend,
    useCtrlEnterToSend,
  } = useTaskInput({
    chatId: activeId,
    isStreaming: isBusy,
    // Enter 发送：文本经 composeWithAttachments 拼接附件后再上抛
    onSend: (text) => dispatchSend(text),
    onStop,
    draftKeyPrefix: 'chat-input-draft',
  });

  const handlePickedFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) addFiles(files);
    // 重置 value，允许再次选择同一个文件
    e.target.value = '';
  };

  /** 有文本 或 附件全部上传完成 时允许发送 */
  const canSendNow = canSend || (!hasPending && attachments.length > 0);

  return (
    <div className="chat-input-area">
      <div className="chat-input-card">
        {/* 附件预览条 */}
        <AttachmentBar
          attachments={attachments}
          onRemove={removeAttachment}
        />

        <textarea
          ref={textareaRef}
          className="chat-input-textarea"
          placeholder={
            useCtrlEnterToSend
              ? '输入消息，Ctrl/⌘ + Enter 发送'
              : '输入你要撰写的主题，Enter 发送，Shift+Enter 换行'
          }
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          rows={1}
          aria-label="消息输入框"
        />
        <div className="chat-input-footer">
          <div className="chat-input-tools">
            {/* + 上传 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="chat-upload-btn"
                  aria-label="上传图片、文件"
                  data-tooltip="上传图片、文件"
                  disabled={isBusy}
                >
                  <Plus size={18} strokeWidth={2.2} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" sideOffset={8} className="min-w-[148px]">
                <DropdownMenuItem
                  onSelect={() => imageInputRef.current?.click()}
                >
                  <ImageIcon />
                  上传图片
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => fileInputRef.current?.click()}
                >
                  <FileText />
                  上传文件
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={imageInputRef}
              type="file"
              accept={IMAGE_ACCEPT_ATTR}
              multiple
              hidden
              onChange={handlePickedFiles}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept={FILE_ACCEPT_ATTR}
              multiple
              hidden
              onChange={handlePickedFiles}
            />

            <span className="chat-tools-divider" aria-hidden="true" />

            <button
              type="button"
              className={`chat-deep-think-btn${r1Active ? ' active' : ''}`}
              aria-pressed={r1Active}
              onClick={() => onR1Change(!r1Active)}
            >
              <Brain size={13} />
              深度思考
            </button>
            <button
              type="button"
              className={`chat-web-search-btn${netSearchActive ? ' active' : ''}`}
              aria-pressed={netSearchActive}
              onClick={() => onNetSearchChange(!netSearchActive)}
            >
              <Globe size={13} />
              联网搜索
            </button>
          </div>

          {isBusy ? (
            <button
              type="button"
              className="chat-send-btn chat-send-btn--stop"
              onClick={onStop}
              aria-label="停止生成"
              title="停止生成"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              className="chat-send-btn"
              onClick={() => dispatchSend(value)}
              disabled={!canSendNow}
              aria-label="发送消息"
              title="发送"
            >
              {isBusy ? <Spinner /> : <ArrowUp size={17} />}
            </button>
          )}
        </div>
      </div>
      <div className="copyright__item">内容由AI生成，仅供参考</div>
    </div>
  );
}
