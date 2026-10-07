import { useCallback, useRef } from 'react';
import type { ChatStatus } from '../../../types/chat';
import { ArrowUp, Mic, Square, Plus, Image as ImageIcon, FileText as FileTextIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useTaskInput } from '../hooks/useTaskInput';
import { MoreMenu } from '@/components/more-menu/MoreMenu';
import { buildMoreMenuItems } from '@/components/more-menu/buildMoreMenuItems';
import {
  HitlInlineCard,
  useHitlStore,
  type HitlItem,
} from '@pioneering/agent-protocol';
import { useAttachments } from '@/hooks/useAttachments';
import { AttachmentBar } from '@/components/attachments/AttachmentBar';
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
 * 任务模式输入框 —— Apple 极简卡片式设计
 * 逻辑实现见 `../hooks/useTaskInput.ts`。
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
  const isStreaming = status === 'streaming' || status === 'pending';
  const locked = !!hitl;

  // T4.4：附件（图片/文件）
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
    handleSend,
    canSend,
  } = useTaskInput({
    chatId,
    isStreaming: isStreaming || locked,
    onSend: composeSend,
    onStop,
  });

  /** 有文本 或 已传完附件 时可发送 */
  const canSendNow = canSend || (!hasPending && attachments.length > 0);

  return (
    <div className="task-input-area">
      <div className="task-input-inner">
        {locked && hitl && (
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
        )}
        <div className="task-input-card">
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
            placeholder="今天帮你做些什么？@引用对话文件，/调用技能与指令"
            rows={1}
            disabled={isStreaming || locked}
            className="task-input-text"
            aria-label="任务输入框"
          />

          <div className="task-input-toolbar">
            <div className="task-input-toolbar-left">
              {/* T4.4：上传图片/文件 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="task-input-toolbar-btn"
                    aria-label="上传图片、文件"
                    title="上传图片、文件"
                    disabled={isStreaming || locked}
                  >
                    <Plus className="h-5 w-5" strokeWidth={2} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" sideOffset={8} className="min-w-[148px]">
                  <DropdownMenuItem onSelect={() => imageInputRef.current?.click()}>
                    <ImageIcon className="h-4 w-4" />
                    上传图片
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                    <FileTextIcon className="h-4 w-4" />
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
              <MoreMenu
                popClassName="task-input"
                disabled={isStreaming || locked}
                items={buildMoreMenuItems({
                  onUploadImage: () => imageInputRef.current?.click(),
                  onUploadFile: () => fileInputRef.current?.click(),
                  disabled: isStreaming || locked,
                })}
              />
            </div>

            <div className="task-input-toolbar-right">
              <button
                type="button"
                className="task-input-toolbar-btn"
                aria-label="语音输入"
                disabled
                title="语音输入即将上线"
              >
                <Mic className="h-5 w-5" strokeWidth={1.8} />
              </button>

              {isStreaming ? (
                <button
                  type="button"
                  className="task-input-send-btn task-input-send-btn--stop"
                  onClick={onStop}
                  aria-label="停止生成"
                >
                  <Square className="h-4 w-4" fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className="task-input-send-btn"
                  onClick={handleSend}
                  disabled={!canSendNow || locked}
                  aria-label="发送"
                >
                  <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
