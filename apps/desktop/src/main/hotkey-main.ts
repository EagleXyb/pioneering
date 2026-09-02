// ============================================================
// hotkey-main — 主进程快捷键治理
//   1. electron-store 为唯一持久化真源（key: 'hotkeys'）
//   2. scope=global 的命令经 globalShortcut 注册（跨窗口，无焦点也生效）
//   3. 注册失败（系统占用）→ conflicts 上报渲染端黄条提示
//   4. 幂等：重注册前 unregisterAll，杜绝 crash 残留的陈旧注册
// ============================================================

import { globalShortcut, BrowserWindow, type App } from 'electron'
import Store from 'electron-store'
import { HOTKEY_DEFINITIONS, resolveBinding } from '../shared/hotkey-registry'
import type { HotkeyOverrides, HotkeyApplyResult } from '../shared/hotkey-protocol'

const HOTKEYS_STORE_KEY = 'hotkeys'

export class HotkeyManager {
  private store: Store
  private conflicts: string[] = []
  /** toggle-main-window 动作回调（由 ipc-handlers 注入：聚焦/显示主窗口） */
  private onMainWindowToggle: (() => void) | null = null

  constructor(store: Store) {
    this.store = store
  }

  setMainWindowToggleHandler(handler: () => void): void {
    this.onMainWindowToggle = handler
  }

  /** 读取持久化覆盖表（SOT） */
  getOverrides(): HotkeyOverrides {
    const raw = this.store.get(HOTKEYS_STORE_KEY)
    if (!raw || typeof raw !== 'object') return {}
    const result: HotkeyOverrides = {}
    const entries = raw as Record<string, unknown>
    for (const k of Object.keys(entries)) {
      const v: unknown = entries[k]
      if (typeof v === 'string') result[k] = v
      else if (v === null) result[k] = null
    }
    return result
  }

  private saveOverrides(overrides: HotkeyOverrides): void {
    this.store.set(HOTKEYS_STORE_KEY, overrides)
  }

  /**
   * 应用新覆盖表：持久化 → 重注册全局快捷键。
   * 全量覆盖语义（渲染端总是提交完整 overrides，简单且无合并歧义）。
   */
  applyOverrides(overrides: HotkeyOverrides): HotkeyApplyResult {
    // 清洗：只接受定义内 id + 合法绑定值
    const clean: HotkeyOverrides = {}
    const ids = new Set<string>(HOTKEY_DEFINITIONS.map((d) => d.id))
    for (const [k, v] of Object.entries(overrides)) {
      if (!ids.has(k)) continue
      if (v === null || typeof v === 'string') clean[k] = v
    }
    this.saveOverrides(clean)
    this.registerGlobalShortcuts(clean)
    return { ok: true, overrides: clean, conflicts: [...this.conflicts] }
  }

  /** 恢复全部默认：清空覆盖表 + 重注册 */
  resetAll(): HotkeyApplyResult {
    this.saveOverrides({})
    this.registerGlobalShortcuts({})
    return { ok: true, overrides: {}, conflicts: [...this.conflicts] }
  }

  /**
   * 重注册全局快捷键（幂等）：
   * unregisterAll → 逐条注册 scope=global 命令 → 失败记入 conflicts。
   */
  registerGlobalShortcuts(overrides: HotkeyOverrides): void {
    globalShortcut.unregisterAll()
    this.conflicts = []

    for (const def of HOTKEY_DEFINITIONS) {
      if (def.scope !== 'global') continue
      const binding = resolveBinding(def.id, overrides)
      if (!binding) continue // 显式禁用

      // 探测陈旧注册（主进程 crash 残留）并清掉，保证幂等
      if (globalShortcut.isRegistered(binding)) {
        globalShortcut.unregister(binding)
      }

      const ok = globalShortcut.register(binding, () => {
        this.handleGlobalAction(def.id)
      })
      if (!ok) {
        this.conflicts.push(`${def.label}（${binding}）已被系统或其它应用占用`)
      }
    }
  }

  private handleGlobalAction(id: string): void {
    switch (id) {
      case 'toggle-main-window': {
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
        if (!win) return
        if (win.isVisible() && win.isFocused()) {
          win.hide()
        } else {
          if (!win.isVisible()) win.show()
          win.focus()
        }
        break
      }
      default:
        break
    }
  }

  /** 应用退出时注销全部全局快捷键（正常退出路径；crash 由 OS 回收） */
  cleanup(): void {
    globalShortcut.unregisterAll()
  }
}

/** 模块级单例（与 agent-runtime / key-store 同模式） */
let manager: HotkeyManager | null = null

export function getHotkeyManager(store: Store): HotkeyManager {
  if (!manager) manager = new HotkeyManager(store)
  return manager
}

/** app 生命周期挂载：启动注册 + 退出清理 */
export function bootstrapHotkeys(app: App, store: Store): HotkeyManager {
  const mgr = getHotkeyManager(store)
  mgr.registerGlobalShortcuts(mgr.getOverrides())
  app.on('will-quit', () => mgr.cleanup())
  return mgr
}
