// H5: 仅声明渲染端实际依赖的最小 electron 子集（webUtils.getPathForFile）。
// 不再暴露整包 @electron-toolkit/preload 的 ElectronAPI（含 ipcRenderer）。
interface MinimalElectronAPI {
  webUtils: {
    getPathForFile: (file: File) => string | null
  }
}

interface WindowApi {
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  toggleFullscreen: () => Promise<void>
  toggleDevTools: () => Promise<void>
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
  checkUpdate: () => Promise<string>
  networkCheck: () => Promise<boolean>
  setApiBaseUrl: (url: string) => Promise<boolean>
  openLogDir: () => Promise<string>
  onMenuAction: (callback: (id: string) => void) => () => void
}

interface FileApi {
  openDialog: (options: FileDialogOptions) => Promise<{ canceled: boolean; filePaths: string[] }>
  saveDialog: (options: FileDialogOptions) => Promise<{ canceled: boolean; filePaths: string[] }>
  read: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>
  write: (req: FileWriteRequest) => Promise<{ success: boolean; error?: string }>
  getPath: (name: UserDataPath) => Promise<string>
}

interface NotificationApi {
  show: (options: NotificationOptions) => Promise<void>
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
    electron: MinimalElectronAPI
    api: PioneeringApi
  }
}

export {}
