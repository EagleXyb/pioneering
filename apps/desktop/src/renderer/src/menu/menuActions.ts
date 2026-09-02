// ============================================================
// menuActions — 把 MenuActionId 映射到渲染端处理函数
// 替换原 TitleBar 里散落的 handleAbout/handleQuit/handleOpenDocs...
// 不在 React 组件内调用，使用 jotai 的默认 store 直接派发，便于菜单/快捷键复用。
// macOS 的 undo/redo/cut/copy/paste/selectAll 由原生菜单自动处理，
// 这里仅在 Windows/Linux 的 HTML 菜单下被调用（仍用 document.execCommand 兜底）。
// ============================================================

import { getDefaultStore } from 'jotai'
import { settingsOpenAtom } from '@/stores/atoms'
import { appApi, windowApi, shellApi } from '@/services/ipc'
import { DOCS_URL, FEEDBACK_URL } from '@shared/links'
import type { MenuActionId } from '@shared/menu-template'

export function runMenuAction(id: MenuActionId): void {
  const store = getDefaultStore()
  switch (id) {
    case 'about':
      store.set(settingsOpenAtom, true)
      break
    case 'checkUpdate':
      void appApi.checkUpdate()
      break
    case 'quit':
      void appApi.quit()
      break
    case 'undo':
      document.execCommand('undo')
      break
    case 'redo':
      document.execCommand('redo')
      break
    case 'cut':
      document.execCommand('cut')
      break
    case 'copy':
      document.execCommand('copy')
      break
    case 'paste':
      document.execCommand('paste')
      break
    case 'selectAll':
      document.execCommand('selectAll')
      break
    case 'closeWindow':
      void windowApi.close()
      break
    case 'openDocs':
      void shellApi.openExternal(DOCS_URL)
      break
    case 'networkCheck':
      void appApi.networkCheck()
      break
    case 'openLogDir':
      void appApi.openLogDir()
      break
    case 'feedback':
      void shellApi.openExternal(FEEDBACK_URL)
      break
    case 'devTools':
      void windowApi.toggleDevTools()
      break
  }
}
