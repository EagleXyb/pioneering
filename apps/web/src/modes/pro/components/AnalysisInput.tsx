import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowUp, Mic, Square, Plus, Image as ImageIcon, FileText as FileTextIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { ChatStatus } from '../../../types/chat';
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
// 分析模式输入区使用 pro.css 中的 .pro-input-* 独立样式，不依赖 task.css

interface Props {
  status: ChatStatus;
  onSend: (text: string) => void;
  onStop: () => void;
  /** HITL 待答复项：非空时渲染卡片并锁定输入框 */
  hitl?: HitlItem | null;
  hitlError?: string | null;
  hitlBusy?: boolean;
}

export function AnalysisInput({
  status,
  onSend,
  onStop,
  hitl,
  hitlError,
  hitlBusy,
}: Props) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // T4.4：附件（图片/文件上传，发送时拼 Markdown 后缀）
  const {
    attachments,
    hasPending,
    addFiles,
    removeAttachment,
    takeMessageSuffix,
  } = useAttachments();

  const handleSend = useCallback(() => {
    if (hasPending) {
      toast.error('附件仍在上传，请稍候');
      return;
    }
    const text = value.trim();
    const suffix = takeMessageSuffix();
    if (!text && !suffix) return;
    onSend(`${text}${suffix}`);
    setValue('');
  }, [value, onSend, hasPending, takeMessageSuffix]);

  const handlePickedFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) addFiles(files);
    e.target.value = '';
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const isStreaming = status === 'streaming' || status === 'pending';
  const locked = !!hitl;

  // 自动增高：与 TaskMode 输入区一致的多行展开体验
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = 200;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, isStreaming, adjustHeight]);

  return (
    <div className="pro-input-area">
      <div className="pro-input-inner">
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
        <div className="pro-input-card">
          <AttachmentBar
            attachments={attachments}
            onRemove={removeAttachment}
          />
          <textarea
            ref={textareaRef}
            className="pro-input-text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述分析需求... Enter 发送，Shift+Enter 换行"
            rows={1}
            disabled={isStreaming || locked}
            aria-label="分析输入框"
          />
          <div className="pro-input-toolbar">
            <div className="pro-input-toolbar-left">
              {/* T4.4：上传图片/文件 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="pro-input-toolbar-btn"
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
                popClassName="pro-input"
                disabled={isStreaming || locked}
                items={buildMoreMenuItems({
                  onUploadImage: () => imageInputRef.current?.click(),
                  onUploadFile: () => fileInputRef.current?.click(),
                  disabled: isStreaming || locked,
                })}
              />
            </div>
            <div className="pro-input-toolbar-right">
              <button
                type="button"
                className="pro-input-toolbar-btn"
                aria-label="语音输入"
                title="语音输入即将上线"
                disabled
              >
                <Mic className="h-5 w-5" strokeWidth={1.8} />
              </button>
              {isStreaming ? (
                <button
                  type="button"
                  className="pro-input-send-btn pro-input-send-btn--stop"
                  onClick={onStop}
                  aria-label="停止"
                >
                  <Square className="h-4 w-4" strokeWidth={2.5} />
                </button>
              ) : (
                <button
                  type="button"
                  className="pro-input-send-btn"
                  onClick={handleSend}
                  disabled={!value.trim() || locked}
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
