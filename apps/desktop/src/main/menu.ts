// ============================================================
// menu — macOS 全局菜单（屏幕顶部，窗口外）
// 复用 shared/menu-template 同一份数据，仅一行平台分支挂在 darwin 上。
// 编辑类动作（undo/redo/cut/copy/paste/selectAll）用 Electron 原生 role，
// 由系统自动绑定页面编辑行为，无需手写 document.execCommand。
// ============================================================

import { Menu, BrowserWindow, app, shell, type MenuItemConstructorOptions } from 'electron'
import { menuTemplate, type MenuActionId } from '../shared/menu-template'
import { IpcChannel } from '../shared/ipc-channels'
import { DOCS_URL, FEEDBACK_URL } from '../shared/links'

// id -> Electron 原生 role（macOS 编辑菜单由系统自动处理，解决 execCommand 废弃问题）
const EDIT_ROLES: Partial<Record<MenuActionId, MenuItemConstructorOptions['role']>> = {
  undo: 'undo',
  redo: 'redo',
  cut: 'cut',
  copy: 'copy',
  paste: 'paste',
  selectAll: 'selectAll'
}

function runAction(id: MenuActionId, win: BrowserWindow | null): void {
  // B4 修复：原实现 `win ?? BrowserWindow.getFocusedWindow()` 在 win 非 null 时
  // 直接使用 win，但 mac 从 dock 重新激活会重建窗口，闭包持有的 win 已销毁，
  // `target.webContents.send` 在已销毁 webContents 上抛错。
  // 改为先检查 win 是否已销毁，已销毁则回退到当前聚焦窗口。
  const target =
    win && !win.isDestroyed()
      ? win
      : (BrowserWindow.getFocusedWindow() ?? null)
  switch (id) {
    case 'about':
      // 需要渲染端配合打开设置弹框，经 MENU_ACTION 通知
      target?.webContents.send(IpcChannel.MENU_ACTION, 'about')
      break
    case 'quit':
      app.quit()
      break
    case 'devTools':
      target?.webContents.toggleDevTools()
      break
    case 'openDocs':
      void shell.openExternal(DOCS_URL)
      break
    case 'feedback':
      void shell.openExternal(FEEDBACK_URL)
      break
    default:
      // 其余（checkUpdate/networkCheck/openLogDir/closeWindow）交由渲染端处理
      target?.webContents.send(IpcChannel.MENU_ACTION, id)
      break
  }
}

export function buildAppMenu(win: BrowserWindow | null): Menu {
  const template: MenuItemConstructorOptions[] = menuTemplate
    .filter((t) => !t.platform || t.platform === 'mac')
    .map((t) => ({
      label: t.label,
      submenu: t.submenu?.map((s) => {
        if (s.separator) {
          return { type: 'separator' } as MenuItemConstructorOptions
        }
        const role = s.id ? EDIT_ROLES[s.id] : undefined
        if (role) {
          return { label: s.label, role } as MenuItemConstructorOptions
        }
        return {
          label: s.label,
          accelerator: s.accelerator,
          click: () => runAction(s.id as MenuActionId, win)
        } as MenuItemConstructorOptions
      })
    }))

  return Menu.buildFromTemplate(template)
}
