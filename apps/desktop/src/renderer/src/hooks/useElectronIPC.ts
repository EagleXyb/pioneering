import { useEffect } from 'react'

export function useElectronIPC() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ⌘K 或 Ctrl+K → 聚焦搜索
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        // 触发全局搜索（由具体组件绑定）
        window.dispatchEvent(new CustomEvent('global-search'))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const windowControl = async (action: 'minimize' | 'maximize' | 'close') => {
    try {
      await window.electron?.ipcRenderer?.invoke('window:control', action)
    } catch {
      // Electron IPC not available
    }
  }

  return { windowControl }
}
