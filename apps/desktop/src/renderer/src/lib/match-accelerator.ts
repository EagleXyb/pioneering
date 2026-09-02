// ============================================================
// match-accelerator — 快捷键匹配引擎（渲染端）
//   1. 输入：KeyboardEvent + accelerator 串（Electron 语法）
//   2. 匹配策略：物理键位（e.code）优先，字符键（e.key）兜底，
//      规避 AZERTY 等键盘布局下 e.key 与物理位置不符的问题。
//   3. 修饰键：Ctrl / Shift / Alt / Meta（Cmd）/ CmdOrCtrl（平台自适应）
// ============================================================

import type { HotkeyBinding } from '../../../shared/hotkey-protocol'

/** 事件中提取的修饰键状态 */
interface ModifierState {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}

function getModifiers(e: KeyboardEvent): ModifierState {
  return {
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    meta: e.metaKey
  }
}

/** 是否为 macOS（修饰键语义：CmdOrCtrl → Meta） */
export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)
}

/** 解析 accelerator 串：返回修饰键要求 + 主键规范名 */
export function parseAccelerator(accel: string): {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  cmdOrCtrl: boolean
  key: string // 小写规范化主键
} | null {
  const parts = accel
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return null

  const result = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    cmdOrCtrl: false,
    key: ''
  }

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!
    const lower = p.toLowerCase()
    if (i < parts.length - 1) {
      // 修饰键段
      if (lower === 'ctrl' || lower === 'control') result.ctrl = true
      else if (lower === 'shift') result.shift = true
      else if (lower === 'alt' || lower === 'option') result.alt = true
      else if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'super') result.meta = true
      else if (lower === 'cmdorctrl') result.cmdOrCtrl = true
      else return null // 未知修饰键，视为非法
    } else {
      result.key = normalizeKeyName(p)
    }
  }
  return result
}

/** 主键名规范化：F 键/字母/特殊键统一小写比较 */
function normalizeKeyName(k: string): string {
  const lower = k.toLowerCase()
  // Electron accelerator 特殊键名 → 统一比较名
  const map: Record<string, string> = {
    esc: 'escape',
    return: 'enter',
    plus: '=',
    equal: '=',
    equals: '=',
    comma: ',',
    period: '.',
    slash: '/',
    backslash: '\\',
    semicolon: ';',
    quote: "'",
    backquote: '`',
    bracketleft: '[',
    bracketright: ']',
    minus: '-',
    tab: 'tab',
    space: 'space',
    capslock: 'capslock',
    pageup: 'pageup',
    pagedown: 'pagedown',
    up: 'arrowup',
    down: 'arrowdown',
    left: 'arrowleft',
    right: 'arrowright',
    delete: 'delete',
    insert: 'insert',
    home: 'home',
    end: 'end'
  }
  return map[lower] ?? lower
}

/** e.code → 规范化主键名（物理键位，不受布局影响） */
function codeToKeyName(code: string): string | null {
  // 字母区：KeyA → a
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase()
  // 数字区：Digit0-9 → 0-9
  if (/^Digit\d$/.test(code)) return code.slice(5)
  // F 键：F1-F24
  if (/^F\d{1,2}$/.test(code)) return code.toLowerCase()
  // 小键盘：Numpad0-9 → 数字（与小键盘 Enter/Add 等区分）
  if (/^Numpad\d$/.test(code)) return code.slice(6)
  const map: Record<string, string> = {
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Backquote: '`',
    BracketLeft: '[',
    BracketRight: ']',
    Minus: '-',
    Equal: '=',
    Space: 'space',
    Tab: 'tab',
    Enter: 'enter',
    Escape: 'escape',
    Backspace: 'backspace',
    Delete: 'delete',
    Insert: 'insert',
    Home: 'home',
    End: 'end',
    PageUp: 'pageup',
    PageDown: 'pagedown',
    ArrowUp: 'arrowup',
    ArrowDown: 'arrowdown',
    ArrowLeft: 'arrowleft',
    ArrowRight: 'arrowright',
    NumpadEnter: 'enter',
    NumpadAdd: '=',
    NumpadSubtract: '-',
    NumpadMultiply: '*',
    NumpadDivide: '/',
    NumpadDecimal: '.'
  }
  return map[code] ?? null
}

/** e.key → 规范化主键名（布局相关，仅兜底） */
function keyToKeyName(key: string): string | null {
  const lower = key.toLowerCase()
  if (lower.length === 1) return lower // 字母/数字/标点
  return normalizeKeyName(lower)
}

/**
 * 核心：KeyboardEvent 是否命中 accelerator 绑定。
 * 物理键位（e.code）优先匹配；e.code 无法覆盖的（如 IME 态）用 e.key 兜底。
 */
export function matchesAccelerator(e: KeyboardEvent, binding: HotkeyBinding): boolean {
  if (!binding) return false
  const parsed = parseAccelerator(binding)
  if (!parsed || !parsed.key) return false

  const mods = getModifiers(e)
  const isMac = isMacPlatform()

  // 修饰键精确匹配（四个修饰键都必须完全一致，杜绝 Ctrl+B 误命中 Ctrl+Shift+B）
  // CmdOrCtrl 平台自适应：mac = Meta（⌘），Windows/Linux = Ctrl
  const wantCtrl = parsed.ctrl || (parsed.cmdOrCtrl && !isMac)
  const wantMeta = parsed.meta || (parsed.cmdOrCtrl && isMac)
  if (mods.ctrl !== wantCtrl) return false
  if (mods.meta !== wantMeta) return false
  if (mods.shift !== parsed.shift) return false
  if (mods.alt !== parsed.alt) return false

  // 单独 Escape/Enter 等无修饰键主键
  const eventKeyByCode = e.code ? codeToKeyName(e.code) : null
  const eventKeyByKey = e.key ? keyToKeyName(e.key) : null

  if (eventKeyByCode === parsed.key) return true
  if (eventKeyByKey === parsed.key) return true
  return false
}

/**
 * 录制弹窗：把用户按下的组合转换为 accelerator 串（存 electron 格式）。
 * 返回 null 表示当前组合不完整（只按了修饰键）或不可用。
 */
export function eventToAccelerator(e: KeyboardEvent): string | null {
  const codeKey = e.code ? codeToKeyName(e.code) : null
  const keyKey = e.key ? keyToKeyName(e.key) : null

  // 主键必须存在且不是纯修饰键
  const mainKey = codeKey ?? keyKey
  if (!mainKey) return null
  if (['control', 'shift', 'alt', 'meta', 'capslock'].includes(mainKey)) return null

  // 修饰键拼接（顺序无关，parseAccelerator 按段解析）
  const parts: string[] = []
  const isMac = isMacPlatform()
  // 统一存 CmdOrCtrl（渲染层匹配时平台自适应），避免 Windows 存 Ctrl、mac 存 Cmd 的分裂
  const hasCtrlOrCmd = isMac ? e.metaKey : e.ctrlKey
  const hasOtherCtrl = isMac ? e.ctrlKey : e.metaKey

  if (hasOtherCtrl) parts.push(isMac ? 'Ctrl' : 'Meta')
  if (hasCtrlOrCmd) parts.push('CmdOrCtrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  // 主键存储：parseAccelerator 归一化后比较（大小写无关），
  // 此处仅保证存储串可读（Enter / F11 / Escape 等首字母大写）
  const storageKey = mainKey.length === 1
    ? mainKey.toUpperCase()
    : mainKey.charAt(0).toUpperCase() + mainKey.slice(1)

  parts.push(storageKey)
  return parts.join('+')
}

/** 特殊键显示名（accelerator 存储格式 → UI 展示） */
const SPECIAL_KEY_DISPLAY: Record<string, string> = {
  enter: 'Enter',
  escape: 'Escape',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
  '=': 'Plus',
  '-': '-',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '[': 'BracketLeft',
  ']': 'BracketRight'
}

/** accelerator 存储串 → UI 展示串（Ctrl+Comma → Ctrl+,） */
export function formatBindingForDisplay(binding: HotkeyBinding): string {
  if (!binding) return '未绑定'
  return binding
    .split('+')
    .map((p) => {
      const lower = p.toLowerCase()
      if (lower === 'cmdorctrl') return isMacPlatform() ? '⌘' : 'Ctrl'
      if (lower === 'cmd') return '⌘'
      if (lower === 'ctrl') return isMacPlatform() ? '⌃' : 'Ctrl'
      if (lower === 'alt') return isMacPlatform() ? '⌥' : 'Alt'
      if (lower === 'shift') return isMacPlatform() ? '⇧' : 'Shift'
      if (lower === 'meta') return '⌘'
      if (SPECIAL_KEY_DISPLAY[lower]) return SPECIAL_KEY_DISPLAY[lower]
      return p.length === 1 ? p.toUpperCase() : p
    })
    .join(isMacPlatform() ? '' : '+')
}
