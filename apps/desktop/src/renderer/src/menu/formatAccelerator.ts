// ============================================================
// formatAccelerator — 把模板里的 accelerator 转成当前平台显示串
// mac -> ⌘Z / ⇧⌘Z / ⌘⇧I；win/linux -> Ctrl+Z / Ctrl+Shift+Z / Ctrl+Shift+I
// 同一份菜单模板在两端显示正确图标，避免 ⌘ 写死（修复问题 3）。
// ============================================================

import type { Platform } from '@shared/types'

export function formatAccelerator(accel: string | undefined, platform: Platform): string {
  if (!accel) return ''
  const isMac = platform === 'mac'
  const mod = isMac ? '⌘' : 'Ctrl+'
  const shift = accel.includes('Shift') ? (isMac ? '⇧' : 'Shift+') : ''
  const key = accel.split('+').pop()!.toUpperCase()
  return isMac ? `${shift}${mod}${key}` : `${mod}${shift}${key}`
}
