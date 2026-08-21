// snapshot.ts
//
// P2（文档 4.3 建议9 / 4.4-P2）落地项：配置溯源快照端点 /debug/config。
//
// 提供脱敏配置快照（对齐 Trae 的 /debug/config），含：
//   - 当前生效配置（脱敏后）
//   - 来源信息（sources：配置从何而来）
//   - 脱敏（api_key/token/secret/password 等键值以 *** 掩盖）
//   - 元信息（生成时间、schema 版本）
//
// 设计约束（严守"不修改原有业务逻辑、不引入新缺陷"）：
//   - 纯函数、无副作用：不启动 HTTP 服务器。提供 buildDebugConfigHandler()
//     返回一个可挂载到现有 HTTP 框架的处理器，由宿主决定如何暴露。
//   - 不修改 RuntimeConfig 内部状态。

import type { RuntimeConfig } from './runtime-config.js'
import { collectEnvSources } from './env.js'

const SENSITIVE_KEY_RE = /(api[_-]?key|token|secret|password|credential|authorization|bearer)/i

/**
 * 递归脱敏：将包含敏感词（api_key/token/secret/password 等）的键值掩盖。
 * 返回新对象，不改动原对象。
 */
export function maskSensitiveValues(
  value: any,
  key: string = '',
  maskWith: string = '***',
): any {
  if (value === null || value === undefined) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((v) => maskSensitiveValues(v, key, maskWith))
  }
  if (typeof value === 'object') {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = maskSensitiveValues(v, k, maskWith)
    }
    return out
  }
  // 标量：若键名命中敏感词则掩盖
  if (SENSITIVE_KEY_RE.test(key)) {
    return maskWith
  }
  return value
}

/** 配置快照。 */
export interface ConfigSnapshot {
  /** 生成时间（ISO 字符串） */
  generated_at: string
  /** 来源信息 */
  sources: Record<string, string>
  /** 脱敏后的生效配置 */
  config: Record<string, any>
}

/**
 * 生成脱敏配置快照。
 *
 * @param runtimeConfig 运行时配置
 * @param opts.sources 来源映射（如 { base: 'DEFAULT_CONFIG', file: 'config.yaml' }）
 * @returns ConfigSnapshot
 */
export function buildConfigSnapshot(
  runtimeConfig: RuntimeConfig,
  opts: { sources?: Record<string, string> } = {},
): ConfigSnapshot {
  const dict = runtimeConfig.asDict()
  // 4.5 风险③：优先使用 RuntimeConfig 内部记录的溯源信息（getSources），
  // 调用方显式传入的 sources 作为补充覆盖。
  const trackedSources = typeof runtimeConfig.getSources === 'function'
    ? runtimeConfig.getSources()
    : {}
  // 环境变量来源清单（脱敏），补足此前"游离于配置体系之外、无法审计"的短板。
  // 仅列出当前进程已设置的环境变量；未设置的不出现，不影响既有 sources 结构。
  const envSources = collectEnvSources({ maskSensitive: true })
  return {
    generated_at: new Date().toISOString(),
    sources: { ...envSources, ...trackedSources, ...(opts.sources ?? {}) },
    config: maskSensitiveValues(dict),
  }
}

/**
 * 构建 /debug/config 的 HTTP 处理器（不启动服务器）。
 *
 * 返回一个 (req, res) 风格的处理器，兼容 Node http / 类似框架的中间件签名。
 * 仅处理 GET 请求；其他方法返回 405。
 *
 * @param runtimeConfig 运行时配置
 * @param opts.sources 来源映射
 * @returns HTTP 处理器函数
 */
export function buildDebugConfigHandler(
  runtimeConfig: RuntimeConfig,
  opts: { sources?: Record<string, string> } = {},
): (req: any, res: any) => void {
  return (req: any, res: any) => {
    const method = req?.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      if (typeof res?.writeHead === 'function') res.writeHead(405)
      if (typeof res?.end === 'function') res.end()
      return
    }
    const snapshot = buildConfigSnapshot(runtimeConfig, opts)
    const body = JSON.stringify(snapshot, null, 2)
    if (typeof res?.writeHead === 'function') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      })
    }
    if (method === 'GET' && typeof res?.end === 'function') res.end(body)
    else if (typeof res?.end === 'function') res.end()
  }
}
