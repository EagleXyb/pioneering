// ============================================================
// ImageLightbox — 应用内图片放大预览（P1 新增）
// ============================================================
// 复用已安装的 @radix-ui/react-dialog 原语（焦点圈禁 / Esc 关闭 / Portal），
// 不引入新的第三方依赖；遮罩与动画类与 ui/dialog.tsx 保持一致，零新增样式体系。
//
// 渲染策略：
//   - 图片按视口 90% 等比适配（object-contain），不裁剪、不拉伸；
//   - 点击遮罩 / 关闭按钮 / Esc 均可关闭；点击图片本身不关闭（stopPropagation）。
//
// 安全策略：src 仅由 SafeImage / MessageBubble 用户图片传入（均已做过
// http(s) 或 image/* 校验），组件内再做一次显式协议白名单，三重防御。
// ============================================================

import { useAtomValue, useSetAtom } from 'jotai'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { lightboxImageAtom, closeLightboxAtom } from '@/stores/lightboxStore'

/** 与 SafeImage 一致的协议白名单：http(s) 或 data:image/（用户本地图片） */
function isSafeImageSrc(src: string): boolean {
  return /^https?:\/\//i.test(src) || /^data:image\//i.test(src)
}

export function ImageLightbox() {
  const src = useAtomValue(lightboxImageAtom)
  const closeLightbox = useSetAtom(closeLightboxAtom)

  const safeSrc = src && isSafeImageSrc(src) ? src : null

  return (
    <DialogPrimitive.Root open={safeSrc !== null} onOpenChange={(open) => !open && closeLightbox()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-center justify-center outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          onClick={() => closeLightbox()}
        >
          <DialogPrimitive.Title className="sr-only">图片预览</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            放大的图片预览，点击任意位置或按 Esc 关闭
          </DialogPrimitive.Description>
          {safeSrc && (
            <img
              src={safeSrc}
              alt="图片预览"
              className="max-h-[90vh] max-w-[90vw] select-none object-contain data-[state=open]:zoom-in-95"
              draggable={false}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <DialogPrimitive.Close
            className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white opacity-80 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-white/50"
            aria-label="关闭图片预览"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
