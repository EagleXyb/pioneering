/**
 * 文件上传 API
 *
 * 对应后端 POST /upload（multipart/form-data，@fastify/multipart）：
 *   - 白名单：png / jpeg / gif / webp / pdf / txt
 *   - 大小上限：10MB（后端 MAX_UPLOAD_SIZE）
 *   - 返回 { id, url, original_name, file_type, file_size }
 *
 * client.ts 的 JSON 封装不适用于 multipart，这里单独 fetch 并手动注入鉴权头。
 */
import { getAuthHeader } from './client';

/** 后端 upload.ALLOWED_TYPES 同源白名单（MIME → 用途分类） */
export const UPLOAD_ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
] as const;

export const IMAGE_ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

export const FILE_ACCEPTED_TYPES = ['application/pdf', 'text/plain'] as const;

/** 与后端 env.MAX_UPLOAD_SIZE 默认值对齐（10MB） */
export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

/** 「上传图片」入口的 input accept 字符串 */
export const IMAGE_ACCEPT_ATTR = IMAGE_ACCEPTED_TYPES.join(',');
/** 「上传文件」入口的 input accept 字符串 */
export const FILE_ACCEPT_ATTR = FILE_ACCEPTED_TYPES.join(',');

/** 后端 /upload 响应（已过 client.ts 的 {code,data} 解包，此处为 data 形状） */
export interface UploadedFile {
  id: string;
  /** 相对路径，如 /uploads/avatars/xxx.png（经 vite proxy / 同源静态服务可访问） */
  url: string;
  original_name: string;
  file_type: string;
  file_size: number;
}

/** 前端选择文件阶段的前置校验（避免把不合规文件发给后端） */
export function validateUploadFile(file: File): string | null {
  if (!(UPLOAD_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return `不支持的文件类型：${file.name}（仅支持 PNG/JPG/GIF/WEBP/PDF/TXT）`;
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    return `文件「${file.name}」超过 10MB 上限`;
  }
  if (file.size === 0) {
    return `文件「${file.name}」为空`;
  }
  return null;
}

export function isImageType(fileType: string): boolean {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(fileType);
}

/** 上传单个文件，multipart/form-data；失败时 reject(Error) */
export async function uploadFile(file: File): Promise<UploadedFile> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: {
      ...getAuthHeader(),
      // 不要手动设 Content-Type，浏览器会自动带 multipart boundary
    },
    body: formData,
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => null);
    throw new Error(
      (errData as { message?: string } | null)?.message ||
        `上传失败: ${response.status}`,
    );
  }

  const json = (await response.json()) as
    | { code: number; data: UploadedFile }
    | UploadedFile;
  // 兼容响应包裹：有 code/data 取 data
  return 'code' in json && json.data ? json.data : (json as UploadedFile);
}

/** 删除已上传文件（best-effort；移除附件时调用，失败由调用方决定提示策略） */
export async function deleteUpload(fileId: string): Promise<void> {
  const response = await fetch(`/api/upload/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: {
      ...getAuthHeader(),
    },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`删除附件失败: ${response.status}`);
  }
}

/** 拼接可跨环境访问的绝对 URL（dev 走 5173 proxy，生产同源） */
export function toAbsoluteUploadUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** 文件大小人类可读 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
