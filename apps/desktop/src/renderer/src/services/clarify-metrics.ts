// ============================================================
// Clarify Metrics — 需求澄清灰度观测（阶段2）
//
// 目标：让「误触发率」可度量、可决策——澄清能力上线后按数据调参，
// 而不是凭感觉判断 10 字阈值/模糊短语表是否合理。
//
// 采集口径（与 hitlStore 生命周期一一对应）：
//   - triggered：澄清暂停项入队（kind='clarifying' | 'choice'，含 recover 补挂）
//   - answered ：用户提交回答且 resume 成功启动
//   - skipped  ：用户点「跳过」（按现有信息继续）
//   - expired  ：超时/失效收敛（服务端自动拒绝、checkpointer 丢失）
//
// 派生指标：
//   - skipRate = skipped / (answered + skipped)
//     「跳过」≈ 用户认为本不该问 → 直接反映误触发率
//   - avgAnswerLatencyMs：入队 → 提交回答的耗时（用户负担代理指标）
//
// 存储：localStorage（渲染端本地，单机单用户场景足够）；
// 不可用（纯浏览器 dev / 单测 / 存储配额满）时降级为内存计数，不抛错。
// 只读出口：window.__clarifyStats()（控制台/诊断用，不暴露敏感数据）。
// ============================================================

const STORAGE_KEY = 'pioneering.clarify.metrics'

export interface ClarifyMetricCounters {
  /** 澄清暂停项入队次数（去重：同一会话同一暂停项只记一次） */
  triggered: number
  /** 用户提交回答且 resume 成功启动的次数 */
  answered: number
  /** 用户跳过次数 */
  skipped: number
  /** 超时/失效收敛次数 */
  expired: number
  /** 回答耗时累计（毫秒，与 answered 配对求均值） */
  answerLatencyMsTotal: number
}

export interface ClarifyMetricsSnapshot extends ClarifyMetricCounters {
  /** 误触发率 = skipped / (answered + skipped)；无样本为 null */
  skipRate: number | null
  /** 平均回答耗时（毫秒）；无样本为 null */
  avgAnswerLatencyMs: number | null
  /** 最近一次写入时间（ISO）；无记录为 null */
  updatedAt: string | null
}

const ZERO: ClarifyMetricCounters = {
  triggered: 0,
  answered: 0,
  skipped: 0,
  expired: 0,
  answerLatencyMsTotal: 0
}

function emptyCounters(): ClarifyMetricCounters {
  return { ...ZERO }
}

// ---- 存储层（localStorage 优先，降级内存） ----

let memoryCounters: ClarifyMetricCounters = emptyCounters()

function readStorage(): ClarifyMetricCounters {
  try {
    if (typeof localStorage === 'undefined') return memoryCounters
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyCounters()
    const parsed = JSON.parse(raw) as Partial<ClarifyMetricCounters>
    return {
      triggered: Number(parsed.triggered) || 0,
      answered: Number(parsed.answered) || 0,
      skipped: Number(parsed.skipped) || 0,
      expired: Number(parsed.expired) || 0,
      answerLatencyMsTotal: Number(parsed.answerLatencyMsTotal) || 0
    }
  } catch {
    return memoryCounters
  }
}

let counters: ClarifyMetricCounters = readStorage()
let updatedAt: string | null = null

function persist(): void {
  updatedAt = new Date().toISOString()
  memoryCounters = { ...counters }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(counters))
    }
  } catch {
    // 持久化失败不影响本次计数（内存仍准确）
  }
}

// ---- 去重与耗时跟踪 ----

/** 暂停项去重键（会话 + 类型）；recover 补挂与实时入队视为同一项 */
const pendingSince = new Map<string, number>()

function itemKey(sessionId: string, kind: string): string {
  return `${sessionId}|${kind}`
}

function isClarifyKind(kind: string | undefined): boolean {
  return kind === 'clarifying' || kind === 'choice'
}

// ---- 埋点入口 ----

/**
 * 澄清暂停项入队（USER_QUESTION_REQUEST / recover 补挂）。
 * 同一会话同一类型的进行中暂停项只计一次（防 recover 与实时事件重复计数）。
 */
export function trackClarifyTriggered(sessionId: string, kind: string | undefined): void {
  if (!isClarifyKind(kind)) return
  const key = itemKey(sessionId, kind ?? '')
  if (!pendingSince.has(key)) {
    pendingSince.set(key, Date.now())
    counters.triggered += 1
    persist()
  }
}

/** 用户提交回答且 resume 成功启动：记 answered 并累计耗时 */
export function trackClarifyAnswered(sessionId: string, kind: string | undefined): void {
  if (!isClarifyKind(kind)) return
  const key = itemKey(sessionId, kind ?? '')
  const since = pendingSince.get(key)
  if (since !== undefined) {
    counters.answerLatencyMsTotal += Math.max(0, Date.now() - since)
    pendingSince.delete(key)
  }
  counters.answered += 1
  persist()
}

/** 用户跳过：计 skipped（误触发率分子） */
export function trackClarifySkipped(sessionId: string, kind: string | undefined): void {
  if (!isClarifyKind(kind)) return
  pendingSince.delete(itemKey(sessionId, kind ?? ''))
  counters.skipped += 1
  persist()
}

/** 超时/失效收敛：计 expired */
export function trackClarifyExpired(sessionId: string, kind?: string | undefined): void {
  if (kind !== undefined && !isClarifyKind(kind)) return
  if (kind !== undefined) pendingSince.delete(itemKey(sessionId, kind))
  counters.expired += 1
  persist()
}

// ---- 读取/重置 ----

export function getClarifyMetrics(): ClarifyMetricsSnapshot {
  const decided = counters.answered + counters.skipped
  return {
    ...counters,
    skipRate: decided > 0 ? counters.skipped / decided : null,
    avgAnswerLatencyMs:
      counters.answered > 0 ? Math.round(counters.answerLatencyMsTotal / counters.answered) : null,
    updatedAt
  }
}

/** 清空计数（诊断/复位用） */
export function resetClarifyMetrics(): void {
  counters = emptyCounters()
  pendingSince.clear()
  persist()
}

// ---- 只读出口（控制台诊断：__clarifyStats()） ----
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__clarifyStats = getClarifyMetrics
}
