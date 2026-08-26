// H5: 仅声明渲染端实际依赖的最小 electron 子集（webUtils.getPathForFile）。
// 不再暴露整包 @electron-toolkit/preload 的 ElectronAPI（含 ipcRenderer）。
//
// 此文件为全局类型声明（无顶层 import/export），所有 interface 均为全局 ambient 类型，
// 供渲染进程（含浏览器模式 mock）直接引用，无需 import。
import type {
  FileDialogOptions,
  FileWriteRequest,
  UserDataPath,
  AgentEventEnvelope,
  LocalSessionListRequest,
  LocalSessionListResult,
  LocalCreateSessionRequest,
  LocalUpdateSessionRequest,
  LocalMessageListRequest,
  LocalMessageListResult,
  LocalAppendMessagesRequest,
  LocalDeleteMessagesRequest,
  LocalFeedbackRequest,
  LocalDaoResult,
  SecureKeyListResult,
  SecureKeySetRequest,
  SecureKeySetResult,
  UploadSaveRequest,
  UploadSaveResult,
  UploadInfo,
  UploadDeleteResult
} from '../shared/ipc-channels'
import type {
  SendMessageRequest,
  ResumeRequest,
  AbortRequest,
  HitlStateResponse,
  ChatSession
} from '../shared/types'

declare global {
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
    /** 在系统文件管理器中显示路径；不传参时打开 userData 目录 */
    showInFolder: (filePath?: string) => Promise<boolean>
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

  /** Agent 本地运行时（云边双模阶段 1）：与 preload agentApi 一一对应 */
  interface AgentApi {
    send: (runId: string, request: SendMessageRequest) => Promise<{ ok: boolean; error?: string }>
    resume: (runId: string, request: ResumeRequest) => Promise<{ ok: boolean; error?: string }>
    abort: (
      sessionId: string,
      reason?: AbortRequest['reason']
    ) => Promise<{ message: string; aborted: boolean; error?: string }>
    state: (threadId: string) => Promise<HitlStateResponse>
    stop: (sessionId: string) => Promise<{ message: string; aborted: boolean }>
    onEvent: (callback: (envelope: AgentEventEnvelope) => void) => () => void
  }

  /** 本地会话/消息持久化（云边双模阶段 2）：与 preload localChatApi 一一对应 */
  interface LocalChatApi {
    listSessions: (
      req?: LocalSessionListRequest
    ) => Promise<LocalSessionListResult | LocalDaoResult>
    createSession: (
      req?: LocalCreateSessionRequest
    ) => Promise<ChatSession | LocalDaoResult>
    updateSession: (
      sessionId: string,
      patch: LocalUpdateSessionRequest
    ) => Promise<ChatSession | LocalDaoResult>
    deleteSession: (sessionId: string) => Promise<LocalDaoResult>
    listMessages: (
      req: LocalMessageListRequest
    ) => Promise<LocalMessageListResult | LocalDaoResult>
    appendMessages: (req: LocalAppendMessagesRequest) => Promise<LocalDaoResult>
    /** 按 id 删除消息（regenerate 截断等场景） */
    deleteMessages: (req: LocalDeleteMessagesRequest) => Promise<LocalDaoResult>
    updateFeedback: (req: LocalFeedbackRequest) => Promise<LocalDaoResult>
  }

  /** 密钥 safeStorage 治理（云边双模阶段 2）：与 preload secureKeyApi 一一对应 */
  interface SecureKeyApi {
    list: () => Promise<SecureKeyListResult>
    set: (req: SecureKeySetRequest) => Promise<SecureKeySetResult>
    delete: (name: string) => Promise<LocalDaoResult>
  }

  /** 本地上传（云边双模阶段 2）：与 preload uploadApi 一一对应 */
  interface UploadApi {
    save: (req: UploadSaveRequest) => Promise<UploadSaveResult>
    list: () => Promise<UploadInfo[]>
    delete: (id: string) => Promise<UploadDeleteResult>
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
    agent: AgentApi
    localChat: LocalChatApi
    secureKeys: SecureKeyApi
    upload: UploadApi
  }

  interface Window {
    electron: MinimalElectronAPI
    api: PioneeringApi
  }
}

export {}
