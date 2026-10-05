// H5: 仅声明渲染端实际依赖的最小 electron 子集（webUtils.getPathForFile）。
// 不再暴露整包 @electron-toolkit/preload 的 ElectronAPI（含 ipcRenderer）。
//
// 此文件为全局类型声明（无顶层 import/export），所有 interface 均为全局 ambient 类型，
// 供渲染进程（含浏览器模式 mock）直接引用，无需 import。
import type {
  FileDialogOptions,
  FileWriteRequest,
  DraftAssetWriteRequest,
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
  ModelSecretSetRequest,
  ModelSecretGetResult,
  ModelSecretListResult,
  HotkeyOverrides,
  HotkeyApplyResult
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
    /** 在系统文件管理器中显示路径；不传参时打开 userData 目录 */
    showInFolder: (filePath?: string) => Promise<boolean>
  }

  interface NotificationApi {
    show: (options: NotificationOptions) => Promise<void>
  }

  interface ClipboardApi {
    write: (text: string) => Promise<void>
  }

  interface ShellApi {
    openExternal: (url: string) => Promise<void>
  }

  interface StoreApi {
    get: <T = unknown>(key: string) => Promise<T | undefined>
    set: (key: string, value: unknown) => Promise<boolean>
    delete: (key: string) => Promise<boolean>
  }

  /** 草稿图片资产（T9）：与 preload draftAssetApi 一一对应 */
  interface DraftAssetApi {
    write: (
      req: DraftAssetWriteRequest
    ) => Promise<{ success: boolean; error?: string }>
    read: (
      id: string
    ) => Promise<{ success: boolean; base64?: string; error?: string }>
    delete: (id: string) => Promise<{ success: boolean; error?: string }>
  }

  /** Agent 本地运行时（云边双模阶段 1）：与 preload agentApi 一一对应 */
  interface AgentApi {
    /**
     * T22：仅浏览器 mock 置 true，表示该通道在当前环境不可用。
     * 真实 preload 不提供此字段；可用性检测据此排除 mock 桩。
     */
    unavailable?: boolean
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

  /** 本地会话/消息持久化（云边双模阶段 2：SQLite DAO）：与 preload localChatApi 一一对应 */
  interface LocalChatApi {
    /** T22：仅浏览器 mock 置 true（含义同 AgentApi.unavailable） */
    unavailable?: boolean
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

  /** 模型配置密钥（T6）：与 preload modelSecretApi 一一对应；明文密钥不回传 */
  interface ModelSecretApi {
    set: (
      req: ModelSecretSetRequest
    ) => Promise<{ ok: boolean; error?: string }>
    get: (id: string) => Promise<ModelSecretGetResult>
    list: () => Promise<ModelSecretListResult>
    delete: (id: string) => Promise<LocalDaoResult>
  }

  /** 快捷键治理：与 preload hotkeysApi 一一对应（浏览器模式由 electron-mock 降级桩兜底） */
  interface HotkeysApi {
    get: () => Promise<HotkeyApplyResult>
    set: (overrides: HotkeyOverrides) => Promise<HotkeyApplyResult>
    reset: () => Promise<HotkeyApplyResult>
  }

  interface PioneeringApi {
    window: WindowApi
    app: AppApi
    file: FileApi
    notification: NotificationApi
    clipboard: ClipboardApi
    shell: ShellApi
    store: StoreApi
    draftAsset: DraftAssetApi
    agent: AgentApi
    localChat: LocalChatApi
    secureKeys: SecureKeyApi
    modelSecret: ModelSecretApi
    hotkeys: HotkeysApi
  }

  interface Window {
    electron: MinimalElectronAPI
    api: PioneeringApi
  }
}

export {}
