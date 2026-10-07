/**
 * 附件预览条（chat / pro / task 共用，T4.4 抽取自 ChatAttachments）
 *
 * 展示已选择/上传中的附件：
 *   - 图片：缩略图（上传中用本地 objectURL 即时预览，上传成功换为服务端 URL）
 *   - 文件（pdf/txt）：文件图标 + 文件名 + 大小
 *   - 每项可移除（上传中仅取消本地项；上传完成额外 best-effort 调 DELETE /upload）
 *
 * 纯受控组件：数据与上传编排由 useAttachments 管理。
 */
import { FileText, Loader2, X } from 'lucide-react';
import type { UploadedFile } from '../../api/upload';
import { formatFileSize, isImageType } from '../../api/upload';

export type AttachmentStatus = 'uploading' | 'done' | 'error';

export interface AttachmentItem {
  /** 前端临时唯一 id（上传中阶段使用） */
  tempId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  status: AttachmentStatus;
  /** 上传成功后的服务端文件记录 */
  uploaded?: UploadedFile;
  /** 上传中的本地预览（图片 objectURL），移除时需 revoke */
  localPreviewUrl?: string;
  errorMessage?: string;
}

interface Props {
  attachments: AttachmentItem[];
  onRemove: (tempId: string) => void;
}

function AttachmentCard({
  item,
  onRemove,
}: {
  item: AttachmentItem;
  onRemove: () => void;
}) {
  const isImage = isImageType(item.fileType);
  const previewUrl =
    item.status === 'done' && item.uploaded
      ? item.uploaded.url
      : item.localPreviewUrl;
  const isError = item.status === 'error';
  const isUploading = item.status === 'uploading';

  return (
    <div
      className={`chat-attachment-card${isImage ? ' chat-attachment-card--image' : ''}${
        isError ? ' is-error' : ''
      }`}
      title={isError ? item.errorMessage || '上传失败' : item.fileName}
    >
      {isImage ? (
        <div className="chat-attachment-thumb">
          {previewUrl ? (
            <img src={previewUrl} alt={item.fileName} />
          ) : (
            <FileText size={18} />
          )}
          {isUploading && (
            <div className="chat-attachment-mask">
              <Loader2 size={16} className="chat-attachment-spinner" />
            </div>
          )}
        </div>
      ) : (
        <div className="chat-attachment-file-icon">
          <FileText size={18} />
          {isUploading && (
            <Loader2 size={12} className="chat-attachment-spinner chat-attachment-spinner--corner" />
          )}
        </div>
      )}

      <div className="chat-attachment-meta">
        <div className="chat-attachment-name">{item.fileName}</div>
        <div className="chat-attachment-sub">
          {isError
            ? item.errorMessage || '上传失败'
            : isUploading
              ? '上传中…'
              : formatFileSize(item.fileSize)}
        </div>
      </div>

      <button
        type="button"
        className="chat-attachment-remove"
        onClick={onRemove}
        aria-label={`移除附件 ${item.fileName}`}
        title="移除"
      >
        <X size={13} />
      </button>
    </div>
  );
}

export function AttachmentBar({ attachments, onRemove }: Props) {
  if (attachments.length === 0) return null;
  return (
    <div className="chat-attachment-bar">
      {attachments.map((item) => (
        <AttachmentCard
          key={item.tempId}
          item={item}
          onRemove={() => onRemove(item.tempId)}
        />
      ))}
    </div>
  );
}
