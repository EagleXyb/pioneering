import React, { useRef } from 'react';
import { ArrowUp, Square, Plus, Image as ImageIcon, FileText as FileTextIcon, Mic } from 'lucide-react';
import { toast } from 'sonner';
import type { ChatStatus } from '../../../types/chat';
import {
  HitlInlineCard,
  useHitlStore,
  type HitlItem,
} from '@pioneering/agent-protocol';
import { useAttachments } from '@/hooks/useAttachments';
import { AttachmentBar } from '@/components/attachments/AttachmentBar';
import { ModelSelect } from '@/components/ModelSelect/ModelSelect';
import { useTaskInput } from '../../task/hooks/useTaskInput';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FILE_ACCEPT_ATTR, IMAGE_ACCEPT_ATTR } from '@/api/upload';

interface Props {
  /** 当前会话 ID，用于草稿隔离 */
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
 * 分析模式输入区 —— 与 chat / task 同一套输入卡片布局。
 * 输入逻辑（IME 保护 / 草稿 / autosize / Enter 策略）复用 useTaskInput。
 */
export function AnalysisInput({
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

  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 附件（图片/文件上传，发送时拼 Markdown 后缀）
  const {
    attachments,
    hasPending,
    addFiles,
    removeAttachment,
    takeMessageSuffix,
  } = useAttachments();

  /** 文本 + 附件 Markdown 后缀组合后交给上层 onSend */
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
    chatId,
    isStreaming: isBusy,
    onSend: (text) => dispatchSend(text),
    onStop,
    draftKeyPrefix: 'pro-input-draft',
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
              : '输入分析需求，Enter 发送，Shift+Enter 换行'
          }
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          rows={1}
          disabled={isBusy || locked}
          aria-label="分析输入框"
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
                  disabled={isBusy || locked}
                >
                  <Plus size={18} strokeWidth={2.2} />
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
            <ModelSelect mode="pro" disabled={isBusy || locked} />
            <button
              type="button"
              className="chat-upload-btn"
              aria-label="语音输入"
              data-tooltip="语音输入"
              disabled={isBusy || locked}
            >
              <Mic size={19} />
            </button>
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
                disabled={!canSendNow || locked}
                aria-label="发送消息"
                title="发送"
              >
                <ArrowUp size={17} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="copyright__item">内容由AI生成，仅供参考</div>
    </div>
  );
}
