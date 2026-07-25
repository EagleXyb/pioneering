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

export class MajorityVoteStrategy extends ConsensusStrategy {
  async aggregate(results: Record<string, any>[], quorum: number): Promise<Record<string, any>> {
    if (results.length === 0) {
      return { consensus: null, agreement_count: 0, strategy: 'majority_vote' }
    }
    const groups: Map<string, Record<string, any>[]> = new Map()
    for (const r of results) {
      const h = MajorityVoteStrategy._content_hash(r)
      let list = groups.get(h)
      if (!list) {
        list = []
        groups.set(h, list)
      }
      list.push(r)
    }
    let max_key = ''
    let max_group: Record<string, any>[] = []
    for (const [key, list] of groups) {
      if (list.length > max_group.length) {
        max_key = key
        max_group = list
      }
    }
    return {
      consensus: max_group[0],
      agreement_count: max_group.length,
      total_results: results.length,
      strategy: 'majority_vote',
      group_count: groups.size,
    }
  }

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

    try {
      // 统一通过 ModuLLM.invoke 消费（对应文档 §2.1）
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
        }
      }
    } catch (e) {
      logger.warning('LLM judge failed: %s', String(e))
    }

    return {
      consensus: results[0].output ?? results[0],
      agreement_count: 1,
      total_results: results.length,
      strategy: 'llm_judge_fallback',
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
