// 对应 Python: components/action/tools/http_request.py
// P3-12.3.4: HTTP 请求工具（URL 白名单 + SSRF 防护）
//
// 安全策略：
//     1. 协议限制：仅允许 http/https
//     2. SSRF 防护：拒绝内网地址（127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16）
//     3. 域名白名单：可选（allowed_domains 参数）
//     4. 方法限制：仅允许 GET/POST/PUT/DELETE/HEAD/PATCH
//     5. 超时限制：默认 30s
//     6. 响应大小限制：默认 1MB
//     7. 禁止重定向到内网
//
// 需要人工审批（requiresApproval() = true）。
import { promises as dns } from 'dns'
import { BaseTool } from '../core/interfaces/action.js'
import { inject_trace_context } from '../observability/trace-context.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[http-request] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[http-request] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[http-request] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[http-request] ${msg}`, ...args),
}

// 私有 IP 网段 CIDR（用于 SSRF 防护）
// 对应 Python _PRIVATE_NETWORKS
const _PRIVATE_CIDRS: Array<{ base: number; mask: number }> = [
  _cidrFromString('127.0.0.0/8'),
  _cidrFromString('10.0.0.0/8'),
  _cidrFromString('172.16.0.0/12'),
  _cidrFromString('192.168.0.0/16'),
  _cidrFromString('169.254.0.0/16'),  // link-local
  _cidrFromString('0.0.0.0/8'),
  _cidrFromString('100.64.0.0/10'),   // CGNAT
]

const _ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH'])
const _DEFAULT_TIMEOUT = 30
const _DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024  // 1MB

/**
 * 将 IPv4 地址转为 32 位整数。
 */
function _ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let result = 0
  for (const part of parts) {
    const n = parseInt(part, 10)
    if (isNaN(n) || n < 0 || n > 255) return null
    result = (result << 8) | n
  }
  return result >>> 0 // 无符号
}

/**
 * 将 CIDR 字符串转为 {base, mask}。
 */
function _cidrFromString(cidr: string): { base: number; mask: number } {
  const [ip, prefixStr] = cidr.split('/')
  const prefix = parseInt(prefixStr, 10)
  const base = _ipv4ToInt(ip) ?? 0
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0
  return { base, mask }
}

/**
 * 检查 IPv4 是否在 CIDR 范围内。
 */
function _ipInCidr(ipInt: number, cidr: { base: number; mask: number }): boolean {
  return (ipInt & cidr.mask) === (cidr.base & cidr.mask)
}

/**
 * P3-12.3.4: HTTP 请求工具。
 *
 * 对应 Python HttpRequestTool。
 *
 * 支持 GET/POST/PUT/DELETE/HEAD/PATCH 方法，内置 SSRF 防护与域名白名单。
 *
 * @param allowedDomains 允许的域名白名单（null=不限制，仅 SSRF 防护）
 * @param timeout 请求超时（秒）
 * @param maxResponseBytes 响应大小上限（字节）
 */
export class HttpRequestTool extends BaseTool {
  private _allowedDomains: Set<string> | null
  private _timeout: number
  private _maxResponseBytes: number

  constructor(
    allowedDomains?: string[] | null,
    timeout: number = _DEFAULT_TIMEOUT,
    maxResponseBytes: number = _DEFAULT_MAX_RESPONSE_BYTES,
  ) {
    super()
    this._allowedDomains = allowedDomains
      ? new Set(allowedDomains.map((d) => d.toLowerCase()))
      : null
    this._timeout = timeout
    this._maxResponseBytes = maxResponseBytes
  }

  name(): string {
    return 'http_request'
  }

  description(): string {
    return (
      '发起 HTTP 请求（GET/POST/PUT/DELETE），内置 SSRF 防护拒绝内网地址；' +
      '可选域名白名单'
    )
  }

  parametersSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '目标 URL（http/https）',
        },
        method: {
          type: 'string',
          description: 'HTTP 方法',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH'],
        },
        headers: {
          type: 'object',
          description: '请求头（键值对）',
        },
        body: {
          type: 'string',
          description: '请求体（POST/PUT 用）',
        },
      },
      required: ['url'],
    }
  }

  requiresApproval(): boolean {
    return true
  }

  // P4 Plan-Execute: 声明本工具提供实时/外部数据（对应文档 §4.1 建议7）
  // HTTP 请求必然返回外部实时数据，Planner 据此推断 step.requires_tool=true
  providesRealtimeData(): boolean {
    return true
  }

  /**
   * 动态敏感性判定（对应文档 §2.5 建议6）。
   *
   * HttpRequestTool 默认所有请求都需审批（requiresApproval() = true），
   * 此方法进一步细化：
   *   - URL 解析失败或指向内网 IP → 需审批（高敏感）
   *   - URL 不在域名白名单内 → 需审批
   *   - 其余情况回退到 requiresApproval()（默认 true）
   *
   * 注意：同步方法不执行 DNS 解析（避免阻塞），仅做 URL 字符串分析。
   * 实际 DNS 解析与 SSRF 防护在 invoke() 内执行。
   */
  requiresApprovalFor(
    params: Record<string, any>,
    _context: Record<string, any>,
  ): boolean {
    const url = params?.url
    if (typeof url !== 'string' || !url.trim()) {
      return true  // 无效 URL，按需审批处理
    }

    try {
      const parsed = new URL(url)
      const hostname = parsed.hostname

      // 同步检测：hostname 直接是 IP 且为内网 → 高敏感
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) && this._isPrivateIp(hostname)) {
        return true
      }
      // IPv6 loopback
      if (hostname === '::1' || hostname.startsWith('[') || hostname === 'localhost') {
        return true
      }
      // 域名白名单：若配置且 hostname 不在白名单 → 需审批
      if (this._allowedDomains !== null && !this._allowedDomains.has(hostname.toLowerCase())) {
        return true
      }
    } catch {
      // URL 解析失败，按需审批处理
      return true
    }

    // 回退到静态判定
    return this.requiresApproval()
  }

  onApprovalRejected(params: Record<string, any>): Record<string, any> {
    return {
      status: 'error',
      error_code: 'TOOL_APPROVAL_REJECTED',
      data: {
        message: 'HTTP request was rejected by the human reviewer',
        url: params.url ?? '',
      },
    }
  }

  /**
   * 检查 IP 是否为私有/内网地址（SSRF 防护）。
   * 对应 Python _is_private_ip。
   */
  private _isPrivateIp(ipStr: string): boolean {
    const ipInt = _ipv4ToInt(ipStr)
    if (ipInt === null) return false
    for (const cidr of _PRIVATE_CIDRS) {
      if (_ipInCidr(ipInt, cidr)) return true
    }
    // IPv6 loopback / ULA / link-local 简化检测
    if (ipStr === '::1' || ipStr.startsWith('fc') || ipStr.startsWith('fd') || ipStr.startsWith('fe80')) {
      return true
    }
    return false
  }

  /**
   * 解析主机名到 IP 地址列表。
   * 对应 Python _resolve_host。
   */
  private async _resolveHost(host: string): Promise<string[]> {
    try {
      const results = await dns.lookup(host, { all: true })
      return results.map((r) => r.address)
    } catch {
      return []
    }
  }

  /**
   * 校验 URL 安全性。
   * 对应 Python _validate_url。
   *
   * @returns [isValid, errorMessage]
   */
  private async _validateUrl(url: string): Promise<[boolean, string]> {
    if (!url || typeof url !== 'string') {
      return [false, 'URL is empty']
    }

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch (e) {
      return [false, `Invalid URL: ${e}`]
    }

    // 协议白名单
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return [false, `Protocol not allowed: ${parsed.protocol.replace(':', '')}`]
    }

    const hostname = parsed.hostname
    if (!hostname) {
      return [false, 'URL missing hostname']
    }

    // 域名白名单检查
    if (this._allowedDomains !== null) {
      if (!this._allowedDomains.has(hostname.toLowerCase())) {
        return [false, `Domain not in whitelist: ${hostname}`]
      }
    }

    // SSRF 防护：直接 IP 地址检查
    const ipInt = _ipv4ToInt(hostname)
    if (ipInt !== null) {
      // 是 IPv4 地址
      if (this._isPrivateIp(hostname)) {
        return [false, `Private IP not allowed: ${hostname}`]
      }
    } else {
      // 不是 IP 地址，是域名；解析后检查所有解析结果
      const ips = await this._resolveHost(hostname)
      for (const ipStr of ips) {
        if (this._isPrivateIp(ipStr)) {
          return [false, `Host resolves to private IP ${ipStr} (SSRF protection): ${hostname}`]
        }
      }
    }

    return [true, '']
  }

  async invoke(
    params: Record<string, any>,
    _context: Record<string, any>,
  ): Promise<Record<string, any>> {
    const url = params.url ?? ''
    const method = (params.method ?? 'GET').toUpperCase()
    const headers = params.headers ?? {}
    const body = params.body ?? ''

    // 1. 方法校验
    if (!_ALLOWED_METHODS.has(method)) {
      return {
        status: 'error',
        error_code: 'HTTP_001',
        data: { message: `Method not allowed: ${method}` },
      }
    }

    // 2. URL 安全校验
    const [isValid, errorMsg] = await this._validateUrl(url)
    if (!isValid) {
      logger.warning('HttpRequest rejected: %s', errorMsg)
      return {
        status: 'error',
        error_code: 'HTTP_002',
        data: { message: errorMsg },
      }
    }

    // 3. 发起请求（使用 fetch API，禁用重定向防止 SSRF 重定向绕过）
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this._timeout * 1000)

      // 对应文档 §2.4 建议2：W3C TraceContext 注入
      // 将当前 OTel span 的 traceparent + 业务层 trace_id header 注入到请求中，
      // 实现跨服务分布式追踪（tracing 未启用时 inject_trace_context 为 no-op）
      const finalHeaders: Record<string, string> =
        typeof headers === 'object' && headers !== null
          ? { ...headers }
          : {}
      inject_trace_context(finalHeaders)

      const fetchOptions: RequestInit = {
        method,
        headers: finalHeaders,
        redirect: 'manual',  // 禁用重定向
        signal: controller.signal,
      }

      if (['POST', 'PUT', 'PATCH'].includes(method) && body) {
        fetchOptions.body = body
      }

      const response = await fetch(url, fetchOptions)
      clearTimeout(timeoutId)

      // 读取响应（限制大小）
      const arrayBuffer = await response.arrayBuffer()
      const contentBytes = new Uint8Array(arrayBuffer)
      const truncated = contentBytes.length > this._maxResponseBytes
      const sliced = contentBytes.slice(0, this._maxResponseBytes)
      const text = new TextDecoder('utf-8', { fatal: false }).decode(sliced)

      // 收集响应头
      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      return {
        status: 'success',
        error_code: '',
        data: {
          status_code: response.status,
          headers: responseHeaders,
          content: text,
          content_length: sliced.length,
          truncated,
        },
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        logger.warning('HttpRequest timeout after %ds: %s', this._timeout, url)
        return {
          status: 'error',
          error_code: 'HTTP_004',
          data: { message: `Request timeout after ${this._timeout}s` },
        }
      }
      if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') {
        logger.warning('HttpRequest connect error: %s', String(e))
        return {
          status: 'error',
          error_code: 'HTTP_005',
          data: { message: `Connection error: ${e}` },
        }
      }
      logger.error('HttpRequest unexpected error: %s', String(e))
      return {
        status: 'error',
        error_code: 'HTTP_006',
        data: { message: `Unexpected error: ${e}` },
      }
    }
  }
}
