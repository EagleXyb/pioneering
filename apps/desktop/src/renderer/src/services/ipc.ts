// ============================================================
// Renderer-side IPC Service
// 渲染进程中调用的 IPC 封装
// ============================================================

import { IpcChannel } from '@shared/ipc-channels'
import type {
  FileDialogOptions,
  FileDialogResult,
  FileReadResult,
  FileWriteRequest,
  NotificationOptions,
  UserDataPath
} from '@shared/ipc-channels'

function invoke<T = void>(channel: IpcChannel, ...args: unknown[]): Promise<T> {
  return window.electron.ipcRenderer.invoke(channel, ...args)
}

// ---- 窗口控制 ----
export const windowApi = {
  minimize: () => invoke(IpcChannel.WINDOW_MINIMIZE),
  maximize: () => invoke(IpcChannel.WINDOW_MAXIMIZE),
  close: () => invoke(IpcChannel.WINDOW_CLOSE),
  isMaximized: () => invoke<boolean>(IpcChannel.WINDOW_IS_MAXIMIZED),
  toggleFullscreen: () => invoke(IpcChannel.WINDOW_TOGGLE_FULLSCREEN)
}

// ---- 应用信息 ----
export const appApi = {
  getVersion: () => invoke<string>(IpcChannel.APP_GET_VERSION),
  getPlatform: () => invoke<string>(IpcChannel.APP_GET_PLATFORM),
  quit: () => invoke(IpcChannel.APP_QUIT)
}

// ---- 文件系统 ----
export const fileApi = {
  openDialog: (options: FileDialogOptions) =>
    invoke<FileDialogResult>(IpcChannel.FILE_OPEN_DIALOG, options),
  saveDialog: (options: FileDialogOptions) =>
    invoke<FileDialogResult>(IpcChannel.FILE_SAVE_DIALOG, options),
  read: (filePath: string) =>
    invoke<FileReadResult>(IpcChannel.FILE_READ, filePath),
  write: (req: FileWriteRequest) =>
    invoke<FileReadResult>(IpcChannel.FILE_WRITE, req),
  getPath: (name: UserDataPath) =>
    invoke<string>(IpcChannel.FILE_GET_PATH, name)
}

// ---- 通知 ----
export const notificationApi = {
  show: (options: NotificationOptions) =>
    invoke(IpcChannel.NOTIFICATION_SHOW, options)
}

// ---- 剪贴板 ----
export const clipboardApi = {
  write: (text: string) => invoke(IpcChannel.CLIPBOARD_WRITE, text),
  read: () => invoke<string>(IpcChannel.CLIPBOARD_READ)
}

// ---- 外部链接 ----
export const shellApi = {
  openExternal: (url: string) =>
    invoke(IpcChannel.SHELL_OPEN_EXTERNAL, url)
}

// ---- Store 持久化 ----
export const storeApi = {
  get: <T = unknown>(key: string) =>
    invoke<T | undefined>(IpcChannel.STORE_GET, key),
  set: (key: string, value: unknown) =>
    invoke<boolean>(IpcChannel.STORE_SET, key, value),
  delete: (key: string) =>
    invoke<boolean>(IpcChannel.STORE_DELETE, key)
}

// ---- 健康检查 ----
export const healthApi = {
  ping: () => invoke<string>(IpcChannel.PING)
}
