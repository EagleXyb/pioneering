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

// 基础路径安全检查：非空、长度受限、禁止空字节与 '..' 目录遍历
function isValidFilePath(filePath: string): boolean {
  if (typeof filePath !== 'string' || !filePath || filePath.length > 4096) return false
  if (filePath.includes('\0')) return false
  return !filePath.split(/[\\/]/).includes('..')
}

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

  ipcMain.handle(IpcChannel.WINDOW_TOGGLE_DEVTOOLS, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.webContents.toggleDevTools()
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

  // 检查更新：当前未接入自动更新器，仅回传版本号供 UI 提示
  ipcMain.handle(IpcChannel.APP_CHECK_UPDATE, () => {
    return app.getVersion()
  })

  // 网络检测：探测后端可达性（5s 超时）
  ipcMain.handle(IpcChannel.APP_NETWORK_CHECK, async () => {
    const base = process.env['VITE_API_BASE_URL'] ?? 'http://localhost:9000'
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const res = await fetch(`${base}/ping`, { signal: controller.signal })
      return res.ok
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  })

  // 打开日志目录
  ipcMain.handle(IpcChannel.APP_OPEN_LOG_DIR, () => {
    return shell.openPath(app.getPath('logs'))
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
      if (!isValidFilePath(filePath)) {
        return { success: false, error: 'Invalid file path' }
      }
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
      if (!isValidFilePath(req.filePath) || typeof req.content !== 'string') {
        return { success: false, error: 'Invalid file path or content' }
      }
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
    // 仅允许 http/https，避免 file:// 等危险协议
    if (!/^https?:\/\//i.test(url)) return
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
    dragState = { offsetX: data.screenX - (winX ?? 0), offsetY: data.screenY - (winY ?? 0) }
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
