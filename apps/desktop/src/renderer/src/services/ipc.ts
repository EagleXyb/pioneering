// ============================================================
// Renderer-side IPC Service
// 渲染进程中调用的 IPC 封装
// ============================================================

import type {
  FileDialogOptions,
  FileDialogResult,
  FileReadResult,
  FileWriteRequest,
  NotificationOptions,
  UserDataPath
} from '@shared/ipc-channels'
import { normalizePlatform } from '@shared/types'

function getApi() {
  return window.api
}

// ---- 窗口拖拽 rAF 节流 ----
// moveDrag 由高频 mousemove 触发，用 rAF 合并：每帧最多发送一次、只发最新坐标，
// 避免 IPC 洪泛阻塞主进程渲染；模块级单例，同一时刻仅一个窗口拖拽。
let dragRafId: number | null = null
let dragLatest: { x: number; y: number } | null = null

function flushDrag(): void {
  dragRafId = null
  if (!dragLatest) return
  const { x, y } = dragLatest
  dragLatest = null
  getApi()?.window.moveDrag(x, y)
}

// ---- 窗口控制 ----
export const windowApi = {
  minimize: () => getApi()?.window.minimize(),
  maximize: () => getApi()?.window.maximize(),
  close: () => getApi()?.window.close(),
  isMaximized: () => getApi()?.window.isMaximized() ?? Promise.resolve(false),
  toggleFullscreen: () => getApi()?.window.toggleFullscreen(),
  toggleDevTools: () => getApi()?.window.toggleDevTools(),
  // 纯 IPC 窗口拖拽（避免 -webkit-app-region 的点击事件 bug）
  startDrag: (screenX: number, screenY: number) => {
    dragLatest = null
    if (dragRafId !== null) {
      cancelAnimationFrame(dragRafId)
      dragRafId = null
    }
    getApi()?.window.startDrag(screenX, screenY)
  },
  moveDrag: (screenX: number, screenY: number) => {
    dragLatest = { x: screenX, y: screenY }
    if (dragRafId !== null) return
    dragRafId = requestAnimationFrame(flushDrag)
  },
  endDrag: () => {
    if (dragRafId !== null) {
      cancelAnimationFrame(dragRafId)
      dragRafId = null
    }
    // 收尾冲刷最后一帧坐标，防止松手瞬间窗口位置漂移
    flushDrag()
    getApi()?.window.endDrag()
  },
  onMaximizedChange: (callback: (maximized: boolean) => void) =>
    getApi()?.window.onMaximizedChange?.(callback),
  onFullscreenChange: (callback: (fullscreen: boolean) => void) =>
    getApi()?.window.onFullscreenChange?.(callback)
}

// ---- 应用信息 ----
export const appApi = {
  getVersion: () => getApi()?.app.getVersion() ?? Promise.resolve('0.0.0'),
  getPlatform: () => getApi()?.app.getPlatform() ?? Promise.resolve(normalizePlatform(process.platform)),
  quit: () => getApi()?.app.quit(),
  checkUpdate: () => getApi()?.app.checkUpdate() ?? Promise.resolve('0.0.0'),
  networkCheck: () => getApi()?.app.networkCheck() ?? Promise.resolve(false),
  setApiBaseUrl: (url: string) =>
    getApi()?.app.setApiBaseUrl(url) ?? Promise.resolve(false),
  openLogDir: () => getApi()?.app.openLogDir() ?? Promise.resolve(''),
  // 主进程原生菜单 -> 渲染端的动作转发监听
  onMenuAction: (callback: (id: string) => void) =>
    getApi()?.app.onMenuAction?.(callback)
}

// ---- 文件系统 ----
export const fileApi = {
  openDialog: (options: FileDialogOptions) =>
    getApi()?.file.openDialog(options) ?? Promise.resolve({ canceled: true, filePaths: [] }),
  saveDialog: (options: FileDialogOptions) =>
    getApi()?.file.saveDialog(options) ?? Promise.resolve({ canceled: true, filePaths: [] }),
  read: (filePath: string) =>
    getApi()?.file.read(filePath) ?? Promise.resolve({ success: false, error: 'IPC not available' }),
  write: (req: FileWriteRequest) =>
    getApi()?.file.write(req) ?? Promise.resolve({ success: false, error: 'IPC not available' }),
  getPath: (name: UserDataPath) => getApi()?.file.getPath(name) ?? Promise.resolve(''),
  /** 在系统文件管理器中显示路径（无参 = 打开 userData 目录） */
  showInFolder: (filePath?: string) =>
    getApi()?.file.showInFolder(filePath) ?? Promise.resolve(false)
}

// ---- 通知 ----
export const notificationApi = {
  show: (options: NotificationOptions) => getApi()?.notification.show(options)
}

// ---- 剪贴板 ----
export const clipboardApi = {
  write: (text: string) => getApi()?.clipboard.write(text),
  read: () => getApi()?.clipboard.read() ?? Promise.resolve('')
}

// ---- 外部链接 ----
export const shellApi = {
  openExternal: (url: string) => getApi()?.shell.openExternal(url)
}

// ---- Store 持久化 ----
export const storeApi = {
  get: <T = unknown>(key: string) => getApi()?.store.get(key) as Promise<T | undefined> | undefined,
  set: (key: string, value: unknown) => getApi()?.store.set(key, value) ?? Promise.resolve(false),
  delete: (key: string) => getApi()?.store.delete(key) ?? Promise.resolve(false)
}

// ---- 健康检查 ----
export const healthApi = {
  ping: () => getApi()?.health.ping() ?? Promise.resolve('pong')
}
