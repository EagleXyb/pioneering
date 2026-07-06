// ============================================================
// Main Process IPC Handlers
// 在主进程中注册所有 IPC 通道的处理器
// ============================================================

import {
  ipcMain,
  BrowserWindow,
  app,
  dialog,
  clipboard,
  shell,
  Notification,
  type SaveDialogOptions,
  type OpenDialogOptions
} from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { IpcChannel } from '../shared/ipc-channels'
import type {
  FileDialogOptions,
  FileDialogResult,
  FileReadResult,
  FileWriteRequest,
  NotificationOptions,
  UserDataPath
} from '../shared/ipc-channels'

// 简单的内存 Store（可替换为 electron-store）
const appStore = new Map<string, unknown>()

export function registerIpcHandlers(): void {
  // ---- 窗口控制 ----
  ipcMain.handle(IpcChannel.WINDOW_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle(IpcChannel.WINDOW_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.handle(IpcChannel.WINDOW_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle(IpcChannel.WINDOW_IS_MAXIMIZED, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  ipcMain.handle(IpcChannel.WINDOW_TOGGLE_FULLSCREEN, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.setFullScreen(!win.isFullScreen())
    }
  })

  // ---- 应用信息 ----
  ipcMain.handle(IpcChannel.APP_GET_VERSION, () => {
    return app.getVersion()
  })

  ipcMain.handle(IpcChannel.APP_GET_PLATFORM, () => {
    return process.platform
  })

  ipcMain.handle(IpcChannel.APP_QUIT, () => {
    app.quit()
  })

  // ---- 文件系统 ----
  ipcMain.handle(
    IpcChannel.FILE_OPEN_DIALOG,
    async (event, options: FileDialogOptions): Promise<FileDialogResult> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { canceled: true, filePaths: [] }

      const dialogOptions: OpenDialogOptions = {
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters,
        properties: options.properties as OpenDialogOptions['properties']
      }
      return await dialog.showOpenDialog(win, dialogOptions)
    }
  )

  ipcMain.handle(
    IpcChannel.FILE_SAVE_DIALOG,
    async (event, options: FileDialogOptions): Promise<FileDialogResult> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { canceled: true, filePaths: [] }

      const dialogOptions: SaveDialogOptions = {
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters
      }
      const result = await dialog.showSaveDialog(win, dialogOptions)
      return {
        canceled: result.canceled,
        filePaths: result.filePath ? [result.filePath] : []
      }
    }
  )

  ipcMain.handle(
    IpcChannel.FILE_READ,
    async (_event, filePath: string): Promise<FileReadResult> => {
      try {
        const content = await readFile(filePath, 'utf-8')
        return { success: true, content }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    }
  )

  ipcMain.handle(
    IpcChannel.FILE_WRITE,
    async (_event, req: FileWriteRequest): Promise<FileReadResult> => {
      try {
        await writeFile(req.filePath, req.content, req.encoding ?? 'utf-8')
        return { success: true }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    }
  )

  ipcMain.handle(IpcChannel.FILE_GET_PATH, (_event, name: UserDataPath) => {
    return app.getPath(name)
  })

  // ---- 通知 ----
  ipcMain.handle(IpcChannel.NOTIFICATION_SHOW, (_event, options: NotificationOptions) => {
    if (Notification.isSupported()) {
      const notif = new Notification({
        title: options.title,
        body: options.body,
        urgency: options.urgency as 'normal' | 'critical' | 'low'
      })
      notif.show()
    }
  })

  // ---- 剪贴板 ----
  ipcMain.handle(IpcChannel.CLIPBOARD_WRITE, (_event, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.handle(IpcChannel.CLIPBOARD_READ, () => {
    return clipboard.readText()
  })

  // ---- 外部链接 ----
  ipcMain.handle(IpcChannel.SHELL_OPEN_EXTERNAL, (_event, url: string) => {
    return shell.openExternal(url)
  })

  // ---- Store 持久化 ----
  ipcMain.handle(IpcChannel.STORE_GET, (_event, key: string) => {
    return appStore.get(key)
  })

  ipcMain.handle(
    IpcChannel.STORE_SET,
    (_event, key: string, value: unknown) => {
      appStore.set(key, value)
      return true
    }
  )

  ipcMain.handle(IpcChannel.STORE_DELETE, (_event, key: string) => {
    appStore.delete(key)
    return true
  })

  // ---- 健康检查 ----
  ipcMain.handle(IpcChannel.PING, () => 'pong')

  // ---- 窗口拖拽 ----
  // 使用 fire-and-forget send/on 模式，避免 invoke 的往返延迟
  let dragState: { offsetX: number; offsetY: number } | null = null
  let dragTarget: BrowserWindow | null = null

  ipcMain.on(IpcChannel.WINDOW_DRAG_START, (event, data: { screenX: number; screenY: number }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const [winX, winY] = win.getPosition()
    dragTarget = win
    dragState = { offsetX: data.screenX - winX, offsetY: data.screenY - winY }
  })

  ipcMain.on(IpcChannel.WINDOW_DRAG_MOVE, (event, data: { screenX: number; screenY: number }) => {
    if (!dragTarget || !dragState) return
    dragTarget.setPosition(
      Math.round(data.screenX - dragState.offsetX),
      Math.round(data.screenY - dragState.offsetY)
    )
  })

  ipcMain.on(IpcChannel.WINDOW_DRAG_END, () => {
    dragTarget = null
    dragState = null
  })
}
