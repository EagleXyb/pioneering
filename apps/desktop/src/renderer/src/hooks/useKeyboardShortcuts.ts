import { useEffect, useCallback } from 'react'
import { useAppStore, type SidebarTab } from '../stores/useAppStore'

interface ShortcutMap {
  key: string
  ctrl?: boolean
  meta?: boolean
  action: () => void
}

export function useKeyboardShortcuts() {
  const {
    toggleSidebar,
    toggleChatPanel,
    toggleBottomPanel,
    setActiveSidebarTab
  } = useAppStore()

  const shortcuts: ShortcutMap[] = [
    { key: 'b', meta: true, action: toggleChatPanel },
    { key: 'j', meta: true, action: toggleBottomPanel },
    { key: '1', meta: true, action: () => setActiveSidebarTab('files' as SidebarTab) },
    { key: '2', meta: true, action: () => setActiveSidebarTab('search' as SidebarTab) },
    { key: '3', meta: true, action: () => setActiveSidebarTab('git' as SidebarTab) },
    { key: '4', meta: true, action: () => setActiveSidebarTab('tools' as SidebarTab) },
    { key: '5', meta: true, action: () => setActiveSidebarTab('skills' as SidebarTab) },
    { key: '6', meta: true, action: () => setActiveSidebarTab('history' as SidebarTab) }
  ]

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        const meta = shortcut.meta && (e.metaKey || e.ctrlKey)
        const ctrl = shortcut.ctrl && e.ctrlKey
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase()

        if (keyMatch && (meta || ctrl || (!shortcut.meta && !shortcut.ctrl))) {
          e.preventDefault()
          shortcut.action()
          return
        }
      }
    },
    [shortcuts]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
