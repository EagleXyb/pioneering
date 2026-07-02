// ============================================================
// IPC Channel 协议定义
// Main ↔ Renderer 通信接口枚举与类型
// ============================================================

// ---- Channel 枚举 ----
export enum IpcChannel {
  // 窗口控制
  WINDOW_MINIMIZE = 'window:minimize',
  WINDOW_MAXIMIZE = 'window:maximize',
  WINDOW_CLOSE = 'window:close',
  WINDOW_IS_MAXIMIZED = 'window:isMaximized',
  WINDOW_TOGGLE_FULLSCREEN = 'window:toggleFullscreen',

  // 应用信息
  APP_GET_VERSION = 'app:getVersion',
  APP_GET_PLATFORM = 'app:getPlatform',
  APP_QUIT = 'app:quit',

  // 文件系统
  FILE_OPEN_DIALOG = 'file:openDialog',
  FILE_SAVE_DIALOG = 'file:saveDialog',
  FILE_READ = 'file:read',
  FILE_WRITE = 'file:write',
  FILE_GET_PATH = 'file:getPath',

  // 通知
  NOTIFICATION_SHOW = 'notification:show',

  // 剪贴板
  CLIPBOARD_WRITE = 'clipboard:write',
  CLIPBOARD_READ = 'clipboard:read',

  // 外部链接
  SHELL_OPEN_EXTERNAL = 'shell:openExternal',

  // Store（持久化存储）
  STORE_GET = 'store:get',
  STORE_SET = 'store:set',
  STORE_DELETE = 'store:delete',

  // 健康检查
  PING = 'ping'
}

// ---- Window 控制 ----
export interface WindowState {
  isMaximized: boolean
  isFullscreen: boolean
}

// ---- 文件对话框 ----
export interface FileDialogOptions {
  title?: string
  defaultPath?: string
  filters?: Array<{ name: string; extensions: string[] }>
  properties?: Array<
    | 'openFile'
    | 'openDirectory'
    | 'multiSelections'
    | 'createDirectory'
    | 'promptToCreate'
  >
}

export interface FileDialogResult {
  canceled: boolean
  filePaths: string[]
}

// ---- 通知 ----
export interface NotificationOptions {
  title: string
  body: string
  urgency?: 'normal' | 'critical' | 'low'
}

// ---- 文件操作 ----
export interface FileReadResult {
  success: boolean
  content?: string
  error?: string
}

export interface FileWriteRequest {
  filePath: string
  content: string
  encoding?: BufferEncoding
}

export type UserDataPath = 'home' | 'appData' | 'userData' | 'desktop' | 'documents' | 'downloads'

// ---- Store 持久化 ----
export interface StoreValue {
  [key: string]: unknown
}
