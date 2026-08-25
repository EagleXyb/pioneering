// ============================================================
// Main Process IPC Handlers
// 在主进程中注册所有 IPC 通道的处理器
// ============================================================

import {
  ipcMain,
  BrowserWindow,
  app,
  dialog,
  clipboard,
  shell,
  screen,
  Notification,
  type SaveDialogOptions,
  type OpenDialogOptions
} from 'electron'
import { readFile, writeFile, stat } from 'fs/promises'
import { realpathSync, readFileSync } from 'fs'
import os from 'node:os'
import path from 'path'
import Store from 'electron-store'
import { IpcChannel } from '../shared/ipc-channels'
import type {
  FileDialogOptions,
  FileDialogResult,
  FileReadResult,
  FileWriteRequest,
  NotificationOptions,
  UserDataPath,
  AgentRunRequestPayload
} from '../shared/ipc-channels'
import {
  ensureAgentEnv,
  validateSendRequest,
  validateResumeRequest,
  startSend,
  startResume,
  stopRun,
  abortPending,
  getHitlState,
  abortRunsForSender,
  type AgentEventSender
} from './agent-runtime'
import type { AbortRequest, HitlStateResponse } from '../shared/types'

// 使用 electron-store 持久化到磁盘，应用重启后 Token/配置不丢失。
// 注意：electron-store 内部在读写时自动做 JSON 序列化/反序列化，
// 我们在 IPC 边界仍保留 sanitizeValue 深度清洗以杜绝原型链污染。
const appStore = new Store({ name: 'pioneering-app-store' })

// 主进程持有的后端 baseURL，由渲染端通过 IPC 同步。
// 解决原 APP_NETWORK_CHECK 直接读 process.env['VITE_API_BASE_URL']（主进程不加载
// Vite env，永远 fallback 默认值）导致与渲染端 apiClient.baseURL 脱钩的问题。
// 默认值与渲染端 client.ts 的 DEFAULT_BASE_URL 保持一致。
// 用 127.0.0.1 而非 localhost，绕开 Windows IPv6 解析问题（详见 client.ts 注释）。
// 端口 8088：避开 Chromium 不安全端口黑名单（6000 是 X11 端口，会被 ERR_UNSAFE_PORT 拦截）。
let backendBaseUrl =
  process.env['VITE_API_BASE_URL'] ?? 'http://127.0.0.1:8088'

// H2: 经对话框选择、允许读写的用户路径集合（命中即视为白名单成员）。
// 文档要求「用户经对话框选定路径」也应放行，这里在打开/保存对话框返回后记录。
const userAllowedPaths = new Set<string>()

// H3: 文件读写允许的根目录白名单（仅用户数据/常用用户目录，禁止任意绝对路径）。
function getAllowedRoots(): string[] {
  return [
    app.getPath('userData'),
    app.getPath('documents'),
    app.getPath('downloads'),
    app.getPath('desktop'),
    app.getPath('pictures'),
    app.getPath('music'),
    app.getPath('videos'),
    app.getPath('temp')
  ]
}

// H3: 文件读取/写入的最大字节数（10MB），防止超大文件占满内存（P1）。
const MAX_FILE_BYTES = 10 * 1024 * 1024

// 基础路径安全检查：非空、长度受限、禁止空字节与 '..' 目录遍历
function isValidFilePath(filePath: string): boolean {
  if (typeof filePath !== 'string' || !filePath || filePath.length > 4096) return false
  if (filePath.includes('\0')) return false
  return !filePath.split(/[\\/]/).includes('..')
}

// H2: 校验 IPC 调用方是否为可信任的渲染上下文。
// 仅允许来自本地 file://（生产 loadFile）、app://（自定义协议）或
// 本地回环地址（localhost / 127.0.0.1 / [::1]）开发服务器的 frame 发起的调用；
// 其余（如被注入的远程 frame）一律拒绝。
//
// S1/S6 修复：原正则 /^https?:\/\/localhost(:\d+)?\b/i 中的 \b 对
// "localhost.evil.com" 命中（. 是非单词字符），导致攻击者注册该域名即可绕过。
// 改为严格匹配主机名后紧跟端口、路径分隔或字符串结尾，并补充 127.0.0.1 / [::1]。
const TRUSTED_HOST_PATTERN =
  /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i

function isTrustedSender(
  event: { senderFrame?: Electron.WebFrameMain | null }
): boolean {
  const frame = event.senderFrame
  if (!frame) return false
  const url = frame.url
  return /^file:\/\//i.test(url) || /^app:\/\//i.test(url) || TRUSTED_HOST_PATTERN.test(url)
}

// H3: 路径白名单校验。先 path.resolve 归一化，再用 realpathSync 解析符号链接
// （防止通过软链逃逸白名单），最后判断是否落在允许根目录内或命中用户选定路径。
//
// S4 修复：原实现在 realpathSync 失败（文件尚不存在，写操作场景）时直接回退到
// 未解析路径做前缀校验。若用户在白名单目录下放置指向敏感目录的符号链接，
// 写入 ~/Documents/evil/payload 时 realpathSync 解析到 evil 级失败，回退前缀校验
// 仍认为落在 documents 内，实际写入 /etc/payload。
// 修复策略：realpathSync 失败时，逐级向上对已存在的父目录做 realpathSync，
// 找到最近的可解析祖先真实路径，再拼接剩余子路径，对最终路径做白名单校验。
function isPathAllowed(filePath: string, allowedRoots: string[]): boolean {
  let resolved: string
  try {
    resolved = path.resolve(filePath)
  } catch {
    return false
  }
  try {
    resolved = realpathSync(resolved)
  } catch {
    // 文件尚不存在（写操作）或无法解析：逐级向上解析父目录的真实路径
    resolved = resolveWithParentRealpath(resolved)
  }
  const rawResolved = path.resolve(filePath)
  if (userAllowedPaths.has(resolved) || userAllowedPaths.has(rawResolved)) return true
  return allowedRoots.some((root) => {
    const r = path.resolve(root)
    return resolved === r || resolved.startsWith(r + path.sep)
  })
}

// S4 辅助：当目标路径本身无法 realpathSync（尚不存在）时，逐级向上找到最近
// 可解析的祖先目录的真实路径，再拼接剩余子路径段，得到尽可能真实的最终路径。
function resolveWithParentRealpath(targetPath: string): string {
  const segments: string[] = []
  let current = targetPath
  // 向上逐级尝试，最多 40 层防止异常循环
  for (let i = 0; i < 40; i++) {
    try {
      const real = realpathSync(current)
      // 找到可解析祖先，拼接之前累积的子路径段
      return segments.length > 0 ? path.join(real, ...segments.reverse()) : real
    } catch {
      segments.push(path.basename(current))
      const parent = path.dirname(current)
      if (parent === current) {
        // 到达根目录仍无法解析，返回原始 resolve 结果
        return targetPath
      }
      current = parent
    }
  }
  return targetPath
}

// H6: 通过 JSON 往返重建纯对象，剥离 __proto__ / constructor 等原型链污染载体。
// 渲染端传入的任意对象经结构化克隆存入 Map 前先净化，杜绝原型链污染。
function sanitizeValue(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}

// E1: 归一化文件操作错误，避免把 ErrnoException 的完整信息（含绝对路径、
// 权限细节）回传给渲染端并展示，造成信息泄露。仅映射常见错误码，其余给通用文案。
function normalizeFileError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code
  switch (code) {
    case 'ENOENT':
      return '文件不存在'
    case 'EACCES':
    case 'EPERM':
      return '没有访问权限'
    case 'EISDIR':
      return '目标是一个目录，不是文件'
    case 'ENOTDIR':
      return '路径中的某一段不是目录'
    case 'EMFILE':
    case 'ENFILE':
      return '系统打开文件数过多，请稍后重试'
    default:
      return '文件读写失败'
  }
}

export function registerIpcHandlers(): void {
  const allowedRoots = getAllowedRoots()

  // ---- 窗口控制 ----
  ipcMain.handle(IpcChannel.WINDOW_MINIMIZE, (event) => {
    if (!isTrustedSender(event)) return
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle(IpcChannel.WINDOW_MAXIMIZE, (event) => {
    if (!isTrustedSender(event)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.handle(IpcChannel.WINDOW_CLOSE, (event) => {
    if (!isTrustedSender(event)) return
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle(IpcChannel.WINDOW_IS_MAXIMIZED, (event) => {
    if (!isTrustedSender(event)) return false
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  ipcMain.handle(IpcChannel.WINDOW_TOGGLE_FULLSCREEN, (event) => {
    if (!isTrustedSender(event)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.setFullScreen(!win.isFullScreen())
    }
  })

  ipcMain.handle(IpcChannel.WINDOW_TOGGLE_DEVTOOLS, (event) => {
    if (!isTrustedSender(event)) return
    BrowserWindow.fromWebContents(event.sender)?.webContents.toggleDevTools()
  })

  // ---- 应用信息 ----
  ipcMain.handle(IpcChannel.APP_GET_VERSION, (event) => {
    if (!isTrustedSender(event)) return ''
    return app.getVersion()
  })

  ipcMain.handle(IpcChannel.APP_GET_PLATFORM, (event) => {
    if (!isTrustedSender(event)) return ''
    return process.platform
  })

  ipcMain.handle(IpcChannel.APP_QUIT, (event) => {
    if (!isTrustedSender(event)) return
    app.quit()
  })

  // 检查更新：当前未接入自动更新器，仅回传版本号供 UI 提示
  ipcMain.handle(IpcChannel.APP_CHECK_UPDATE, (event) => {
    if (!isTrustedSender(event)) return ''
    return app.getVersion()
  })

  // 网络检测：探测后端可达性（5s 超时）
  // 使用主进程持有的 backendBaseUrl（由渲染端经 APP_SET_API_BASE_URL 同步），
  // 不再读 process.env['VITE_API_BASE_URL']，确保与渲染端 apiClient.baseURL 一致。
  // localhost → 127.0.0.1，绕开 Windows IPv6 解析问题。
  // 旧端口（6000/8787）→ 8088，迁移到当前安全端口（6000 是 Chromium 黑名单端口）。
  ipcMain.handle(IpcChannel.APP_NETWORK_CHECK, async (event) => {
    if (!isTrustedSender(event)) return false
    const base = backendBaseUrl
      .replace(/\/+$/, '')
      .replace(/^(https?:\/\/)localhost(?=[:\/]|$)/i, '$1127.0.0.1')
      .replace(/^(https?:\/\/127\.0\.0\.1):6000(?=[:\/]|$)/i, '$1:8088')
      .replace(/^(https?:\/\/127\.0\.0\.1):8787(?=[:\/]|$)/i, '$1:8088')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      // TS 后端使用 /health 而非 /ping
      const res = await fetch(`${base}/health`, { signal: controller.signal })
      return res.ok
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  })

  // 渲染端同步后端 baseURL 到主进程，供 APP_NETWORK_CHECK 使用。
  // 同时持久化到 appStore，使主进程在后续重启中也能恢复（best-effort）。
  ipcMain.handle(
    IpcChannel.APP_SET_API_BASE_URL,
    (event, url: string): boolean => {
      if (!isTrustedSender(event)) return false
      if (typeof url !== 'string' || !url.trim()) return false
      // 仅允许 http(s) 协议，防止 file:// / javascript: 等注入
      if (!/^https?:\/\//i.test(url)) return false
      backendBaseUrl = url.trim()
      return true
    }
  )

  // 打开日志目录
  ipcMain.handle(IpcChannel.APP_OPEN_LOG_DIR, (event) => {
    if (!isTrustedSender(event)) return ''
    return shell.openPath(app.getPath('logs'))
  })

  // ---- 文件系统 ----
  ipcMain.handle(
    IpcChannel.FILE_OPEN_DIALOG,
    async (event, options: FileDialogOptions): Promise<FileDialogResult> => {
      if (!isTrustedSender(event)) return { canceled: true, filePaths: [] }
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { canceled: true, filePaths: [] }

      const dialogOptions: OpenDialogOptions = {
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters,
        properties: options.properties as OpenDialogOptions['properties']
      }
      const result = await dialog.showOpenDialog(win, dialogOptions)
      // H3/H2: 记录用户选定的路径，后续 FILE_READ/WRITE 命中即放行。
      if (!result.canceled) {
        for (const p of result.filePaths) userAllowedPaths.add(path.resolve(p))
      }
      return result
    }
  )

  ipcMain.handle(
    IpcChannel.FILE_SAVE_DIALOG,
    async (event, options: FileDialogOptions): Promise<FileDialogResult> => {
      if (!isTrustedSender(event)) return { canceled: true, filePaths: [] }
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { canceled: true, filePaths: [] }

      const dialogOptions: SaveDialogOptions = {
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters
      }
      const result = await dialog.showSaveDialog(win, dialogOptions)
      // H3/H2: 记录用户选定的保存路径，后续 FILE_WRITE 命中即放行。
      if (!result.canceled && result.filePath) {
        userAllowedPaths.add(path.resolve(result.filePath))
      }
      return {
        canceled: result.canceled,
        filePaths: result.filePath ? [result.filePath] : []
      }
    }
  )

  ipcMain.handle(
    IpcChannel.FILE_READ,
    async (event, filePath: string): Promise<FileReadResult> => {
      // H2: 调用方校验
      if (!isTrustedSender(event)) return { success: false, error: 'Forbidden: untrusted sender' }
      // H3: 路径格式 + 白名单（含符号链接解析）
      if (!isValidFilePath(filePath) || !isPathAllowed(filePath, allowedRoots)) {
        return { success: false, error: 'Invalid or disallowed file path' }
      }
      try {
        // H3/P1: 大小上限，避免读取超大文件占满内存
        const info = await stat(filePath)
        if (info.size > MAX_FILE_BYTES) {
          return { success: false, error: 'File exceeds maximum allowed size' }
        }
        const content = await readFile(filePath, 'utf-8')
        return { success: true, content }
      } catch (err) {
        return { success: false, error: normalizeFileError(err) }
      }
    }
  )

  ipcMain.handle(
    IpcChannel.FILE_WRITE,
    async (event, req: FileWriteRequest): Promise<FileReadResult> => {
      // H2: 调用方校验
      if (!isTrustedSender(event)) return { success: false, error: 'Forbidden: untrusted sender' }
      // H3: 路径格式 + 白名单（含符号链接解析）
      if (
        !req ||
        typeof req.filePath !== 'string' ||
        typeof req.content !== 'string' ||
        !isValidFilePath(req.filePath) ||
        !isPathAllowed(req.filePath, allowedRoots)
      ) {
        return { success: false, error: 'Invalid file path or content' }
      }
      // H3/P1: 内容大小上限（B5 修复：原用 req.content.length 是 UTF-16 代码单元数，
      // 与 MAX_FILE_BYTES 字节数单位不一致，多字节字符实际字节数可达 length*4 突破上限。
      // 改用 Buffer.byteLength 按 UTF-8 编码计算真实字节数，与 FILE_READ 的 stat().size 单位一致）
      if (Buffer.byteLength(req.content, 'utf-8') > MAX_FILE_BYTES) {
        return { success: false, error: 'Content exceeds maximum allowed size' }
      }
      try {
        await writeFile(req.filePath, req.content, req.encoding ?? 'utf-8')
        return { success: true }
      } catch (err) {
        return { success: false, error: normalizeFileError(err) }
      }
    }
  )

  ipcMain.handle(IpcChannel.FILE_GET_PATH, (event, name: UserDataPath) => {
    if (!isTrustedSender(event)) return ''
    return app.getPath(name)
  })

  // 在系统文件管理器中显示路径（会话操作菜单「打开文件夹」/ 产物卡片）。
  // 安全：仅允许展示应用自身数据目录内的路径（userData 与开发态 ~/.pioneering），
  // 无参数时直接打开 userData 目录。禁止传入任意自由路径，防止渲染端被攻陷后
  // 诱导用户在文件管理器中定位任意文件。
  ipcMain.handle(IpcChannel.FILE_SHOW_IN_FOLDER, (event, filePath?: string) => {
    if (!isTrustedSender(event)) return false
    const allowedRoots = [
      app.getPath('userData'),
      path.join(os.homedir(), '.pioneering') // 开发态 backend 独立启动时的文档根（env.ts 默认）
    ]
    if (typeof filePath !== 'string' || !filePath.trim()) {
      void shell.openPath(allowedRoots[0])
      return true
    }
    const resolved = path.resolve(filePath)
    const insideAllowed = allowedRoots.some(
      (root) => resolved === root || resolved.startsWith(root + path.sep),
    )
    if (!insideAllowed) {
      return false
    }
    shell.showItemInFolder(resolved)
    return true
  })

  // ---- 通知 ----
  ipcMain.handle(IpcChannel.NOTIFICATION_SHOW, (event, options: NotificationOptions) => {
    if (!isTrustedSender(event)) return
    if (Notification.isSupported()) {
      const notif = new Notification({
        title: options.title,
        body: options.body,
        urgency: options.urgency as 'normal' | 'critical' | 'low'
      })
      notif.show()
    }
  })

  // ---- 剪贴板 ----
  ipcMain.handle(IpcChannel.CLIPBOARD_WRITE, (event, text: string) => {
    // H2: 调用方校验，避免被攻陷的渲染端任意写剪贴板
    if (!isTrustedSender(event)) return
    clipboard.writeText(text)
  })

  ipcMain.handle(IpcChannel.CLIPBOARD_READ, (event) => {
    if (!isTrustedSender(event)) return ''
    return clipboard.readText()
  })

  // ---- 外部链接 ----
  // H9（保持）：仅允许 http/https，避免 file:// / javascript: 等危险协议。
  // 该实现已属良好实践，不做修改，仅保留作为安全基线锚点。
  ipcMain.handle(IpcChannel.SHELL_OPEN_EXTERNAL, (event, url: string) => {
    if (!isTrustedSender(event)) return
    // 仅允许 http/https，避免 file:// 等危险协议
    if (!/^https?:\/\//i.test(url)) return
    return shell.openExternal(url)
  })

  // ---- Store 持久化 ----
  // H6: 写入前对 value 做深度清洗，杜绝原型链污染；读取返回净化副本，避免回传内部引用。
  ipcMain.handle(IpcChannel.STORE_GET, (event, key: string) => {
    if (!isTrustedSender(event)) return undefined
    return sanitizeValue(appStore.get(key))
  })

  ipcMain.handle(IpcChannel.STORE_SET, (event, key: string, value: unknown) => {
    if (!isTrustedSender(event)) return false
    // B6 修复：原实现 sanitizeValue 失败返回 undefined，但仍 appStore.set(key, undefined)
    // 并返回 true，渲染端误以为写入成功。改为校验净化结果，失败时拒绝写入并返回 false。
    // 注意：合法的 null/undefined 值需要放行（用户可能显式存储 null）。
    if (value === undefined) return false
    const sanitized = sanitizeValue(value)
    if (sanitized === undefined && value !== null) {
      return false
    }
    appStore.set(key, sanitized)
    return true
  })

  ipcMain.handle(IpcChannel.STORE_DELETE, (event, key: string) => {
    if (!isTrustedSender(event)) return false
    appStore.delete(key)
    return true
  })

  // ---- 健康检查 ----
  ipcMain.handle(IpcChannel.PING, (event) => {
    if (!isTrustedSender(event)) return ''
    return 'pong'
  })

  // ---- Agent 本地运行时（云边双模阶段 1）----
  // 语义逐条对齐 backend-ts routes/agent.ts 的 REST 端点；
  // 流式事件不走 invoke 返回值，而由主进程经 AGENT_EVENT 主动推送。

  // 首次使用前加载 Agent 运行环境变量（LLM key 等）。
  // 候选路径：desktop 自身 .env 优先，开发态回退到 backend-ts 的 .env。
  function ensureAgentRuntimeEnv(): void {
    const appPath = app.getAppPath()
    ensureAgentEnv(
      [path.join(appPath, '.env'), path.resolve(appPath, '../backend-ts/.env')],
      (p) => readFileSync(p, 'utf-8'),
    )
  }

  // AGENT_SEND：启动一次 Agent 流式执行（对齐 POST /agent/completions stream 分支）
  ipcMain.handle(
    IpcChannel.AGENT_SEND,
    (event, payload: AgentRunRequestPayload<unknown>): { ok: boolean; error?: string } => {
      if (!isTrustedSender(event)) return { ok: false, error: 'Forbidden: untrusted sender' }
      if (!payload || typeof payload !== 'object' || typeof payload.runId !== 'string') {
        return { ok: false, error: 'Invalid payload' }
      }
      const request = validateSendRequest(payload.request)
      if (!request) {
        return { ok: false, error: 'Invalid request' }
      }
      ensureAgentRuntimeEnv()
      return startSend(event.sender as AgentEventSender, payload.runId, request)
    },
  )

  // AGENT_RESUME：恢复被 interrupt 暂停的 run（对齐 POST /agent/resume）
  ipcMain.handle(
    IpcChannel.AGENT_RESUME,
    (event, payload: AgentRunRequestPayload<unknown>): { ok: boolean; error?: string } => {
      if (!isTrustedSender(event)) return { ok: false, error: 'Forbidden: untrusted sender' }
      if (!payload || typeof payload !== 'object' || typeof payload.runId !== 'string') {
        return { ok: false, error: 'Invalid payload' }
      }
      const request = validateResumeRequest(payload.request)
      if (!request) {
        return { ok: false, error: 'Invalid request' }
      }
      ensureAgentRuntimeEnv()
      return startResume(event.sender as AgentEventSender, payload.runId, request)
    },
  )

  // AGENT_ABORT：中止/拒绝 HITL 待答复项（对齐 POST /agent/abort）
  ipcMain.handle(
    IpcChannel.AGENT_ABORT,
    (
      event,
      payload: { sessionId: string; reason?: AbortRequest['reason'] },
    ): Promise<{ message: string; aborted: boolean; error?: string }> => {
      if (!isTrustedSender(event)) {
        return Promise.resolve({ message: 'Forbidden: untrusted sender', aborted: false })
      }
      if (!payload || typeof payload.sessionId !== 'string' || !payload.sessionId) {
        return Promise.resolve({ message: 'Invalid payload', aborted: false })
      }
      const reason = payload.reason ?? 'user_cancel'
      return abortPending(payload.sessionId, reason)
    },
  )

  // AGENT_STATE：查询待答复 HITL 状态（对齐 GET /agent/state/:threadId）
  ipcMain.handle(
    IpcChannel.AGENT_STATE,
    (event, threadId: string): Promise<HitlStateResponse> => {
      if (!isTrustedSender(event)) {
        return Promise.resolve({ session_id: String(threadId ?? ''), pending: false })
      }
      if (typeof threadId !== 'string' || !threadId) {
        return Promise.resolve({ session_id: '', pending: false })
      }
      return getHitlState(threadId)
    },
  )

  // AGENT_STOP：停止该会话进行中的本地流（对齐 POST /agent/completions/stop）
  ipcMain.handle(
    IpcChannel.AGENT_STOP,
    (event, sessionId: string): { message: string; aborted: boolean } => {
      if (!isTrustedSender(event)) return { message: 'Forbidden: untrusted sender', aborted: false }
      if (typeof sessionId !== 'string' || !sessionId) {
        return { message: 'Invalid payload', aborted: false }
      }
      return stopRun(sessionId)
    },
  )

  // 渲染端销毁（刷新/关闭）时中止其在途的本地 run，避免僵尸 LLM 调用。
  // 复用下方既有的 browser-window-created 钩子注册时机之外单独监听，
  // 保证与拖拽状态清理互不影响。
  app.on('browser-window-created', (_event, win) => {
    win.webContents.once('destroyed', () => {
      abortRunsForSender(win.webContents as unknown as AgentEventSender)
    })
  })

  // ---- 窗口拖拽 ----
  // 使用 fire-and-forget send/on 模式，避免 invoke 的往返延迟
  // M5: 以 webContents.id 为 key 维护拖拽状态，避免多窗口下 A 窗口拖拽被
  // B 窗口事件覆盖（原实现为模块级单例，多窗口会“串味”）。当前单窗口仍完全兼容。
  const dragStates = new Map<number, { offsetX: number; offsetY: number }>()
  const dragTargets = new Map<number, BrowserWindow>()

  ipcMain.on(IpcChannel.WINDOW_DRAG_START, (event, data: { screenX: number; screenY: number }) => {
    if (!isTrustedSender(event)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const [winX, winY] = win.getPosition()
    const id = event.sender.id
    dragTargets.set(id, win)
    dragStates.set(id, {
      offsetX: data.screenX - (winX ?? 0),
      offsetY: data.screenY - (winY ?? 0)
    })
  })

  ipcMain.on(IpcChannel.WINDOW_DRAG_MOVE, (event, data: { screenX: number; screenY: number }) => {
    // P5: 校验坐标有限性，避免非有限值造成的异常/轻微 DoS
    if (!isTrustedSender(event)) return
    const id = event.sender.id
    const dragTarget = dragTargets.get(id)
    const dragState = dragStates.get(id)
    if (!dragTarget || !dragState) return
    if (!Number.isFinite(data.screenX) || !Number.isFinite(data.screenY)) return

    let targetX = Math.round(data.screenX - dragState.offsetX)
    let targetY = Math.round(data.screenY - dragState.offsetY)

    // 仅约束顶部：窗口向上拖动时不超出当前显示器工作区顶部，
    // 避免标题栏完全移出屏幕导致无法抓回。
    // 左/右/下方向不做约束，与原生窗口可移出屏幕的行为保持一致。
    // 多显示器：用 getDisplayMatching 取窗口当前所在显示器，
    // 其 workArea.y 可能为负（上方副屏），此时允许继续上移。
    const display = screen.getDisplayMatching(dragTarget.getBounds())
    const minY = display.workArea.y
    if (targetY < minY) targetY = minY

    dragTarget.setPosition(targetX, targetY)
  })

  ipcMain.on(IpcChannel.WINDOW_DRAG_END, (event) => {
    if (!isTrustedSender(event)) return
    const id = event.sender.id
    dragTargets.delete(id)
    dragStates.delete(id)
  })

  // B13 修复：原实现仅在 WINDOW_DRAG_END 时清理 dragStates/dragTargets，
  // 若用户在拖拽中关闭窗口，对应 entry 永不释放，造成内存泄漏。
  // 监听每个新建窗口的 closed 事件，清理对应的拖拽状态。
  app.on('browser-window-created', (_event, win) => {
    // B13 修复：窗口创建时 webContents 仍存活，立即捕获其 id。
    // closed 事件触发时 webContents 已被销毁，此时再访问会抛
    // "Object has been destroyed"（?. 无法拦截会抛错的 getter）。
    let id: number | undefined
    try {
      id = win.webContents?.id
    } catch {
      id = undefined
    }
    win.on('closed', () => {
      if (id !== undefined) {
        dragTargets.delete(id)
        dragStates.delete(id)
      }
    })
  })
}
