import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannel } from '../shared/ipc-channels'
import type {
  FileDialogOptions,
  FileWriteRequest,
  NotificationOptions,
  UserDataPath
} from '../shared/ipc-channels'

const windowApi = {
  minimize: () => ipcRenderer.invoke(IpcChannel.WINDOW_MINIMIZE),
  maximize: () => ipcRenderer.invoke(IpcChannel.WINDOW_MAXIMIZE),
  close: () => ipcRenderer.invoke(IpcChannel.WINDOW_CLOSE),
  isMaximized: () => ipcRenderer.invoke(IpcChannel.WINDOW_IS_MAXIMIZED),
  toggleFullscreen: () => ipcRenderer.invoke(IpcChannel.WINDOW_TOGGLE_FULLSCREEN),
  toggleDevTools: () => ipcRenderer.invoke(IpcChannel.WINDOW_TOGGLE_DEVTOOLS),
  onMaximizedChange: (callback: (maximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: boolean) => callback(value)
    ipcRenderer.on(IpcChannel.WINDOW_STATE_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IpcChannel.WINDOW_STATE_CHANGED, handler)
    }
  },
  onFullscreenChange: (callback: (fullscreen: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: boolean) => callback(value)
    ipcRenderer.on(IpcChannel.WINDOW_FULLSCREEN_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IpcChannel.WINDOW_FULLSCREEN_CHANGED, handler)
    }
  },
  // 纯 IPC 窗口拖拽（避免 -webkit-app-region 的点击事件 bug）
  startDrag: (screenX: number, screenY: number) => {
    ipcRenderer.send(IpcChannel.WINDOW_DRAG_START, { screenX, screenY })
  },
  moveDrag: (screenX: number, screenY: number) => {
    ipcRenderer.send(IpcChannel.WINDOW_DRAG_MOVE, { screenX, screenY })
  },
  endDrag: () => {
    ipcRenderer.send(IpcChannel.WINDOW_DRAG_END)
  }
}

const appApi = {
  getVersion: () => ipcRenderer.invoke(IpcChannel.APP_GET_VERSION),
  getPlatform: () => ipcRenderer.invoke(IpcChannel.APP_GET_PLATFORM),
  quit: () => ipcRenderer.invoke(IpcChannel.APP_QUIT),
  checkUpdate: () => ipcRenderer.invoke(IpcChannel.APP_CHECK_UPDATE),
  networkCheck: () => ipcRenderer.invoke(IpcChannel.APP_NETWORK_CHECK),
  openLogDir: () => ipcRenderer.invoke(IpcChannel.APP_OPEN_LOG_DIR),
  onMenuAction: (callback: (id: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string) => callback(id)
    ipcRenderer.on(IpcChannel.MENU_ACTION, handler)
    return () => {
      ipcRenderer.removeListener(IpcChannel.MENU_ACTION, handler)
    }
  }
}

const fileApi = {
  openDialog: (options: FileDialogOptions) => ipcRenderer.invoke(IpcChannel.FILE_OPEN_DIALOG, options),
  saveDialog: (options: FileDialogOptions) => ipcRenderer.invoke(IpcChannel.FILE_SAVE_DIALOG, options),
  read: (filePath: string) => ipcRenderer.invoke(IpcChannel.FILE_READ, filePath),
  write: (req: FileWriteRequest) => ipcRenderer.invoke(IpcChannel.FILE_WRITE, req),
  getPath: (name: UserDataPath) => ipcRenderer.invoke(IpcChannel.FILE_GET_PATH, name)
}

const notificationApi = {
  show: (options: NotificationOptions) => ipcRenderer.invoke(IpcChannel.NOTIFICATION_SHOW, options)
}

const clipboardApi = {
  write: (text: string) => ipcRenderer.invoke(IpcChannel.CLIPBOARD_WRITE, text),
  read: () => ipcRenderer.invoke(IpcChannel.CLIPBOARD_READ)
}

const shellApi = {
  openExternal: (url: string) => ipcRenderer.invoke(IpcChannel.SHELL_OPEN_EXTERNAL, url)
}

const storeApi = {
  get: (key: string) => ipcRenderer.invoke(IpcChannel.STORE_GET, key),
  set: (key: string, value: unknown) => ipcRenderer.invoke(IpcChannel.STORE_SET, key, value),
  delete: (key: string) => ipcRenderer.invoke(IpcChannel.STORE_DELETE, key)
}

const healthApi = {
  ping: () => ipcRenderer.invoke(IpcChannel.PING)
}

const api = {
  window: windowApi,
  app: appApi,
  file: fileApi,
  notification: notificationApi,
  clipboard: clipboardApi,
  shell: shellApi,
  store: storeApi,
  health: healthApi
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
