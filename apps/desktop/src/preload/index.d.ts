import { ElectronAPI } from '@electron-toolkit/preload'

interface WindowApi {
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  toggleFullscreen: () => Promise<void>
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void
  onFullscreenChange: (callback: (fullscreen: boolean) => void) => () => void
  startDrag: (screenX: number, screenY: number) => void
  moveDrag: (screenX: number, screenY: number) => void
  endDrag: () => void
}

interface AppApi {
  getVersion: () => Promise<string>
  getPlatform: () => Promise<string>
  quit: () => Promise<void>
}

interface FileApi {
  openDialog: (options: unknown) => Promise<{ canceled: boolean; filePaths: string[] }>
  saveDialog: (options: unknown) => Promise<{ canceled: boolean; filePaths: string[] }>
  read: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>
  write: (req: unknown) => Promise<{ success: boolean; error?: string }>
  getPath: (name: unknown) => Promise<string>
}

interface NotificationApi {
  show: (options: unknown) => Promise<void>
}

interface ClipboardApi {
  write: (text: string) => Promise<void>
  read: () => Promise<string>
}

interface ShellApi {
  openExternal: (url: string) => Promise<void>
}

interface StoreApi {
  get: <T = unknown>(key: string) => Promise<T | undefined>
  set: (key: string, value: unknown) => Promise<boolean>
  delete: (key: string) => Promise<boolean>
}

interface HealthApi {
  ping: () => Promise<string>
}

interface PioneeringApi {
  window: WindowApi
  app: AppApi
  file: FileApi
  notification: NotificationApi
  clipboard: ClipboardApi
  shell: ShellApi
  store: StoreApi
  health: HealthApi
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: PioneeringApi
  }
}

export {}
