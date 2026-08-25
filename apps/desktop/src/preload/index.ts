import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcChannel } from '../shared/ipc-channels'
import type {
  FileDialogOptions,
  FileWriteRequest,
  NotificationOptions,
  UserDataPath,
  AgentEventEnvelope
} from '../shared/ipc-channels'
import type { SendMessageRequest, ResumeRequest, AbortRequest, HitlStateResponse } from '../shared/types'

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
  setApiBaseUrl: (url: string) => ipcRenderer.invoke(IpcChannel.APP_SET_API_BASE_URL, url),
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
  getPath: (name: UserDataPath) => ipcRenderer.invoke(IpcChannel.FILE_GET_PATH, name),
  showInFolder: (filePath?: string) => ipcRenderer.invoke(IpcChannel.FILE_SHOW_IN_FOLDER, filePath)
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

// ---- Agent 本地运行时（云边双模阶段 1）----
// 流式事件不走 invoke 返回值：主进程经 AGENT_EVENT 主动推送，
// 渲染端通过 onEvent 按 runId 过滤消费。
const agentApi = {
  /** 启动一次 Agent 流式执行（对齐 POST /agent/completions） */
  send: (runId: string, request: SendMessageRequest): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IpcChannel.AGENT_SEND, { runId, request }),
  /** 恢复被 interrupt 暂停的 run（对齐 POST /agent/resume） */
  resume: (runId: string, request: ResumeRequest): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IpcChannel.AGENT_RESUME, { runId, request }),
  /** 中止/拒绝 HITL 待答复项（对齐 POST /agent/abort） */
  abort: (
    sessionId: string,
    reason?: AbortRequest['reason']
  ): Promise<{ message: string; aborted: boolean; error?: string }> =>
    ipcRenderer.invoke(IpcChannel.AGENT_ABORT, { sessionId, reason }),
  /** 查询待答复 HITL 状态（对齐 GET /agent/state/:threadId） */
  state: (threadId: string): Promise<HitlStateResponse> =>
    ipcRenderer.invoke(IpcChannel.AGENT_STATE, threadId),
  /** 停止该会话进行中的本地流（对齐 POST /agent/completions/stop） */
  stop: (sessionId: string): Promise<{ message: string; aborted: boolean }> =>
    ipcRenderer.invoke(IpcChannel.AGENT_STOP, sessionId),
  /** 订阅 AG-UI 事件流（按 runId 过滤由调用方负责）；返回取消订阅函数 */
  onEvent: (callback: (envelope: AgentEventEnvelope) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, envelope: AgentEventEnvelope) =>
      callback(envelope)
    ipcRenderer.on(IpcChannel.AGENT_EVENT, handler)
    return () => {
      ipcRenderer.removeListener(IpcChannel.AGENT_EVENT, handler)
    }
  }
}

const api = {
  window: windowApi,
  app: appApi,
  file: fileApi,
  notification: notificationApi,
  clipboard: clipboardApi,
  shell: shellApi,
  store: storeApi,
  health: healthApi,
  agent: agentApi
}

// H5: 不再暴露整包 @electron-toolkit/preload 的 electronAPI（内含 ipcRenderer，
// 会使上面的 window.api 参数封装形同虚设，攻击者可 invoke 任意通道）。
// 仅暴露渲染端真正需要的、且只读的安全子集 webUtils.getPathForFile
// （用于从 DataTransfer 还原本地文件路径，见 drag-folder.ts）。
//
// S8 修复：原实现未 try/catch，若 file 不合法或底层抛错，异常会冒泡到渲染端。
// index.d.ts 声明返回 string | null，但实现并不会返回 null，类型与行为不一致。
// 包装 try/catch，失败时返回 null，与类型声明对齐。
const minimalElectron = {
  webUtils: {
    getPathForFile: (file: File): string | null => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return null
      }
    }
  }
}

if (process.contextIsolated) {
  // 隔离上下文（预期路径）：通过 contextBridge 暴露受限 API。
  contextBridge.exposeInMainWorld('api', api)
  contextBridge.exposeInMainWorld('electron', minimalElectron)
} else {
  // H1: 非隔离降级分支必须抛错，禁止把受限 API 直接挂到 window 上，
  // 否则等于在完全无隔离环境下暴露 ipcRenderer，严重扩大攻击面。
  throw new Error(
    '[preload] contextIsolation 未启用，拒绝将受限 API 暴露到全局 window，进程已终止。'
  )
}
