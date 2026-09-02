// ============================================================
// hotkey-protocol — 快捷键协议类型（渲染端 / 主进程共享）
// 设计约束（修订版方案）：
//   1. electron-store 为主进程唯一持久化真源；渲染端 zustand 仅缓存。
//   2. handledInComponent=true 的命令由组件内部匹配（如 InputArea 的 Enter），
//      全局 keydown 引擎必须跳过，防止双触发。
//   3. OS 标准编辑键（undo/redo/copy…）readOnly 只做展示，不可改绑。
//   4. 绑定串使用 Electron accelerator 语法（Ctrl/Shift/Alt/CmdOrCtrl + 主键）。
// ============================================================

/** 快捷键绑定：Electron accelerator 串；null = 未绑定（禁用） */
export type HotkeyBinding = string | null

/** 用户覆盖表：只存与默认不同的项；空对象 = 全默认 */
export type HotkeyOverrides = Record<string, HotkeyBinding>

/** 命令稳定 id（改 UI 文案不改 id） */
export type HotkeyId =
  // 应用命令（renderer 引擎处理）
  | 'open-settings'
  | 'toggle-record'
  | 'chat-search'
  | 'new-chat'
  | 'stop-generate'
  | 'toggle-left-sidebar'
  | 'toggle-right-panel'
  | 'toggle-fullscreen'
  | 'zoom-in-content'
  | 'zoom-out-content'
  | 'zoom-reset-content'
  // 组件内命令（handledInComponent，引擎跳过）
  | 'send-message'
  | 'newline-on-input'
  // 全局命令（主进程 globalShortcut，跨窗口）
  | 'toggle-main-window'

export interface HotkeyDefinition {
  id: HotkeyId
  /** UI「命令」列文字 */
  label: string
  /** renderer = 渲染端 keydown 引擎；global = 主进程 globalShortcut */
  scope: 'renderer' | 'global'
  /** 是否允许清空绑定（禁用） */
  allowEmpty: boolean
  /** 只读（OS 标准编辑键等，仅展示不可改绑） */
  readOnly?: boolean
  /** 由组件内部自行匹配（引擎必须跳过，防双触发） */
  handledInComponent?: boolean
  /** 默认绑定 */
  defaultBinding: HotkeyBinding
  /** 搜索关键字（label 之外的可命中词） */
  keywords?: string[]
}

// ---- IPC 载荷 ----

export interface HotkeyApplyResult {
  ok: boolean
  /** 应用后实际生效的覆盖表（回传渲染端缓存） */
  overrides: HotkeyOverrides
  /** 注册失败的全局快捷键（系统占用等），渲染端黄条提示 */
  conflicts: string[]
  error?: string
}
