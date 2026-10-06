/**
 * chat 输入区附件编排
 *
 * 生命周期：
 *   选择文件 → 前置校验（类型/大小）→ 立即插入 uploading 项（图片给本地 objectURL 预览）
 *          → POST /upload → done（记录服务端 UploadedFile）/ error
 *   移除附件：revoke 本地预览 URL；已上传成功的 best-effort 调 DELETE /upload
 *   发送：takeMessageSuffix() 把附件拼成 Markdown 文本并清空（拼绝对 URL）
 *
 * 发送协议无附件字段（后端 ChatCompletionRequest 仅纯文本 + DeepSeek），
 * 故附件以 Markdown 图片/链接形式拼入消息正文：
 *   - 图片：![name](absoluteUrl)
 *   - 文件：[name](absoluteUrl)
 * 历史回读时由 Markdown 渲染器直接呈现（http(s) URL 经 sanitize 白名单放行）。
 */
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  deleteUpload,
  toAbsoluteUploadUrl,
  uploadFile,
  validateUploadFile,
} from '../../../api/upload';
import type { ChatAttachment } from '../components/ChatAttachments';

let tempSeq = 0;
function nextTempId(): string {
  tempSeq += 1;
  return `att_${Date.now()}_${tempSeq}`;
}

export function useChatAttachments() {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  /** objectURL → tempId，卸载/移除时统一回收 */
  const objectUrlsRef = useRef<Map<string, string>>(new Map());

  const patchItem = useCallback(
    (tempId: string, patch: Partial<ChatAttachment>) => {
      setAttachments((prev) =>
        prev.map((a) => (a.tempId === tempId ? { ...a, ...patch } : a)),
      );
    },
    [],
  );

  const revokeUrl = useCallback((url: string) => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }, []);

  /** 追加一批文件（图片/文件入口共用） */
  const addFiles = useCallback(
    (files: File[]) => {
      for (const file of Array.from(files)) {
        const error = validateUploadFile(file);
        if (error) {
          toast.error(error);
          continue;
        }

        const tempId = nextTempId();
        const isImage = file.type.startsWith('image/');
        const localPreviewUrl = isImage ? URL.createObjectURL(file) : undefined;
        if (localPreviewUrl) {
          objectUrlsRef.current.set(tempId, localPreviewUrl);
        }

        const item: ChatAttachment = {
          tempId,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          status: 'uploading',
          localPreviewUrl,
        };
        setAttachments((prev) => [...prev, item]);

        // 异步上传，完成后落地服务端记录
        void uploadFile(file)
          .then((uploaded) => {
            patchItem(tempId, { status: 'done', uploaded });
          })
          .catch((e: { message?: string }) => {
            patchItem(tempId, {
              status: 'error',
              errorMessage: e?.message || '上传失败',
            });
          });
      }
    },
    [patchItem],
  );

  /** 移除单个附件（回收预览 URL；已上传则通知后端删除） */
  const removeAttachment = useCallback(
    (tempId: string) => {
      // 副作用必须在 setState updater 外执行：updater 在 React StrictMode
      // 开发态会被双调用，写在里面会导致 DELETE 重复发送。
      const target = attachments.find((a) => a.tempId === tempId);
      if (target) {
        if (target.localPreviewUrl) {
          revokeUrl(target.localPreviewUrl);
          objectUrlsRef.current.delete(tempId);
        }
        if (target.status === 'done' && target.uploaded) {
          // 后端删除失败不影响本地移除（文件可后续清理）
          void deleteUpload(target.uploaded.id).catch(() => {});
        }
      }
      setAttachments((prev) => prev.filter((a) => a.tempId !== tempId));
    },
    [attachments, revokeUrl],
  );

  /** 是否存在未完成（上传中/失败）的附件：发送前据此阻止并提示 */
  const hasPending = attachments.some((a) => a.status !== 'done');

  /**
   * 取出拼入消息正文的附件 Markdown 后缀并清空本地附件状态。
   * 由发送动作在确认无 pending 后调用；返回空串表示无附件。
   */
  const takeMessageSuffix = useCallback((): string => {
    const done = attachments.filter((a) => a.status === 'done' && a.uploaded);
    if (done.length === 0) return '';

    const lines = done.map((a) => {
      const u = a.uploaded!;
      const absolute = toAbsoluteUploadUrl(u.url);
      const safeName = u.original_name.replace(/([\\[\]])/g, '\\$1');
      return a.fileType.startsWith('image/')
        ? `![${safeName}](${absolute})`
        : `[${safeName}](${absolute})`;
    });

    // 清空并回收所有本地预览 URL（服务端文件保留，已随消息引用）
    for (const a of attachments) {
      if (a.localPreviewUrl) {
        revokeUrl(a.localPreviewUrl);
        objectUrlsRef.current.delete(a.tempId);
      }
    }
    setAttachments([]);
    return `\n\n${lines.join('\n')}`;
  }, [attachments, revokeUrl]);

  return {
    attachments,
    hasPending,
    addFiles,
    removeAttachment,
    takeMessageSuffix,
  };
}
