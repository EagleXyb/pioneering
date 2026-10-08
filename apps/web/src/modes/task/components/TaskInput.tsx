import { useCallback, useRef } from 'react';
import type { ChatStatus } from '../../../types/chat';
import { ArrowUp, Square, Plus, Image as ImageIcon, FileText as FileTextIcon, Mic } from 'lucide-react';
import { toast } from 'sonner';
import { useTaskInput } from '../hooks/useTaskInput';
import {
  HitlInlineCard,
  useHitlStore,
  type HitlItem,
} from '@pioneering/agent-protocol';
import { useAttachments } from '@/hooks/useAttachments';
import { AttachmentBar } from '@/components/attachments/AttachmentBar';
import { ModelSelect } from '@/components/ModelSelect/ModelSelect';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FILE_ACCEPT_ATTR, IMAGE_ACCEPT_ATTR } from '@/api/upload';

interface Props {
  chatId: string | null;
  status: ChatStatus;
  onSend: (text: string) => void;
  onStop: () => void;
  /** HITL 待答复项：非空时渲染卡片并锁定输入框 */
  hitl?: HitlItem | null;
  hitlError?: string | null;
  hitlBusy?: boolean;
}

/**
 * 任务模式输入区 —— 与 chat / pro 同一套输入卡片布局。
 * 输入逻辑（IME 保护 / 草稿 / autosize / Enter 策略）见 useTaskInput。
 */
export function TaskInput({
  chatId,
  status,
  onSend,
  onStop,
  hitl,
  hitlError,
  hitlBusy,
}: Props) {
  const isBusy = status === 'streaming' || status === 'pending';
  const locked = !!hitl;

  // 附件（图片/文件）
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    attachments,
    hasPending,
    addFiles,
    removeAttachment,
    takeMessageSuffix,
  } = useAttachments();

  /** 文本 + 附件 Markdown 后缀组合后交给上层 onSend */
  const composeSend = useCallback(
    (text: string) => {
      if (hasPending) {
        toast.error('附件仍在上传，请稍候');
        return;
      }
      const suffix = takeMessageSuffix();
      if (!text && !suffix) return;
      onSend(`${text}${suffix}`);
    },
    [onSend, hasPending, takeMessageSuffix],
  );

  const handlePickedFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) addFiles(files);
    e.target.value = '';
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
    chatId,
    isStreaming: isBusy || locked,
    onSend: composeSend,
    onStop,
  });

  /** 有文本 或 已传完附件 时可发送 */
  const canSendNow = canSend || (!hasPending && attachments.length > 0);

  return (
    <div className="chat-input-area">
      {locked && hitl && (
        <div className="chat-input-hitl">
          <HitlInlineCard
            kind={hitl.kind}
            question={hitl.question}
            message={hitl.message}
            options={hitl.options}
            error={hitlError}
            busy={hitlBusy}
            toolCalls={hitl.toolCalls?.map((tc) => ({
              id: tc.id,
              name: tc.name,
              args: tc.args,
            }))}
            onAnswer={(text) =>
              void useHitlStore
                .getState()
                .resolve({ approved: true, answer: text, feedback: text })
            }
            onSelectOption={(id) =>
              void useHitlStore.getState().resolve({ approved: true, answerId: id })
            }
            onSkip={() => void useHitlStore.getState().skip()}
            onDismiss={() => useHitlStore.getState().dismiss()}
            onApprove={(modifiedArgs) =>
              useHitlStore.getState().resolve({ approved: true, modifiedArgs })
            }
            onReject={(feedback) =>
              useHitlStore.getState().resolve({ approved: false, feedback })
            }
          />
        </div>
      )}
      <div className="chat-input-card">
        <AttachmentBar
          attachments={attachments}
          onRemove={removeAttachment}
        />
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          placeholder={
            useCtrlEnterToSend
              ? '输入消息，Ctrl/⌘ + Enter 发送'
              : '输入任务需求，Enter 发送，Shift+Enter 换行'
          }
          rows={1}
          disabled={isBusy || locked}
          className="chat-input-textarea"
          aria-label="任务输入框"
        />

        <div className="chat-input-footer">
          <div className="chat-input-tools">
            {/* + 上传图片/文件 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="chat-upload-btn"
                  aria-label="上传图片、文件"
                  data-tooltip="上传图片、文件"
                  disabled={isBusy || locked}
                >
                  <Plus size={17} strokeWidth={2.2} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" sideOffset={8} className="min-w-[148px]">
                <DropdownMenuItem onSelect={() => imageInputRef.current?.click()}>
                  <ImageIcon />
                  上传图片
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                  <FileTextIcon />
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
          </div>

          <div className="chat-input-actions">
            <ModelSelect mode="task" disabled={isBusy || locked} />
            <button
              type="button"
              className="chat-upload-btn"
              aria-label="语音输入"
              data-tooltip="语音输入"
              disabled={isBusy || locked}
            >
              <Mic size={17} />
            </button>
            {isBusy ? (
              <button
                type="button"
                className="chat-send-btn chat-send-btn--stop"
                onClick={onStop}
                aria-label="停止生成"
              >
                <Square size={13} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                className="chat-send-btn"
                onClick={() => composeSend(value)}
                disabled={!canSendNow || locked}
                aria-label="发送"
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="copyright__item">内容由AI生成，仅供参考</div>
    </div>
  );
}
