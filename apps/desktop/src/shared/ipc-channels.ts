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

