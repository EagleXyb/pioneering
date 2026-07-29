// ============================================================
// lightboxStore — 图片放大预览（Lightbox）状态（P1 新增）
// ============================================================
// 与 artifactStore 同构的轻量 UI 状态层：jotai atom + 派生写动作。
// 全局单例，由 ChatArea 内挂载的唯一 <ImageLightbox /> 消费；
// 触发方为 MarkdownRenderer 的 SafeImage 与 MessageBubble 的用户图片缩略图。
// ============================================================

import { atom } from 'jotai'

/** 当前放大的图片地址（dataUrl 或 http(s) URL）；null 表示关闭 */
export const lightboxImageAtom = atom<string | null>(null)

/** 打开 Lightbox */
export const openLightboxAtom = atom(null, (_get, set, src: string) => {
  set(lightboxImageAtom, src)
})

/** 关闭 Lightbox */
export const closeLightboxAtom = atom(null, (_get, set) => {
  set(lightboxImageAtom, null)
})
