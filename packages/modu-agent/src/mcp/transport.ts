// 对应 Python: mcp/transport.py
// MCP 传输层抽象与实现。
//
// 封装 stdio / SSE 两种 MCP 传输协议，
// 使上层 MCPSession 无需感知底层传输细节。
//
// 设计原则：
//   - 所有传输方式实现统一的 request / notify 接口
//   - 异步优先（Promise），与 LangGraph 的 astream 一致
//   - 单个传输失败不影响其他传输
//
// TS 版使用 @modelcontextprotocol/sdk 的 StdioClientTransport / SSEClientTransport / Client。
// SDK 的 Client.connect() 内部完成 MCP 握手（initialize → initialized），
// 因此 Transport.connect() 即包含握手，MCPSession 无需再手动发送 initialize 通知。

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js'
import { MCPConnectionError, MCPProtocolError } from './errors.js'

/** MCP 握手默认超时（毫秒）。 */
const _DEFAULT_CONNECT_TIMEOUT_MS = 30_000

/**
 * P1-22：统一的"握手 + 超时 + 失败清理"助手，stdio/SSE/WS 三传输复用。
 *
 * - doConnect 超过 timeoutMs 未完成 → 抛 MCPConnectionError 并调用 cleanup 回收资源
 *   （spawned 子进程 / 打开的 HTTP、WS 连接），杜绝悬挂；
 * - doConnect 自身抛错时同样走 cleanup，错误原样上抛；
 * - timeoutMs <= 0 时不设超时（仅在显式配置时使用）。
 */
export async function connectWithTimeout(
  label: string,
  timeoutMs: number,
  doConnect: () => Promise<unknown>,
  cleanup: () => Promise<void>,
): Promise<void> {
  if (!(timeoutMs > 0)) {
    await doConnect()
    return
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new MCPConnectionError(`MCP ${label} handshake timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
  })

  try {
    await Promise.race([doConnect(), timeoutPromise])
  } catch (e) {
    await cleanup().catch(() => undefined)
    throw e
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[mcp] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[mcp] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[mcp] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[mcp] ${msg}`, ...args),
}

/**
 * MCP 传输层抽象基类。
 *
 * 所有传输方式实现统一的 request / notify 接口，
 * 使上层 MCPSession 无需感知底层传输细节。
 *
 * 对应 Python Transport ABC。
 */
export abstract class Transport {
  /** 建立传输连接（含 MCP 握手）。 */
  abstract connect(): Promise<void>

  /** 断开传输连接。 */
  abstract disconnect(): Promise<void>

  /**
   * 发送 JSON-RPC 请求并等待响应。
   *
   * @param method - MCP 方法名（如 `tools/list`、`tools/call`）
   * @param params - 方法参数
   * @returns JSON-RPC 响应的 `result` 字段
   * @throws MCPProtocolError Server 返回 JSON-RPC error
   */
  abstract request(method: string, params: Record<string, any>): Promise<Record<string, any>>

  /**
   * 发送 JSON-RPC 通知（无响应）。
   *
   * @param method - MCP 方法名
   * @param params - 方法参数
   */
  abstract notify(method: string, params: Record<string, any>): Promise<void>

  /** 是否已连接。 */
  abstract get connected(): boolean

  /**
   * P1-23：注册"意外断连"回调（远端关闭连接/进程退出/传输错误）。
   * 由上层（MCPSession）注册以把连接标记为失活；主动 disconnect 不触发回调。
   */
  onUnexpectedClose(handler: () => void): void {
    this._unexpectedCloseHandler = handler
  }

  /** P1-23：意外断连回调（null=未注册）。 */
  private _unexpectedCloseHandler: (() => void) | null = null
  /** P1-23：主动 disconnect 期间抑制断连回调。 */
  protected _intentionalClose = false

  /** P1-23：触发意外断连通知（主动关闭不触发）；连接状态由子类/会话侧收敛。 */
  protected _fireUnexpectedClose(): void {
    if (this._intentionalClose) return
    logger.warning('MCP transport closed unexpectedly')
    try {
      this._unexpectedCloseHandler?.()
    } catch (e) {
      logger.warning('MCP unexpected-close handler failed: %s', String(e))
    }
  }

  /**
   * P1-23：链接 SDK 传输的 onclose（保留 SDK 既有回调并在其后触发本层失活通知）。
   * 必须在 Client.connect 成功**之后**调用——connect 会给 transport.onclose 赋值，
   * 事后链接才能同时保留 SDK 行为与本层钩子。
   */
  protected _wireSdkLifecycleHooks(sdkTransport: {
    onclose?: () => void
    onerror?: (error: Error) => void
  }): void {
    const prevClose = sdkTransport.onclose?.bind(sdkTransport)
    sdkTransport.onclose = () => {
      try {
        prevClose?.()
      } finally {
        this._fireUnexpectedClose()
      }
    }
    const prevError = sdkTransport.onerror?.bind(sdkTransport)
    sdkTransport.onerror = (error: Error) => {
      // 多数致命传输错误随后会触发 onclose 收敛状态；这里只透传+留痕，不重复改状态
      logger.warning('MCP transport onerror: %s', String(error))
      try {
        prevError?.(error)
      } catch {
        // 忽略 SDK 旧回调异常
      }
    }
  }
}

/**
 * 替换 env 中的 `${VAR}` 为环境变量值。
 *
 * 未找到的环境变量保留原样（与 shell 行为一致）。
 *
 * 对应 Python _resolve_env。
 */
function resolveEnv(env: Record<string, string>): Record<string, string> {
  const pattern = /\$\{(\w+)\}/g
  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = value.replace(pattern, (match, varName: string) =>
      process.env[varName] ?? match,
    )
  }
  return resolved
}

/**
 * stdio 传输：通过子进程 stdin/stdout 通信。
 *
 * 最常用的 MCP 传输方式，Server 作为子进程运行。
 * 使用 JSON-RPC over newline-delimited stdio 协议。
 *
 * TS 版内部使用 @modelcontextprotocol/sdk 的 StdioClientTransport + Client。
 *
 * 对应 Python StdioTransport。
 */
export class StdioTransport extends Transport {
  private _command: string
  private _args: string[]
  private _env: Record<string, string>
  private _cwd: string | null
  /** 握手（connect）超时时间，毫秒；0 表示不限制。 */
  private _connectTimeoutMs: number
  private _sdkTransport: StdioClientTransport | null = null
  private _client: Client | null = null
  private _connected: boolean = false

  constructor(
    command: string,
    args: string[] | null = null,
    env: Record<string, string> | null = null,
    cwd: string | null = null,
    connectTimeoutMs: number = _DEFAULT_CONNECT_TIMEOUT_MS,
  ) {
    super()
    this._command = command
    this._args = args ?? []
    // 合并环境变量：当前进程环境 + 额外配置（含 ${VAR} 替换）
    // process.env 值可能为 undefined，需过滤
    const procEnv: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) procEnv[k] = v
    }
    this._env = { ...procEnv, ...resolveEnv(env ?? {}) }
    this._cwd = cwd
    this._connectTimeoutMs = connectTimeoutMs
  }

  /** 启动子进程并建立 stdin/stdout 管道（含 MCP 握手）。 */
  async connect(): Promise<void> {
    const transportOptions: Record<string, any> = {
      command: this._command,
      args: this._args,
      env: this._env,
    }
    if (this._cwd !== null) {
      transportOptions.cwd = this._cwd
    }
    this._sdkTransport = new StdioClientTransport(transportOptions as any)
    this._client = new Client(
      { name: 'moduagent', version: '0.1.0' },
      { capabilities: {} },
    )

    // P1-22：统一走 connectWithTimeout（与 SSE/WS 同一套超时+清理逻辑）
    await connectWithTimeout(
      `stdio (${this._command})`,
      this._connectTimeoutMs,
      () => (this._client as Client).connect(this._sdkTransport as StdioClientTransport),
      () => this.disconnect(),
    )
    // P1-23：握手成功后链接 SDK 传输的 onclose/onerror（子进程退出→失活）
    this._wireSdkLifecycleHooks(this._sdkTransport as unknown as { onclose?: () => void; onerror?: (e: Error) => void })
    this._connected = true
    logger.info(
      'StdioTransport connected: command=%s args=%s',
      this._command, this._args,
    )
  }

  /** 终止子进程。 */
  async disconnect(): Promise<void> {
    this._intentionalClose = true
    this._connected = false
    if (this._client) {
      try {
        await this._client.close()
      } catch (e) {
        logger.warning('StdioTransport disconnect error: %s', String(e))
      }
      this._client = null
    }
    this._sdkTransport = null
  }

  /** 发送 JSON-RPC 请求并等待响应。 */
  async request(method: string, params: Record<string, any>): Promise<Record<string, any>> {
    if (!this._connected || this._client === null) {
      throw new MCPConnectionError('StdioTransport not connected')
    }
    try {
      const result = await this._client.request(
        { method, params } as any,
        undefined as any,
      )
      return (result ?? {}) as Record<string, any>
    } catch (e) {
      if (e instanceof MCPConnectionError || e instanceof MCPProtocolError) {
        throw e
      }
      // SDK 抛出的协议错误转为 MCPProtocolError
      throw new MCPProtocolError(`MCP request '${method}' failed: ${String(e)}`)
    }
  }

  /** 发送 JSON-RPC 通知（无响应）。 */
  async notify(method: string, params: Record<string, any>): Promise<void> {
    if (!this._connected || this._client === null) {
      throw new MCPConnectionError('StdioTransport not connected')
    }
    await this._client.notification({ method, params } as any)
  }

  get connected(): boolean {
    return this._connected
  }
}

/**
 * SSE / streamable_http 传输：通过 HTTP 连接远程 Server。
 *
 * TS 版内部使用 @modelcontextprotocol/sdk 的 SSEClientTransport + Client。
 *
 * 对应 Python SSETransport。
 */
export class SSETransport extends Transport {
  private _url: string
  private _connectTimeoutMs: number
  private _sdkTransport: SSEClientTransport | null = null
  private _client: Client | null = null
  private _connected: boolean = false

  /**
   * @param url MCP Server URL
   * @param connectTimeoutMs 握手超时毫秒（P1-22：与 stdio 对齐，默认 30000ms）。
   *   注意旧版第五个参数曾以"秒"计（默认 30.0），client.ts 负责把旧配置换算为毫秒。
   */
  constructor(url: string, connectTimeoutMs: number = _DEFAULT_CONNECT_TIMEOUT_MS) {
    super()
    this._url = url
    this._connectTimeoutMs = connectTimeoutMs
  }

  /** 建立 HTTP 客户端连接（含 MCP 握手）。 */
  async connect(): Promise<void> {
    this._sdkTransport = new SSEClientTransport(new URL(this._url))
    this._client = new Client(
      { name: 'moduagent', version: '0.1.0' },
      { capabilities: {} },
    )
    // P1-22：远端不接受连接 / 挂起时按超时失败并关闭，不再无限等待
    await connectWithTimeout(
      `sse (${this._url})`,
      this._connectTimeoutMs,
      () => (this._client as Client).connect(this._sdkTransport as SSEClientTransport),
      () => this.disconnect(),
    )
    // P1-23：远端关闭 SSE 连接时标记失活
    this._wireSdkLifecycleHooks(this._sdkTransport as unknown as { onclose?: () => void; onerror?: (e: Error) => void })
    this._connected = true
    logger.info('SSETransport connected: url=%s', this._url)
  }

  /** 关闭 HTTP 客户端。 */
  async disconnect(): Promise<void> {
    this._intentionalClose = true
    this._connected = false
    if (this._client) {
      try {
        await this._client.close()
      } catch (e) {
        logger.warning('SSETransport disconnect error: %s', String(e))
      }
      this._client = null
    }
    this._sdkTransport = null
  }

  /** 发送 JSON-RPC POST 请求并等待响应。 */
  async request(method: string, params: Record<string, any>): Promise<Record<string, any>> {
    if (!this._connected || this._client === null) {
      throw new MCPConnectionError('SSETransport not connected')
    }
    try {
      const result = await this._client.request(
        { method, params } as any,
        undefined as any,
      )
      return (result ?? {}) as Record<string, any>
    } catch (e) {
      if (e instanceof MCPConnectionError || e instanceof MCPProtocolError) {
        throw e
      }
      throw new MCPProtocolError(`MCP request '${method}' failed: ${String(e)}`)
    }
  }

  /** 发送 JSON-RPC 通知。 */
  async notify(method: string, params: Record<string, any>): Promise<void> {
    if (!this._connected || this._client === null) {
      throw new MCPConnectionError('SSETransport not connected')
    }
    await this._client.notification({ method, params } as any)
  }

  get connected(): boolean {
    return this._connected
  }
}

/**
 * WebSocket 传输：通过 WebSocket 连接远程 Server（对应文档 §4.3 建议11）。
 *
 * 适用于需要双向流式通信的场景（如服务器主动推送资源更新），
 * 比 SSE 的单向流更灵活，比 stdio 的子进程模型更轻量。
 *
 * TS 版内部使用 @modelcontextprotocol/sdk 的 WebSocketClientTransport + Client。
 *
 * 运行时依赖 `ws` 包（Node.js WebSocket 实现）；
 * SDK 已将 `ws` 列为 devDependency，使用方需自行安装 `ws` 到 dependencies。
 */
export class WebSocketTransport extends Transport {
  private _url: string
  private _connectTimeoutMs: number
  private _sdkTransport: WebSocketClientTransport | null = null
  private _client: Client | null = null
  private _connected: boolean = false

  /**
   * @param url MCP WebSocket URL
   * @param connectTimeoutMs 握手超时毫秒（P1-22：与 stdio/SSE 对齐，默认 30000ms）。
   */
  constructor(url: string, connectTimeoutMs: number = _DEFAULT_CONNECT_TIMEOUT_MS) {
    super()
    this._url = url
    this._connectTimeoutMs = connectTimeoutMs
  }

  /** 建立 WebSocket 连接（含 MCP 握手）。 */
  async connect(): Promise<void> {
    this._sdkTransport = new WebSocketClientTransport(new URL(this._url))
    this._client = new Client(
      { name: 'moduagent', version: '0.1.0' },
      { capabilities: {} },
    )
    // P1-22：握手超时统一治理（旧实现无超时，连接挂起会永久卡死启动）
    await connectWithTimeout(
      `websocket (${this._url})`,
      this._connectTimeoutMs,
      () => (this._client as Client).connect(this._sdkTransport as WebSocketClientTransport),
      () => this.disconnect(),
    )
    // P1-23：服务端关闭 WS 连接时标记失活
    this._wireSdkLifecycleHooks(this._sdkTransport as unknown as { onclose?: () => void; onerror?: (e: Error) => void })
    this._connected = true
    logger.info('WebSocketTransport connected: url=%s', this._url)
  }

  /** 关闭 WebSocket 连接。 */
  async disconnect(): Promise<void> {
    this._intentionalClose = true
    this._connected = false
    if (this._client) {
      try {
        await this._client.close()
      } catch (e) {
        logger.warning('WebSocketTransport disconnect error: %s', String(e))
      }
      this._client = null
    }
    this._sdkTransport = null
  }

  /** 发送 JSON-RPC 请求并等待响应。 */
  async request(method: string, params: Record<string, any>): Promise<Record<string, any>> {
    if (!this._connected || this._client === null) {
      throw new MCPConnectionError('WebSocketTransport not connected')
    }
    try {
      const result = await this._client.request(
        { method, params } as any,
        undefined as any,
      )
      return (result ?? {}) as Record<string, any>
    } catch (e) {
      if (e instanceof MCPConnectionError || e instanceof MCPProtocolError) {
        throw e
      }
      throw new MCPProtocolError(`MCP request '${method}' failed: ${String(e)}`)
    }
  }

  /** 发送 JSON-RPC 通知。 */
  async notify(method: string, params: Record<string, any>): Promise<void> {
    if (!this._connected || this._client === null) {
      throw new MCPConnectionError('WebSocketTransport not connected')
    }
    await this._client.notification({ method, params } as any)
  }

  get connected(): boolean {
    return this._connected
  }
}
