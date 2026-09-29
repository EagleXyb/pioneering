// P0（T-02）：LLM token 用量埋点（通用适配层）。
//
// 背景：`MetricsRegistry.record_llm_tokens`（observability/metrics.ts:237）实现完整，
// 但全仓零消费者 → 指标无数据源。本模块在 **LLM 适配层** 提供通用包装，
// 避免污染 graph/nodes.ts（保持"观测埋点低侵入"的既有性质）。
//
// 硬约束（默认行为零变化）：
//   - 仅当 `observability.metrics.enabled=true` 时返回包装对象；默认 false → 原样返回。
//   - 埋点失败静默降级（catch + debug），绝不影响 LLM 调用本身。
//   - 返回对象是原实例的 Proxy：`instanceof` / 属性读取 / 方法调用语义均保持，
//     `bind` / `bindTools` / `withRetry` 等链式方法照常可用（链式返回的新对象不再被埋点，
//     属可接受的降级）。

import type { RuntimeConfig } from '../../config/runtime-config.js'
import { get_metrics_registry } from '../../observability/metrics.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[graph.llm_metrics] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[graph.llm_metrics] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[graph.llm_metrics] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[graph.llm_metrics] ${msg}`, ...args),
}

const _WRAPPED_FLAG = '__modu_llm_metrics_wrapped'

interface TokenUsage {
  prompt: number
  completion: number
  total: number
}

/**
 * 从 LangChain AIMessage / 响应对象中提取 token 用量。
 *
 * 兼容三种来源（按优先级）：
 *   1. usage_metadata.{input_tokens,output_tokens,total_tokens}（LangChain 标准）
 *   2. response_metadata.tokenUsage.{promptTokens,completionTokens,totalTokens}（旧版）
 *   3. response_metadata.usage.{prompt_tokens,completion_tokens,total_tokens}
 */
export function extractTokenUsage(response: any): TokenUsage | null {
  if (!response || typeof response !== 'object') return null

  const um = response.usage_metadata
  if (um && typeof um === 'object') {
    const prompt = Number(um.input_tokens ?? 0)
    const completion = Number(um.output_tokens ?? 0)
    const total = Number(um.total_tokens ?? prompt + completion)
    if (prompt > 0 || completion > 0 || total > 0) {
      return { prompt, completion, total: total || prompt + completion }
    }
  }

  const rm = response.response_metadata
  if (rm && typeof rm === 'object') {
    const tu = rm.tokenUsage
    if (tu && typeof tu === 'object') {
      const prompt = Number(tu.promptTokens ?? tu.prompt_tokens ?? 0)
      const completion = Number(tu.completionTokens ?? tu.completion_tokens ?? 0)
      const total = Number(tu.totalTokens ?? tu.total_tokens ?? prompt + completion)
      if (prompt > 0 || completion > 0 || total > 0) {
        return { prompt, completion, total: total || prompt + completion }
      }
    }
    const usage = rm.usage
    if (usage && typeof usage === 'object') {
      const prompt = Number(usage.prompt_tokens ?? 0)
      const completion = Number(usage.completion_tokens ?? 0)
      const total = Number(usage.total_tokens ?? prompt + completion)
      if (prompt > 0 || completion > 0 || total > 0) {
        return { prompt, completion, total: total || prompt + completion }
      }
    }
  }

  return null
}

/** 读取模型名（LangChain ChatModel 的 model 字段）。 */
function _extractModel(llm: any): string {
  try {
    const m = llm?.model ?? llm?.modelName ?? llm?.model_name
    if (typeof m === 'string') return m
  } catch {
    /* ignore */
  }
  return ''
}

/**
 * 为 LLM 包装 token 用量埋点。
 *
 * @param llm           LangChain Runnable/ChatModel 实例
 * @param config        运行时配置（null 或 metrics 未启用时原样返回）
 * @param provider      Provider 标识（用于指标维度）
 * @returns 包装后的实例（未启用时为原实例）
 */
export function apply_llm_metrics(
  llm: any,
  config?: RuntimeConfig | null,
  provider?: string | null,
): any {
  if (!llm) return llm
  if (llm[_WRAPPED_FLAG]) return llm

  let enabled = false
  if (config) {
    try {
      enabled = Boolean(config.get('observability.metrics.enabled', false))
    } catch {
      enabled = false
    }
  }
  if (!enabled) {
    // 默认路径：零改动、零开销
    return llm
  }

  const model = _extractModel(llm)
  const prov = provider ?? ''

  return new Proxy(llm, {
    get(target: any, prop: string | symbol, _receiver: any): any {
      if (prop === _WRAPPED_FLAG) return true
      if (prop === 'invoke' && typeof target.invoke === 'function') {
        return async (...args: any[]): Promise<any> => {
          const response = await target.invoke(...args)
          try {
            const usage = extractTokenUsage(response)
            if (usage) {
              const reg = get_metrics_registry()
              if (usage.prompt > 0) reg.record_llm_tokens(prov, model, 'prompt', usage.prompt)
              if (usage.completion > 0) reg.record_llm_tokens(prov, model, 'completion', usage.completion)
              if (usage.total > 0) reg.record_llm_tokens(prov, model, 'total', usage.total)
            }
          } catch (e: any) {
            logger.debug('record LLM tokens failed: %s', String(e?.message ?? e))
          }
          return response
        }
      }
      // 注意：以 target 作为 receiver 读取，避免 Proxy receiver 破坏依赖私有字段的 getter
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
