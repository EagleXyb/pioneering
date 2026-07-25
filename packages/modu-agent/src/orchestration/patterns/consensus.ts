// 对应 Python: orchestration/patterns/consensus.py
// ConsensusPattern + ConsensusStrategy + create_consensus_strategy 工厂
//
// 统一 LLM 接口改造（对应文档 §2.1）：
//   LLMJudgeStrategy 改为消费 ModuLLM.invoke(LLMMessage[]) 接口，
//   与 QualityMonitor 共享同一 judge LLM 实例（ModuLLMAdapter 包装），
//   消除 LangChain HumanMessage 与 BaseReasoner areason 双轨适配。
import { createHash } from 'crypto'

import { get_event_bus } from '../communication/message-bus.js'
import { AgentEvent, EventAction, EventDomain, EventPriority } from '../communication/protocol.js'
import type { LLMMessage, ModuLLM } from '../../core/interfaces/llm.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[consensus] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[consensus] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[consensus] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[consensus] ${msg}`, ...args),
}

/**
 * 对结果做稳定 JSON 序列化（排序键），用于内容哈希。
 * 对应 Python: json.dumps(output, sort_keys=True, default=str, ensure_ascii=False)
 */
function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') {
    return String(value)
  }
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, any> = {}
      for (const k of Object.keys(val).sort()) {
        sorted[k] = val[k]
      }
      return sorted
    }
    return val
  })
}

// ============================================================
// ConsensusStrategy 抽象接口
// ============================================================

export abstract class ConsensusStrategy {
  abstract aggregate(results: Record<string, any>[], quorum: number): Promise<Record<string, any>>
}

// ============================================================
// MajorityVoteStrategy
// ============================================================

/**
 * 文本相似度阈值（对应文档 §4.4 建议12）。
 *
 * v1.3 前 MajorityVoteStrategy 使用 SHA-256 完全匹配分组，导致语义等价但字面
 * 不同的输出无法归为一组（如 "42" 与 "The answer is 42"）。v1.4 改用 Jaccard
 * 词元相似度：相似度 >= 该阈值的结果归入同一组。
 *
 * 不引入 embedding 依赖（避免新 deps + 网络调用），用词袋 Jaccard 相似度
 * 作为零依赖近似——对短文本结果（如计算结果、事实性答案）足够有效。
 */
const _MAJORITY_VOTE_SIMILARITY_THRESHOLD = 0.6

export class MajorityVoteStrategy extends ConsensusStrategy {
  async aggregate(results: Record<string, any>[], quorum: number): Promise<Record<string, any>> {
    if (results.length === 0) {
      return { consensus: null, agreement_count: 0, strategy: 'majority_vote' }
    }
    // v1.4 §4.4 建议12：用 Jaccard 词元相似度替代严格内容哈希分组。
    // 第一个结果开新组，后续结果与已有组的代表（首个元素）比较相似度，
    // 高于阈值则归入该组；否则开新组。O(n * k)，k 为组数，通常很小。
    const groups: Array<{ representative: Record<string, any>; members: Record<string, any>[] }> = []
    for (const r of results) {
      let matched = false
      for (const g of groups) {
        const sim = MajorityVoteStrategy._textSimilarity(g.representative, r)
        if (sim >= _MAJORITY_VOTE_SIMILARITY_THRESHOLD) {
          g.members.push(r)
          matched = true
          break
        }
      }
      if (!matched) {
        groups.push({ representative: r, members: [r] })
      }
    }
    // 取成员最多的组
    let maxGroup = groups[0]
    for (const g of groups) {
      if (g.members.length > maxGroup.members.length) {
        maxGroup = g
      }
    }
    return {
      consensus: maxGroup.members[0],
      agreement_count: maxGroup.members.length,
      total_results: results.length,
      strategy: 'majority_vote',
      group_count: groups.length,
    }
  }

  /**
   * 提取结果的文本表示用于相似度比较。
   * 优先取 output 字段，其次取 content，最后整体 stringify。
   */
  static _extractText(result: Record<string, any>): string {
    const output = result.output ?? result.content ?? result
    if (typeof output === 'string') return output
    try {
      return stableStringify(output)
    } catch {
      return String(output)
    }
  }

  /**
   * 计算 Jaccard 词元相似度（对应文档 §4.4 建议12）。
   *
   * 将文本按非字母数字字符分词为小写词袋集合，计算 |A ∩ B| / |A ∪ B|。
   * 完全相同 → 1.0；完全不同 → 0.0。零依赖、O(n) 复杂度。
   */
  static _textSimilarity(a: Record<string, any>, b: Record<string, any>): number {
    const ta = new Set(MajorityVoteStrategy._tokenize(MajorityVoteStrategy._extractText(a)))
    const tb = new Set(MajorityVoteStrategy._tokenize(MajorityVoteStrategy._extractText(b)))
    if (ta.size === 0 && tb.size === 0) return 1.0
    if (ta.size === 0 || tb.size === 0) return 0.0
    let inter = 0
    for (const w of ta) {
      if (tb.has(w)) inter++
    }
    const union = ta.size + tb.size - inter
    return union === 0 ? 0 : inter / union
  }

  /** 按非字母数字字符分词并转小写。 */
  static _tokenize(text: string): string[] {
    if (!text) return []
    return text.toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/i).filter((t) => t.length > 0)
  }

  /**
   * @deprecated v1.4 改用 _textSimilarity 进行模糊分组。保留仅为向后兼容/测试。
   */
  static _content_hash(result: Record<string, any>): string {
    const output = result.output ?? result
    let content: string
    try {
      content = stableStringify(output)
    } catch {
      content = String(output)
    }
    return createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16)
  }
}

// ============================================================
// WeightedAggregateStrategy
// ============================================================

export class WeightedAggregateStrategy extends ConsensusStrategy {
  private _weights: Record<string, number>

  constructor(weights?: Record<string, number> | null) {
    super()
    this._weights = weights ?? {}
  }

  async aggregate(results: Record<string, any>[], quorum: number): Promise<Record<string, any>> {
    if (results.length === 0) {
      return { consensus: null, agreement_count: 0, strategy: 'weighted' }
    }

    const weightOf = (r: Record<string, any>): number => {
      const task_type = r.task_type ?? ''
      if (task_type in this._weights) {
        return Number(this._weights[task_type])
      }
      return Number(r.weight ?? 1.0)
    }

    const sorted_results = [...results].sort((a, b) => weightOf(b) - weightOf(a))
    const best = sorted_results[0]
    return {
      consensus: best.output ?? best,
      agreement_count: results.length,
      total_results: results.length,
      strategy: 'weighted',
      best_weight: weightOf(best),
      total_weight: results.reduce((sum, r) => sum + weightOf(r), 0),
    }
  }
}

// ============================================================
// LLMJudgeStrategy
// ============================================================

export class LLMJudgeStrategy extends ConsensusStrategy {
  private static readonly _JUDGE_PROMPT =
    'You are an impartial judge. Select the best answer from candidates.\n' +
    'Task: {task}\nCandidates:\n{candidates}\n' +
    'Respond with ONLY JSON: {"winner": <index>, "reason": "<brief>"}'

  /**
   * judge LLM 最大重试次数（对应文档 §4.4 建议10）。
   *
   * judge LLM 可能因网络抖动、JSON 解析失败、索引越界等瞬时故障失败。
   * 失败时重试 1 次（即总共最多 2 次调用），仍失败则 fallback 到首个候选。
   */
  private static readonly _MAX_RETRIES = 1

  private _llm: ModuLLM | null
  private _task: string

  constructor(judge_llm: ModuLLM | null, task_description: string = '') {
    super()
    this._llm = judge_llm
    this._task = task_description
  }

  async aggregate(results: Record<string, any>[], quorum: number): Promise<Record<string, any>> {
    if (results.length === 0) {
      return { consensus: null, agreement_count: 0, strategy: 'llm_judge' }
    }
    if (this._llm === null || this._llm === undefined) {
      logger.warning('LLMJudgeStrategy has no judge_llm, falling back to majority vote')
      return new MajorityVoteStrategy().aggregate(results, quorum)
    }

    const candidates = results
      .map((r, i) => `[${i}] ${stableStringify(r.output ?? r)}`)
      .join('\n')
    const prompt = LLMJudgeStrategy._JUDGE_PROMPT
      .replace('{task}', this._task || 'general task')
      .replace('{candidates}', candidates)

    // v1.4 §4.4 建议10：judge LLM 失败时重试 1 次
    let lastError: string = ''
    for (let attempt = 0; attempt <= LLMJudgeStrategy._MAX_RETRIES; attempt++) {
      try {
        const messages: LLMMessage[] = [{ role: 'user', content: prompt }]
        const result = await this._llm.invoke(messages, { taskType: 'consensus_judge' })
        const content = result.content ?? ''
        const judge = JSON.parse(content)
        const idx = Number(judge.winner ?? 0)
        if (idx >= 0 && idx < results.length) {
          const winner = results[idx]
          return {
            consensus: winner.output ?? winner,
            agreement_count: 1,
            total_results: results.length,
            strategy: 'llm_judge',
            judge_reason: judge.reason ?? '',
            winner_index: idx,
            judge_attempts: attempt + 1,
          }
        }
        lastError = `winner index out of range: ${idx} (results=${results.length})`
      } catch (e) {
        lastError = String(e)
        if (attempt < LLMJudgeStrategy._MAX_RETRIES) {
          logger.warning(
            'LLM judge attempt %d failed, retrying: %s',
            attempt + 1, lastError,
          )
        }
      }
    }

    logger.warning('LLM judge failed after %d attempts: %s', LLMJudgeStrategy._MAX_RETRIES + 1, lastError)
    return {
      consensus: results[0].output ?? results[0],
      agreement_count: 1,
      total_results: results.length,
      strategy: 'llm_judge_fallback',
      judge_error: lastError,
    }
  }
}

// ============================================================
// create_consensus_strategy 工厂
// ============================================================

export function create_consensus_strategy(
  strategy_name: string,
  judge_llm?: ModuLLM | null,
  task_description: string = '',
  weights?: Record<string, number> | null,
): ConsensusStrategy {
  const name = strategy_name.toLowerCase().trim()
  if (name === 'majority_vote') {
    return new MajorityVoteStrategy()
  }
  if (name === 'weighted') {
    return new WeightedAggregateStrategy(weights)
  }
  if (name === 'llm_judge') {
    return new LLMJudgeStrategy(judge_llm ?? null, task_description)
  }
  throw new Error(`Unknown consensus strategy: ${strategy_name}`)
}

// ============================================================
// ConsensusPattern
// ============================================================

export class ConsensusPattern {
  private _quorum: number
  private _strategy: ConsensusStrategy
  private _event_bus: any

  constructor(
    quorum: number = 2,
    strategy?: ConsensusStrategy | null,
    event_bus: any = null,
  ) {
    if (quorum < 1) {
      throw new Error('quorum must be >= 1')
    }
    this._quorum = quorum
    this._strategy = strategy ?? new MajorityVoteStrategy()
    this._event_bus = event_bus
  }

  get quorum(): number {
    return this._quorum
  }

  get strategy(): ConsensusStrategy {
    return this._strategy
  }

  async reach_consensus(
    participants: Array<(data: Record<string, any>) => any>,
    input_data: Record<string, any>,
    timeout_ms: number = 30000,
  ): Promise<Record<string, any>> {
    if (participants.length < this._quorum) {
      return {
        status: 'error',
        error_code: 'CONSENSUS_001',
        data: {
          message: `Need at least ${this._quorum} participants, got ${participants.length}`,
          participant_count: participants.length,
          quorum: this._quorum,
        },
      }
    }

    const tasks = participants.map((p) => ConsensusPattern._safe_call(p, input_data))
    const timeout_sec = Math.max(timeout_ms / 1000.0, 1.0)

    let results: any[]
    try {
      results = await Promise.race([
        Promise.allSettled(tasks),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), timeout_sec * 1000),
        ),
      ]).then((settled) =>
        Array.isArray(settled) ? settled.map((r: any) => r.status === 'fulfilled' ? r.value : r.reason) : [],
      )
    } catch {
      await this._publish_consensus_failure(input_data, [], `Timeout after ${timeout_ms}ms`)
      return {
        status: 'error',
        error_code: 'CONSENSUS_003',
        data: {
          message: `Consensus timed out after ${timeout_ms}ms`,
          participant_count: participants.length,
          quorum: this._quorum,
        },
      }
    }

    const valid_results: Record<string, any>[] = []
    for (const r of results) {
      if (r instanceof Error) {
        logger.warning('Participant error: %s', String(r))
        continue
      }
      if (typeof r === 'object' && r !== null && r.status === 'success') {
        valid_results.push(r.data ?? {})
      } else if (typeof r === 'object' && r !== null) {
        valid_results.push(r.data ?? r)
      } else if (r !== null && r !== undefined) {
        valid_results.push({ output: r })
      }
    }

    if (valid_results.length < this._quorum) {
      await this._publish_consensus_failure(input_data, results, `Failed to reach quorum: ${valid_results.length}/${this._quorum}`)
      return {
        status: 'error',
        error_code: 'CONSENSUS_002',
        data: {
          message: 'Failed to reach quorum',
          valid_count: valid_results.length,
          quorum: this._quorum,
          total_participants: participants.length,
        },
      }
    }

    const consensus = await this._strategy.aggregate(valid_results, this._quorum)
    return {
      status: 'success',
      error_code: '',
      data: {
        consensus: consensus.consensus,
        agreement_count: consensus.agreement_count ?? valid_results.length,
        total_participants: participants.length,
        valid_count: valid_results.length,
        strategy: consensus.strategy ?? this._strategy.constructor.name,
      },
    }
  }

  async _publish_consensus_failure(
    input_data: Record<string, any>,
    results: any[],
    reason: string,
  ): Promise<void> {
    const trace_id = input_data.trace_id ?? ''
    const session_id = input_data.session_id ?? ''
    const user_id = input_data.user_id ?? 'system'
    try {
      const bus = this._event_bus ?? get_event_bus()
      const event = new AgentEvent({
        trace_id,
        session_id,
        user_id,
        domain: EventDomain.FEEDBACK,
        action: EventAction.ANALYZE,
        priority: EventPriority.HIGH,
        metadata: {
          consensus_failed: 'true',
          reason,
          result_count: String(results.length),
          quorum: String(this._quorum),
        },
      })
      await bus.publish(event)
      logger.info('Consensus failure event published (trace_id=%s): %s', trace_id, reason)
    } catch (e) {
      logger.warning('Failed to publish consensus failure event: %s', String(e))
    }
  }

  static async _safe_call(func: (data: Record<string, any>) => any, data: Record<string, any>): Promise<any> {
    return await func(data)
  }
}
