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
  WINDOW_STATE_CHANGED = 'window:stateChanged',
  WINDOW_FULLSCREEN_CHANGED = 'window:fullscreenChanged',
  WINDOW_TOGGLE_DEVTOOLS = 'window:toggleDevTools',

  // 窗口拖拽（纯 IPC 方式，避免 -webkit-app-region 的 bug）
  WINDOW_DRAG_START = 'window:drag-start',
  WINDOW_DRAG_MOVE = 'window:drag-move',
  WINDOW_DRAG_END = 'window:drag-end',

  // 应用信息
  APP_GET_VERSION = 'app:getVersion',
  APP_GET_PLATFORM = 'app:getPlatform',
  APP_QUIT = 'app:quit',
  APP_CHECK_UPDATE = 'app:checkUpdate',
  APP_NETWORK_CHECK = 'app:networkCheck',
  APP_SET_API_BASE_URL = 'app:setApiBaseUrl',
  APP_OPEN_LOG_DIR = 'app:openLogDir',

  // 主进程(原生菜单) -> 渲染端 的动作转发（如打开设置弹框）
  MENU_ACTION = 'menu:action',

  // 文件系统
  FILE_OPEN_DIALOG = 'file:openDialog',
  FILE_SAVE_DIALOG = 'file:saveDialog',
  FILE_READ = 'file:read',
  FILE_WRITE = 'file:write',
  FILE_GET_PATH = 'file:getPath',
  // 在系统文件管理器中显示指定路径（会话数据目录等）
  FILE_SHOW_IN_FOLDER = 'file:showInFolder',

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

  // ---- Agent 本地运行时（云边双模阶段 1）----
  // 渲染端 → 主进程：启动/恢复/中止/查询（语义对齐 backend-ts /agent/* REST 端点）
  AGENT_SEND = 'agent:send',
  AGENT_RESUME = 'agent:resume',
  AGENT_ABORT = 'agent:abort',
  AGENT_STATE = 'agent:state',
  AGENT_STOP = 'agent:stop',
  // 主进程 → 渲染端：AG-UI 事件推送（AgentEventEnvelope 载荷）
  AGENT_EVENT = 'agent:event',

  // ---- 本地会话/消息持久化（云边双模阶段 2：SQLite DAO）----
  // 语义对齐 backend-ts /chat/* 的会话/消息 CRUD 子集；
  // 本地模式下渲染端经这些通道读写 userData/local-chat.db，
  // 断网可用，去掉对云端 backend 的运行时依赖。
  LOCAL_CHAT_LIST_SESSIONS = 'localChat:listSessions',
  LOCAL_CHAT_CREATE_SESSION = 'localChat:createSession',
  LOCAL_CHAT_UPDATE_SESSION = 'localChat:updateSession',
  LOCAL_CHAT_DELETE_SESSION = 'localChat:deleteSession',
  LOCAL_CHAT_LIST_MESSAGES = 'localChat:listMessages',
  LOCAL_CHAT_APPEND_MESSAGES = 'localChat:appendMessages',
  LOCAL_CHAT_DELETE_MESSAGES = 'localChat:deleteMessages',
  LOCAL_CHAT_UPDATE_FEEDBACK = 'localChat:updateFeedback',

  // ---- 密钥 safeStorage 治理（云边双模阶段 2）----
  // LLM / 搜索密钥经系统密钥库（DPAPI / Keychain）加密后落
  // electron-store，主进程启动 Agent 前解密注入 process.env。
  SECURE_KEY_LIST = 'secureKey:list',
  SECURE_KEY_SET = 'secureKey:set',
  SECURE_KEY_DELETE = 'secureKey:delete',

  // ---- 本地上传（云边双模阶段 2：userData/uploads）----
  UPLOAD_SAVE = 'upload:save',
  UPLOAD_LIST = 'upload:list',
  UPLOAD_DELETE = 'upload:delete',

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

// ---- Agent 本地运行时（云边双模阶段 1）----

/** AGENT_SEND / AGENT_RESUME 的 invoke 载荷 */
export interface AgentRunRequestPayload<TRequest> {
  /** 渲染端生成的本次运行标识（事件经 AGENT_EVENT 按 runId 路由回投） */
  runId: string
  request: TRequest
}

/** AGENT_EVENT 推送载荷：runId 路由 + 单调递增 seq + AG-UI 事件对象 */
export interface AgentEventEnvelope {
  runId: string
  seq: number
  event: Record<string, unknown>
}

// ---- 本地会话/消息持久化（云边双模阶段 2）----

export interface LocalSessionListRequest {
  page?: number
  pageSize?: number
  archived?: boolean
}

export interface LocalSessionListResult {
  sessions: import('./types').ChatSession[]
  total: number
}

export interface LocalCreateSessionRequest {
  title?: string
  agentMode?: string
  model?: string
  systemPrompt?: string
}

export interface LocalUpdateSessionRequest {
  title?: string
  modelConfig?: Record<string, unknown>
  isArchived?: boolean
}

export interface LocalMessageListRequest {
  sessionId: string
  /** 游标 = 上一页最后一条消息 id；缺省取最新一页 */
  cursor?: string
  limit?: number
  direction?: 'before' | 'after'
}

export interface LocalMessageListResult {
  messages: import('./types').ChatMessage[]
  nextCursor?: string
}

export interface LocalAppendMessagesRequest {
  sessionId: string
  messages: import('./types').ChatMessage[]
}

export interface LocalDeleteMessagesRequest {
  sessionId: string
  /** 要删除的消息 id 列表（regenerate 截断等场景） */
  messageIds: string[]
}

export interface LocalFeedbackRequest {
  messageId: string
  feedback: 'like' | 'dislike' | 'none'
}

/** 本地 DAO 通用操作结果 */
export interface LocalDaoResult {
  ok: boolean
  error?: string
}

// ---- 密钥 safeStorage（云边双模阶段 2）----

/** 受管键描述符（与主进程 key-store.ts ManagedKeyDescriptor 结构对齐） */
export interface SecureKeyDescriptor {
  name: string
  label: string
  placeholder: string
  sensitive: boolean
}

export interface SecureKeyListResult {
  keys: SecureKeyInfo[]
  descriptors: SecureKeyDescriptor[]
}

/** 单个受管密钥的展示态（值已掩码，绝不回传明文） */
export interface SecureKeyInfo {
  name: string
  /** 掩码值（如 sk-1***xy）；未配置为空串 */
  masked: string
  /** 是否经系统密钥库加密存储 */
  encrypted: boolean
}

export interface SecureKeySetRequest {
  name: string
  value: string
}

export interface SecureKeySetResult {
  ok: boolean
  error?: string
}

// ---- 本地上传（云边双模阶段 2）----

export interface UploadSaveRequest {
  fileName: string
  /** 文件内容（base64，不含 data: 前缀） */
  base64: string
}

export interface UploadInfo {
  id: string
  fileName: string
  /** 绝对路径（userData/uploads 下） */
  path: string
  size: number
  createdAt: string
}

export interface UploadSaveResult {
  ok: boolean
  upload?: UploadInfo
  error?: string
}

export interface UploadDeleteResult {
  ok: boolean
  error?: string
}

