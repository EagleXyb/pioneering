import { useEffect, useCallback, useRef } from 'react'
import { useSetAtom } from 'jotai'
import { contextPanelVisibleAtom } from '../stores/atoms'

// 统一的键盘快捷键监听器：合并原分散在 RootLayout（⌘B/⌘K）与
// ConversationList（⌘N）的多个 window keydown 监听，集中管理。
// 输入框/可编辑区聚焦时不拦截，避免吞掉正常输入（如聊天框里的 j/k）。
export function useKeyboardShortcuts(onNewTask?: () => void | Promise<void>) {
  const setContextPanelVisible = useSetAtom(contextPanelVisibleAtom)
  const newTaskRef = useRef(onNewTask)
  newTaskRef.current = onNewTask

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const isModifier = e.metaKey || e.ctrlKey
      if (!isModifier) return

      // 输入框聚焦时不拦截，避免吞掉编辑态快捷键
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return

      switch (e.key.toLowerCase()) {
        case 'b':
          e.preventDefault()
          setContextPanelVisible((prev) => !prev)
          break
        case 'k':
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('global-search'))
          break
        case 'n':
          e.preventDefault()
          void newTaskRef.current?.()
          break
      }
    },
    [setContextPanelVisible]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
