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

function getApi() {
  return window.api
}

// ---- 窗口控制 ----
export const windowApi = {
  minimize: () => getApi()?.window.minimize(),
  maximize: () => getApi()?.window.maximize(),
  close: () => getApi()?.window.close(),
  isMaximized: () => getApi()?.window.isMaximized() ?? Promise.resolve(false),
  toggleFullscreen: () => getApi()?.window.toggleFullscreen(),
  onFullscreenChange: (callback: (fullscreen: boolean) => void) =>
    getApi()?.window.onFullscreenChange?.(callback)
}

// ---- 应用信息 ----
export const appApi = {
  getVersion: () => getApi()?.app.getVersion() ?? Promise.resolve('0.0.0'),
  getPlatform: () => getApi()?.app.getPlatform() ?? Promise.resolve(process.platform),
  quit: () => getApi()?.app.quit()
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
  getPath: (name: UserDataPath) => getApi()?.file.getPath(name) ?? Promise.resolve('')
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
