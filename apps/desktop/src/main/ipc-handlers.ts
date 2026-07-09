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
import { readFile, writeFile, stat } from 'fs/promises'
import { realpathSync } from 'fs'
import path from 'path'
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

// H2: 经对话框选择、允许读写的用户路径集合（命中即视为白名单成员）。
// 文档要求「用户经对话框选定路径」也应放行，这里在打开/保存对话框返回后记录。
const userAllowedPaths = new Set<string>()

// H3: 文件读写允许的根目录白名单（仅用户数据/常用用户目录，禁止任意绝对路径）。
function getAllowedRoots(): string[] {
  return [
    app.getPath('userData'),
    app.getPath('documents'),
    app.getPath('downloads'),
    app.getPath('desktop'),
    app.getPath('pictures'),
    app.getPath('music'),
    app.getPath('videos'),
    app.getPath('temp')
  ]
}

// H3: 文件读取/写入的最大字节数（10MB），防止超大文件占满内存（P1）。
const MAX_FILE_BYTES = 10 * 1024 * 1024

// 基础路径安全检查：非空、长度受限、禁止空字节与 '..' 目录遍历
function isValidFilePath(filePath: string): boolean {
  if (typeof filePath !== 'string' || !filePath || filePath.length > 4096) return false
  if (filePath.includes('\0')) return false
  return !filePath.split(/[\\/]/).includes('..')
}

// H2: 校验 IPC 调用方是否为可信任的渲染上下文。
// 仅允许来自本地 file://（生产 loadFile）、app://（自定义协议）或
// localhost 开发服务器的 frame 发起的调用；其余（如被注入的远程 frame）一律拒绝。
function isTrustedSender(
  event: { senderFrame?: Electron.WebFrameMain | null }
): boolean {
  const frame = event.senderFrame
  if (!frame) return false
  const url = frame.url
  return (
    /^file:\/\//i.test(url) ||
    /^app:\/\//i.test(url) ||
    /^https?:\/\/localhost(:\d+)?\b/i.test(url)
  )
}

// H3: 路径白名单校验。先 path.resolve 归一化，再用 realpathSync 解析符号链接
// （防止通过软链逃逸白名单），最后判断是否落在允许根目录内或命中用户选定路径。
function isPathAllowed(filePath: string, allowedRoots: string[]): boolean {
  let resolved: string
  try {
    resolved = path.resolve(filePath)
  } catch {
    return false
  }
  try {
    resolved = realpathSync(resolved)
  } catch {
    // 文件尚不存在（写操作）或无法解析时，回退到未解析路径做前缀校验
  }
  const rawResolved = path.resolve(filePath)
  if (userAllowedPaths.has(resolved) || userAllowedPaths.has(rawResolved)) return true
  return allowedRoots.some((root) => {
    const r = path.resolve(root)
    return resolved === r || resolved.startsWith(r + path.sep)
  })
}

// H6: 通过 JSON 往返重建纯对象，剥离 __proto__ / constructor 等原型链污染载体。
// 渲染端传入的任意对象经结构化克隆存入 Map 前先净化，杜绝原型链污染。
function sanitizeValue(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}

// E1: 归一化文件操作错误，避免把 ErrnoException 的完整信息（含绝对路径、
// 权限细节）回传给渲染端并展示，造成信息泄露。仅映射常见错误码，其余给通用文案。
function normalizeFileError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code
  switch (code) {
    case 'ENOENT':
      return '文件不存在'
    case 'EACCES':
    case 'EPERM':
      return '没有访问权限'
    case 'EISDIR':
      return '目标是一个目录，不是文件'
    case 'ENOTDIR':
      return '路径中的某一段不是目录'
    case 'EMFILE':
    case 'ENFILE':
      return '系统打开文件数过多，请稍后重试'
    default:
      return '文件读写失败'
  }
}

export function registerIpcHandlers(): void {
  const allowedRoots = getAllowedRoots()

  // ---- 窗口控制 ----
  ipcMain.handle(IpcChannel.WINDOW_MINIMIZE, (event) => {
    if (!isTrustedSender(event)) return
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle(IpcChannel.WINDOW_MAXIMIZE, (event) => {
    if (!isTrustedSender(event)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.handle(IpcChannel.WINDOW_CLOSE, (event) => {
    if (!isTrustedSender(event)) return
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle(IpcChannel.WINDOW_IS_MAXIMIZED, (event) => {
    if (!isTrustedSender(event)) return false
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  ipcMain.handle(IpcChannel.WINDOW_TOGGLE_FULLSCREEN, (event) => {
    if (!isTrustedSender(event)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.setFullScreen(!win.isFullScreen())
    }
  })

  ipcMain.handle(IpcChannel.WINDOW_TOGGLE_DEVTOOLS, (event) => {
    if (!isTrustedSender(event)) return
    BrowserWindow.fromWebContents(event.sender)?.webContents.toggleDevTools()
  })

  // ---- 应用信息 ----
  ipcMain.handle(IpcChannel.APP_GET_VERSION, (event) => {
    if (!isTrustedSender(event)) return ''
    return app.getVersion()
  })

  ipcMain.handle(IpcChannel.APP_GET_PLATFORM, (event) => {
    if (!isTrustedSender(event)) return ''
    return process.platform
  })

  ipcMain.handle(IpcChannel.APP_QUIT, (event) => {
    if (!isTrustedSender(event)) return
    app.quit()
  })

  // 检查更新：当前未接入自动更新器，仅回传版本号供 UI 提示
  ipcMain.handle(IpcChannel.APP_CHECK_UPDATE, (event) => {
    if (!isTrustedSender(event)) return ''
    return app.getVersion()
  })

  // 网络检测：探测后端可达性（5s 超时）
  ipcMain.handle(IpcChannel.APP_NETWORK_CHECK, async (event) => {
    if (!isTrustedSender(event)) return false
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
  ipcMain.handle(IpcChannel.APP_OPEN_LOG_DIR, (event) => {
    if (!isTrustedSender(event)) return ''
    return shell.openPath(app.getPath('logs'))
  })

  // ---- 文件系统 ----
  ipcMain.handle(
    IpcChannel.FILE_OPEN_DIALOG,
    async (event, options: FileDialogOptions): Promise<FileDialogResult> => {
      if (!isTrustedSender(event)) return { canceled: true, filePaths: [] }
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { canceled: true, filePaths: [] }

      const dialogOptions: OpenDialogOptions = {
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters,
        properties: options.properties as OpenDialogOptions['properties']
      }
      const result = await dialog.showOpenDialog(win, dialogOptions)
      // H3/H2: 记录用户选定的路径，后续 FILE_READ/WRITE 命中即放行。
      if (!result.canceled) {
        for (const p of result.filePaths) userAllowedPaths.add(path.resolve(p))
      }
      return result
    }
  )

  ipcMain.handle(
    IpcChannel.FILE_SAVE_DIALOG,
    async (event, options: FileDialogOptions): Promise<FileDialogResult> => {
      if (!isTrustedSender(event)) return { canceled: true, filePaths: [] }
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { canceled: true, filePaths: [] }

      const dialogOptions: SaveDialogOptions = {
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters
      }
      const result = await dialog.showSaveDialog(win, dialogOptions)
      // H3/H2: 记录用户选定的保存路径，后续 FILE_WRITE 命中即放行。
      if (!result.canceled && result.filePath) {
        userAllowedPaths.add(path.resolve(result.filePath))
      }
      return {
        canceled: result.canceled,
        filePaths: result.filePath ? [result.filePath] : []
      }
    }
  )

  ipcMain.handle(
    IpcChannel.FILE_READ,
    async (event, filePath: string): Promise<FileReadResult> => {
      // H2: 调用方校验
      if (!isTrustedSender(event)) return { success: false, error: 'Forbidden: untrusted sender' }
      // H3: 路径格式 + 白名单（含符号链接解析）
      if (!isValidFilePath(filePath) || !isPathAllowed(filePath, allowedRoots)) {
        return { success: false, error: 'Invalid or disallowed file path' }
      }
      try {
        // H3/P1: 大小上限，避免读取超大文件占满内存
        const info = await stat(filePath)
        if (info.size > MAX_FILE_BYTES) {
          return { success: false, error: 'File exceeds maximum allowed size' }
        }
        const content = await readFile(filePath, 'utf-8')
        return { success: true, content }
      } catch (err) {
        return { success: false, error: normalizeFileError(err) }
      }
    }
  )

  ipcMain.handle(
    IpcChannel.FILE_WRITE,
    async (event, req: FileWriteRequest): Promise<FileReadResult> => {
      // H2: 调用方校验
      if (!isTrustedSender(event)) return { success: false, error: 'Forbidden: untrusted sender' }
      // H3: 路径格式 + 白名单（含符号链接解析）
      if (
        !req ||
        typeof req.filePath !== 'string' ||
        typeof req.content !== 'string' ||
        !isValidFilePath(req.filePath) ||
        !isPathAllowed(req.filePath, allowedRoots)
      ) {
        return { success: false, error: 'Invalid file path or content' }
      }
      // H3/P1: 内容大小上限
      if (req.content.length > MAX_FILE_BYTES) {
        return { success: false, error: 'Content exceeds maximum allowed size' }
      }
      try {
        await writeFile(req.filePath, req.content, req.encoding ?? 'utf-8')
        return { success: true }
      } catch (err) {
        return { success: false, error: normalizeFileError(err) }
      }
    }
  )

  ipcMain.handle(IpcChannel.FILE_GET_PATH, (event, name: UserDataPath) => {
    if (!isTrustedSender(event)) return ''
    return app.getPath(name)
  })

  // ---- 通知 ----
  ipcMain.handle(IpcChannel.NOTIFICATION_SHOW, (event, options: NotificationOptions) => {
    if (!isTrustedSender(event)) return
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
  ipcMain.handle(IpcChannel.CLIPBOARD_WRITE, (event, text: string) => {
    // H2: 调用方校验，避免被攻陷的渲染端任意写剪贴板
    if (!isTrustedSender(event)) return
    clipboard.writeText(text)
  })

  ipcMain.handle(IpcChannel.CLIPBOARD_READ, (event) => {
    if (!isTrustedSender(event)) return ''
    return clipboard.readText()
  })

  // ---- 外部链接 ----
  // H9（保持）：仅允许 http/https，避免 file:// / javascript: 等危险协议。
  // 该实现已属良好实践，不做修改，仅保留作为安全基线锚点。
  ipcMain.handle(IpcChannel.SHELL_OPEN_EXTERNAL, (event, url: string) => {
    if (!isTrustedSender(event)) return
    // 仅允许 http/https，避免 file:// 等危险协议
    if (!/^https?:\/\//i.test(url)) return
    return shell.openExternal(url)
  })

  // ---- Store 持久化 ----
  // H6: 写入前对 value 做深度清洗，杜绝原型链污染；读取返回净化副本，避免回传内部引用。
  ipcMain.handle(IpcChannel.STORE_GET, (event, key: string) => {
    if (!isTrustedSender(event)) return undefined
    return sanitizeValue(appStore.get(key))
  })

  ipcMain.handle(IpcChannel.STORE_SET, (event, key: string, value: unknown) => {
    if (!isTrustedSender(event)) return false
    appStore.set(key, sanitizeValue(value))
    return true
  })

  ipcMain.handle(IpcChannel.STORE_DELETE, (event, key: string) => {
    if (!isTrustedSender(event)) return false
    appStore.delete(key)
    return true
  })

  // ---- 健康检查 ----
  ipcMain.handle(IpcChannel.PING, (event) => {
    if (!isTrustedSender(event)) return ''
    return 'pong'
  })

  // ---- 窗口拖拽 ----
  // 使用 fire-and-forget send/on 模式，避免 invoke 的往返延迟
  // M5: 以 webContents.id 为 key 维护拖拽状态，避免多窗口下 A 窗口拖拽被
  // B 窗口事件覆盖（原实现为模块级单例，多窗口会“串味”）。当前单窗口仍完全兼容。
  const dragStates = new Map<number, { offsetX: number; offsetY: number }>()
  const dragTargets = new Map<number, BrowserWindow>()

  ipcMain.on(IpcChannel.WINDOW_DRAG_START, (event, data: { screenX: number; screenY: number }) => {
    if (!isTrustedSender(event)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const [winX, winY] = win.getPosition()
    const id = event.sender.id
    dragTargets.set(id, win)
    dragStates.set(id, {
      offsetX: data.screenX - (winX ?? 0),
      offsetY: data.screenY - (winY ?? 0)
    })
  })

  ipcMain.on(IpcChannel.WINDOW_DRAG_MOVE, (event, data: { screenX: number; screenY: number }) => {
    // P5: 校验坐标有限性，避免非有限值造成的异常/轻微 DoS
    if (!isTrustedSender(event)) return
    const id = event.sender.id
    const dragTarget = dragTargets.get(id)
    const dragState = dragStates.get(id)
    if (!dragTarget || !dragState) return
    if (!Number.isFinite(data.screenX) || !Number.isFinite(data.screenY)) return
    dragTarget.setPosition(
      Math.round(data.screenX - dragState.offsetX),
      Math.round(data.screenY - dragState.offsetY)
    )
  })

  ipcMain.on(IpcChannel.WINDOW_DRAG_END, (event) => {
    if (!isTrustedSender(event)) return
    const id = event.sender.id
    dragTargets.delete(id)
    dragStates.delete(id)
  })
}
