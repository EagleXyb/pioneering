// ============================================================
// ImagePreview — 图片附件缩略图条 + 预览（对应文档 §6.5）
// 支持点击放大、悬停删除。仅 Vision 模型时由 InputArea 控制显示。
// ============================================================

import { useState } from 'react'
import { X, ImageIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { ImageAttachment } from '@/lib/input/image-attachments'

export interface ImagePreviewProps {
  images: ImageAttachment[]
  onRemove: (id: string) => void
  className?: string
}

export function ImagePreview({ images, onRemove, className }: ImagePreviewProps) {
  const [preview, setPreview] = useState<ImageAttachment | null>(null)
  if (images.length === 0) return null

  return (
    <>
      <div className={cn('flex flex-wrap gap-2 px-1 pb-2', className)}>
        {images.map((img) => (
          <div key={img.id} className="group relative size-16 overflow-hidden rounded-lg border bg-muted">
            <button
              type="button"
              onClick={() => setPreview(img)}
              className="block size-full"
              title="点击预览"
            >
              <img src={img.dataUrl} alt="" className="size-full object-cover" />
            </button>
            <button
              type="button"
              onClick={() => onRemove(img.id)}
              className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
              title="移除"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl bg-transparent shadow-none">
          <DialogTitle className="sr-only">图片预览</DialogTitle>
          {preview && (
            <img
              src={preview.dataUrl}
              alt=""
              className="max-h-[80vh] w-full rounded-xl object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
