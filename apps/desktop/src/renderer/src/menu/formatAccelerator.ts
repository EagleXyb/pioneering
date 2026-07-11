// ============================================================
// formatAccelerator — 把模板里的 accelerator 转成当前平台显示串
// mac -> ⌘Z / ⇧⌘Z / ⌘⇧I；win/linux -> Ctrl+Z / Ctrl+Shift+Z / Ctrl+Shift+I
// 同一份菜单模板在两端显示正确图标，避免 ⌘ 写死（修复问题 3）。
// ============================================================

import type { Platform } from '@shared/types'

// B12 修复：原实现 accel.split('+').pop()!.toUpperCase() 对 'CmdOrCtrl++'（+ 键）
// 得到空字符串（split 后最后两段是 '' 和 ''）。改为正确解析修饰键与主键。
// Electron accelerator 格式：修饰键用 + 分隔，主键是最后一段；
// 但 '+' 键本身也是合法主键，需特殊处理。同时补充常见非字母键的友好显示。
const MODIFIER_TOKENS = new Set([
  'CommandOrCtrl',
  'CmdOrCtrl',
  'Command',
  'Cmd',
  'Control',
  'Ctrl',
  'Shift',
  'Alt',
  'Option',
  'Meta',
  'Super'
])

// 非字母键的平台友好显示映射
const KEY_DISPLAY: Record<string, string> = {
  Enter: '⏎',
  Return: '⏎',
  Escape: '⎋',
  Esc: '⎋',
  Tab: '⇥',
  Backspace: '⌫',
  Delete: '⌦',
  Space: '␣',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Home: '↖',
  End: '↘',
  PageUp: '⇞',
  PageDown: '⇟'
}

export function formatAccelerator(accel: string | undefined, platform: Platform): string {
  if (!accel) return ''
  const isMac = platform === 'mac'

  // B12: 按 + 分隔后，从尾部找出第一个非修饰键 token 作为主键
  // 这样能正确处理 'CmdOrCtrl++'（主键是 '+'）和 'CmdOrCtrl+Shift+Plus' 等情况
  const tokens = accel.split('+')
  let mainKey = ''
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!.trim()
    if (t && !MODIFIER_TOKENS.has(t)) {
      // '+' 键在 Electron 中用 'Plus' 表示，但也兼容直接 '+'
      mainKey = t
      break
    }
  }
  // 兜底：若未找到主键（纯修饰键组合，异常情况），取最后一段
  if (!mainKey) mainKey = tokens[tokens.length - 1] ?? ''

  const hasShift = tokens.some((t) => t.trim() === 'Shift')
  const shift = hasShift ? (isMac ? '⇧' : 'Shift+') : ''
  const mod = isMac ? '⌘' : 'Ctrl+'

  // 主键显示：优先查映射表，否则单字母大写，其余原样
  let keyDisplay: string
  const mapped = KEY_DISPLAY[mainKey]
  if (mapped) {
    keyDisplay = mapped
  } else if (mainKey === 'Plus') {
    keyDisplay = '+'
  } else if (mainKey.length === 1) {
    keyDisplay = mainKey.toUpperCase()
  } else {
    keyDisplay = mainKey
  }

  return isMac ? `${shift}${mod}${keyDisplay}` : `${mod}${shift}${keyDisplay}`
}
