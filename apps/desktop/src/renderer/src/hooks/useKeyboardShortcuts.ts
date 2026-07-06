import { useEffect, useCallback } from 'react'
import { useSetAtom } from 'jotai'
import { sidebarTabAtom, contextPanelVisibleAtom, sidebarVisibleAtom } from '../stores/atoms'

export function useKeyboardShortcuts() {
  const setSidebarTab = useSetAtom(sidebarTabAtom)
  const setContextPanelVisible = useSetAtom(contextPanelVisibleAtom)
  const setSidebarVisible = useSetAtom(sidebarVisibleAtom)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const isModifier = e.metaKey || e.ctrlKey
      if (!isModifier) return

      switch (e.key.toLowerCase()) {
        case 'b':
          e.preventDefault()
          setContextPanelVisible((prev) => !prev)
          break
        case 'j':
          e.preventDefault()
          // Toggle bottom panel removed in three-column layout
          break
        case 'k':
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('global-search'))
          break
        case '1':
          e.preventDefault()
          setSidebarTab('conversations')
          setSidebarVisible(true)
          break
        case '2':
          e.preventDefault()
          setSidebarTab('files')
          setSidebarVisible(true)
          break
        case '3':
          e.preventDefault()
          setSidebarTab('tools')
          setSidebarVisible(true)
          break
        case '4':
          e.preventDefault()
          setSidebarTab('skills')
          setSidebarVisible(true)
          break
        case '5':
          e.preventDefault()
          setSidebarTab('history')
          setSidebarVisible(true)
          break
      }
    },
    [setSidebarTab, setContextPanelVisible, setSidebarVisible]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
