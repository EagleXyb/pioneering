// ============================================================
// hotkey-registry — 快捷键命令注册表（默认绑定单一数据源）
// 首版范围（修订版方案）：15 条可配置命令 + OS 编辑键只读展示。
// 注意：menu-template.ts 中 macOS 原生菜单的 accelerator 仍保留静态值
// （OS 编辑键全部只读，无需动态化；quit/closeWindow/devTools 为
// 平台惯例键，也不开放改绑）。
// ============================================================

import type { HotkeyDefinition, HotkeyId, HotkeyBinding, HotkeyOverrides } from './hotkey-protocol'

export const HOTKEY_DEFINITIONS: HotkeyDefinition[] = [
  // ---- 应用命令（renderer 引擎）----
  {
    id: 'open-settings',
    label: '打开设置',
    scope: 'renderer',
    allowEmpty: false,
    defaultBinding: 'Ctrl+Comma',
    keywords: ['settings', '设置', '偏好']
  },
  {
    id: 'toggle-record',
    label: '语音录制开关',
    scope: 'renderer',
    allowEmpty: true,
    defaultBinding: 'Ctrl+D',
    keywords: ['record', '录音', '语音', '转录']
  },
  {
    id: 'chat-search',
    label: '对话内搜索',
    scope: 'renderer',
    allowEmpty: true,
    defaultBinding: 'Ctrl+F',
    keywords: ['search', '搜索', '查找']
  },
  {
    id: 'new-chat',
    label: '新建对话',
    scope: 'renderer',
    allowEmpty: true,
    defaultBinding: 'Ctrl+N',
    keywords: ['new', '新建', '新会话']
  },
  {
    id: 'stop-generate',
    label: '停止生成',
    scope: 'renderer',
    allowEmpty: true,
    defaultBinding: 'Escape',
    keywords: ['stop', '停止', '取消', 'abort']
  },
  {
    id: 'toggle-left-sidebar',
    label: '切换左侧栏',
    scope: 'renderer',
    allowEmpty: true,
    defaultBinding: 'Ctrl+Shift+S',
    keywords: ['sidebar', '侧边栏', '左侧']
  },
  {
    id: 'toggle-right-panel',
    label: '切换右侧产物面板',
    scope: 'renderer',
    allowEmpty: true,
    defaultBinding: 'Ctrl+B',
    keywords: ['panel', '面板', '右侧', '产物']
  },
  {
    id: 'toggle-fullscreen',
    label: '进入/退出全屏',
    scope: 'renderer',
    allowEmpty: true,
    defaultBinding: 'F11',
    keywords: ['fullscreen', '全屏']
  },
  {
    id: 'zoom-in-content',
    label: '放大内容字号',
    scope: 'renderer',
    allowEmpty: true,
    defaultBinding: 'Ctrl+=',
    keywords: ['zoom', '放大', '字号']
  },
  {
    id: 'zoom-out-content',
    label: '缩小内容字号',
    scope: 'renderer',
    allowEmpty: true,
    defaultBinding: 'Ctrl+-',
    keywords: ['zoom', '缩小', '字号']
  },
  {
    id: 'zoom-reset-content',
    label: '恢复默认字号',
    scope: 'renderer',
    allowEmpty: true,
    defaultBinding: 'Ctrl+0',
    keywords: ['zoom', '恢复', '字号']
  },

  // ---- 组件内命令（引擎跳过，InputArea 自行匹配）----
  {
    id: 'send-message',
    label: '发送消息',
    scope: 'renderer',
    allowEmpty: false,
    handledInComponent: true,
    defaultBinding: 'Enter',
    keywords: ['send', '发送']
  },
  {
    id: 'newline-on-input',
    label: '输入时换行',
    scope: 'renderer',
    allowEmpty: false,
    handledInComponent: true,
    defaultBinding: 'Shift+Enter',
    keywords: ['newline', '换行']
  },

  // ---- 全局命令（主进程 globalShortcut，窗口无焦点也生效）----
  {
    id: 'toggle-main-window',
    label: '唤起/隐藏主窗口',
    scope: 'global',
    allowEmpty: true,
    defaultBinding: 'Shift+Alt+W',
    keywords: ['window', '窗口', '唤起', '显示隐藏']
  }
]

/** 按 id 取定义 */
export function getHotkeyDefinition(id: HotkeyId): HotkeyDefinition | undefined {
  return HOTKEY_DEFINITIONS.find((d) => d.id === id)
}

/** 解析实际生效绑定：override 优先，其次默认 */
export function resolveBinding(
  id: HotkeyId,
  overrides: HotkeyOverrides
): HotkeyBinding {
  const def = getHotkeyDefinition(id)
  if (!def) return null
  const v = overrides[id]
  // undefined = 未覆盖（用默认）；null = 显式禁用
  return v === undefined ? def.defaultBinding : v
}

/**
 * 找出与 targetBinding 冲突的其它命令（忽略 disabled 与 readOnly 展示键）。
 * 用于录制确认前的冲突提示。
 */
export function findConflicts(
  targetId: HotkeyId,
  targetBinding: HotkeyBinding,
  overrides: HotkeyOverrides
): HotkeyId[] {
  if (!targetBinding) return []
  const normalized = targetBinding.toLowerCase().replace(/\s+/g, '')
  const hits: HotkeyId[] = []
  for (const def of HOTKEY_DEFINITIONS) {
    if (def.id === targetId || def.readOnly) continue
    const b = resolveBinding(def.id, overrides)
    if (!b) continue
    if (b.toLowerCase().replace(/\s+/g, '') === normalized) hits.push(def.id)
  }
  return hits
}

/**
 * 危险键位黑名单：这些组合有浏览器/Electron 原生行为，
 * 改绑到其它命令会造成误关窗口 / 刷新丢状态等问题，需二次确认。
 */
export const DANGEROUS_BINDINGS: string[] = [
  'ctrl+w',
  'ctrl+r',
  'ctrl+t',
  'ctrl+shift+i',
  'f12',
  'f5',
  'ctrl+q'
]

export function isDangerousBinding(binding: HotkeyBinding): boolean {
  if (!binding) return false
  return DANGEROUS_BINDINGS.includes(binding.toLowerCase().replace(/\s+/g, ''))
}
