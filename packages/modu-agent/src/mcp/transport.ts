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
import { MCPConnectionError, MCPProtocolError } from './errors.js'

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
  private _sdkTransport: StdioClientTransport | null = null
  private _client: Client | null = null
  private _connected: boolean = false

  constructor(
    command: string,
    args: string[] | null = null,
    env: Record<string, string> | null = null,
    cwd: string | null = null,
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
    await this._client.connect(this._sdkTransport)
    this._connected = true
    logger.info(
      'StdioTransport connected: command=%s args=%s',
      this._command, this._args,
    )
  }

  /** 终止子进程。 */
  async disconnect(): Promise<void> {
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
  private _timeout: number
  private _sdkTransport: SSEClientTransport | null = null
  private _client: Client | null = null
  private _connected: boolean = false

  constructor(url: string, timeout: number = 30.0) {
    super()
    this._url = url
    this._timeout = timeout
  }

  /** 建立 HTTP 客户端连接（含 MCP 握手）。 */
  async connect(): Promise<void> {
    this._sdkTransport = new SSEClientTransport(new URL(this._url))
    this._client = new Client(
      { name: 'moduagent', version: '0.1.0' },
      { capabilities: {} },
    )
    await this._client.connect(this._sdkTransport)
    this._connected = true
    logger.info('SSETransport connected: url=%s', this._url)
  }

  /** 关闭 HTTP 客户端。 */
  async disconnect(): Promise<void> {
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
