// ============================================================
// useHotkeyEngine — 统一快捷键引擎（M2）
//   取代 useKeyboardShortcuts 的硬编码 switch：
//   1. 读 appStore.hotkeys（主进程 SOT 的缓存），逐条匹配 HOTKEY_DEFINITIONS
//   2. 跳过 handledInComponent 命令（InputArea 自行匹配，防双触发）
//   3. 跳过 scope=global 命令（主进程 globalShortcut 处理）
//   4. 仅当动作真实存在才 preventDefault：
//      - 组件已消费的事件（e.defaultPrevented，如 slash 菜单的 Esc）直接跳过
//      - 无动作的绑定（录音/搜索等 UI 未落地）不吞键，保证零回归
//   5. 输入框聚焦时放行（保护编辑态；原 useKeyboardShortcuts 语义）
// ============================================================

import { useEffect, useCallback, useRef } from 'react'
import { useSetAtom } from 'jotai'
import {
  contextPanelVisibleAtom,
  sidebarVisibleAtom,
  settingsOpenAtom,
  settingsCategoryAtom
} from '../stores/atoms'
import { useAppStore } from '../stores/useAppStore'
import { HOTKEY_DEFINITIONS, resolveBinding } from '../../../shared/hotkey-registry'
import type { HotkeyId } from '../../../shared/hotkey-protocol'
import { matchesAccelerator } from '../lib/match-accelerator'

/** 动作注册表：hotkeyId → 执行函数（集中管理，替代散点 keydown） */
export type HotkeyActionMap = Partial<Record<HotkeyId, () => void>>

export function useHotkeyEngine(extraActions?: HotkeyActionMap) {
  const hotkeys = useAppStore((s) => s.hotkeys)
  const setContextPanelVisible = useSetAtom(contextPanelVisibleAtom)
  const setSidebarVisible = useSetAtom(sidebarVisibleAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsCategory = useSetAtom(settingsCategoryAtom)

  // extraActions 可能每次渲染都是新对象（inline 回调），用 ref 防监听器重建
  const extraRef = useRef(extraActions)
  extraRef.current = extraActions

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // 组件级处理器（Drawer Esc / slash 菜单方向键等）先于 window 冒泡执行，
      // 已消费的事件不再进入引擎，杜绝双重处理
      if (e.defaultPrevented) return

      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      const inEditable = tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable
      // 输入框聚焦一律放行（保护编辑态；原 useKeyboardShortcuts 语义）。
      // 裸键命令（Escape / F11）在非编辑焦点下由下方逐条匹配兜底。
      if (inEditable) return

      for (const def of HOTKEY_DEFINITIONS) {
        // 引擎职责边界：组件内命令由 InputArea 匹配；全局命令由主进程处理
        if (def.handledInComponent || def.scope === 'global' || def.readOnly) continue

        const binding = resolveBinding(def.id, hotkeys)
        if (!binding) continue
        if (!matchesAccelerator(e, binding)) continue

        // 解析动作：extra（调用方注入，如新建对话）优先，其次内置分发
        const action = resolveAction(def.id, extraRef.current)
        if (!action) continue // 未落地功能不吞键（零回归原则）

        e.preventDefault()
        action({
          setContextPanelVisible,
          setSidebarVisible,
          setSettingsOpen,
          setSettingsCategory
        })
        return // 命中一条即返回（绑定唯一性由设置页冲突检测保证）
      }
    },
    [hotkeys, setContextPanelVisible, setSidebarVisible, setSettingsOpen, setSettingsCategory]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}

/** 动作分发上下文 */
interface ActionContext {
  setContextPanelVisible: (fn: (prev: boolean) => boolean) => void
  setSidebarVisible: (fn: (prev: boolean) => boolean) => void
  setSettingsOpen: (open: boolean) => void
  setSettingsCategory: (id: string) => void
}

/** 解析命令的实际动作；无动作返回 undefined（引擎不吞键） */
function resolveAction(
  id: HotkeyId,
  extra?: HotkeyActionMap
): ((ctx: ActionContext) => void) | undefined {
  // extra 优先：调用方注入的上下文动作（如 RootLayout 的新建对话）
  const extraAction = extra?.[id]
  if (extraAction) {
    return () => extraAction()
  }

  switch (id) {
    case 'toggle-right-panel':
      return (ctx) => ctx.setContextPanelVisible((prev) => !prev)
    case 'toggle-left-sidebar':
      return (ctx) => ctx.setSidebarVisible((prev) => !prev)
    case 'open-settings':
      return (ctx) => {
        ctx.setSettingsCategory('general')
        ctx.setSettingsOpen(true)
      }
    case 'zoom-in-content':
      return () => {
        const cur = useAppStore.getState().fontSize
        useAppStore.getState().setFontSize(cur === 'small' ? 'medium' : 'large')
      }
    case 'zoom-out-content':
      return () => {
        const cur = useAppStore.getState().fontSize
        useAppStore.getState().setFontSize(cur === 'large' ? 'medium' : 'small')
      }
    case 'zoom-reset-content':
      return () => useAppStore.getState().setFontSize('medium')
    case 'toggle-fullscreen':
      return () => void window.api?.window?.toggleFullscreen?.()
    // toggle-record / chat-search / stop-generate / new-chat（未注入 extra 时）：
    // 对应 UI 尚未落地，返回 undefined —— 引擎不拦截按键，待功能就绪后接入
    default:
      return undefined
  }
}
