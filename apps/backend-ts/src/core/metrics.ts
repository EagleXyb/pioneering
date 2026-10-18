/**
 * 后端 LLM 链路指标（P4）
 *
 * 为什么单独实现：modu-agent 的 prom-client 注册表只覆盖 Agent 侧，chat 直连
 * 路径没有指标；且 prom-client 是可选依赖，未开启时完全无观测。
 *
 * 这里维护一组进程内计数，按 Prometheus exposition 文本输出，由
 * GET /observability/metrics 与 modu-agent 的注册表文本拼接。
 *
 * 指标：
 *   pioneering_llm_requests_total{model,status}
 *   pioneering_llm_truncated_total{model}
 *   pioneering_llm_auth_errors_total{model}
 *   pioneering_llm_ttft_seconds_sum / _count
 *   pioneering_sse_disconnects_total{channel}
 */

interface Entry {
  labels: Record<string, string>
  value: number
}

class LabeledCounter {
  private readonly _entries = new Map<string, Entry>()

  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[],
  ) {}

  inc(labels: Record<string, string>, by = 1): void {
    const key = this.labelNames.map((k) => labels[k] ?? '').join('\u0000')
    const entry = this._entries.get(key)
    if (entry) {
      entry.value += by
      return
    }
    this._entries.set(key, { labels: { ...labels }, value: by })
  }

  render(): string {
    if (this._entries.size === 0) return ''
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`]
    for (const entry of this._entries.values()) {
      const labels = this.labelNames
        .map((k) => `${k}="${escapeLabel(entry.labels[k] ?? '')}"`)
        .join(',')
      lines.push(`${this.name}{${labels}} ${entry.value}`)
    }
    return lines.join('\n')
  }

  reset(): void {
    this._entries.clear()
  }
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

const requests = new LabeledCounter(
  'pioneering_llm_requests_total',
  'LLM requests by model and final status',
  ['model', 'status'],
)
const truncated = new LabeledCounter(
  'pioneering_llm_truncated_total',
  'LLM responses truncated by max output tokens',
  ['model'],
)
const authErrors = new LabeledCounter(
  'pioneering_llm_auth_errors_total',
  'LLM upstream authentication failures',
  ['model'],
)
const disconnects = new LabeledCounter(
  'pioneering_sse_disconnects_total',
  'Client disconnections observed on SSE endpoints',
  ['channel'],
)

let ttftCount = 0
let ttftSum = 0

/** 记录首 token 延迟（秒）。 */
export function recordFirstToken(seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 0) return
  ttftCount += 1
  ttftSum += seconds
}

export type LlmStatus = 'success' | 'error' | 'timeout' | 'aborted'

export interface LlmOutcome {
  status: LlmStatus
  truncated?: boolean
  authError?: boolean
}

/** 记录一次 LLM 请求的终态（每个请求只调用一次）。 */
export function recordLlmOutcome(model: string | null | undefined, outcome: LlmOutcome): void {
  const modelName = model || 'unknown'
  requests.inc({ model: modelName, status: outcome.status })
  if (outcome.truncated) truncated.inc({ model: modelName })
  if (outcome.authError) authErrors.inc({ model: modelName })
}

/** 记录一次客户端断连（HTTP 连接在流结束前被关闭）。 */
export function recordSseDisconnect(channel: 'chat' | 'agent'): void {
  disconnects.inc({ channel })
}

/** 渲染为 Prometheus exposition 文本；无数据时返回空串。 */
export function renderBackendMetrics(): string {
  const parts: string[] = []
  for (const counter of [requests, truncated, authErrors, disconnects]) {
    const text = counter.render()
    if (text) parts.push(text)
  }
  if (ttftCount > 0) {
    parts.push(
      '# HELP pioneering_llm_ttft_seconds Time to first streamed token in seconds',
      '# TYPE pioneering_llm_ttft_seconds summary',
      `pioneering_llm_ttft_seconds_sum ${ttftSum}`,
      `pioneering_llm_ttft_seconds_count ${ttftCount}`,
    )
  }
  return parts.join('\n')
}

/** 测试辅助：清空计数。 */
export function _resetBackendMetricsForTest(): void {
  for (const counter of [requests, truncated, authErrors, disconnects]) counter.reset()
  ttftCount = 0
  ttftSum = 0
}
