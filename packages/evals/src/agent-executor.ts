// ============================================================
// 被测 Agent 执行器（默认实现）
//
// 职责：把"评测用例"驱动到真实的 modu-agent 图上执行，
//       并把 run_sync 的返回映射为评测引擎统一的 AgentRunResult。
//
// YAML -> RuntimeConfig 桥接（本文件的核心价值）：
//   global.yaml 的 agent_overrides（点分键）经 dottedToObject 转
//   嵌套对象后构造 RuntimeConfig，并以 overrideConfig 覆盖全局单例
//   ——评测进程独立运行，全局覆盖是安全的，且保证图内所有
//   getConfig() 调用读到一致的评测配置。
//
// 隔离原则：
//   - checkpointer/store 强制内存实现（评测不污染生产状态）
//   - 每个用例独立 session（thread），互不串扰
// ============================================================

import {
  create_agent,
  overrideConfig,
  run_sync,
  RuntimeConfig,
  _build_judge_llm,
  type ModuGraph,
} from '@pioneering/modu-agent'
import { dottedToObject, type GlobalConfig } from './config-loader.js'
import { toToolCallRecord } from './metrics.js'
import type { AgentRunResult, EvalCase } from './types.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[evals.executor] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[evals.executor] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[evals.executor] ${msg}`, ...args),
}

/** 用例执行器签名（runner 依赖此抽象，测试注入 fake 实现）。 */
export type CaseExecutor = (evalCase: EvalCase) => Promise<AgentRunResult>

export interface ExecutorBundle {
  executor: CaseExecutor
  /** 评测配置覆盖的 RuntimeConfig（judge LLM 构造复用）。 */
  runtimeConfig: RuntimeConfig
  /** 评测结束后恢复全局配置单例。 */
  restore: () => void
}

function mapUsage(usage: Record<string, any> | undefined): AgentRunResult['usage'] {
  const pt = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0) || 0
  const ct = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0) || 0
  return { promptTokens: pt, completionTokens: ct, totalTokens: pt + ct }
}

/**
 * 创建默认执行器（真实 modu-agent 图）。
 *
 * @param globalCfg global.yaml 配置
 * @param runTag 本次 run 的短标识（session 前缀，便于日志关联）
 */
export async function createDefaultExecutor(
  globalCfg: GlobalConfig,
  runTag: string,
): Promise<ExecutorBundle> {
  // 1. YAML agent_overrides -> RuntimeConfig（deep merge DEFAULT_CONFIG）
  const overrides = dottedToObject(globalCfg.agent_overrides ?? {})
  // 评测隔离兜底：强制内存存储（即使 YAML 忘配也不污染持久层）
  const memory = (overrides.memory ??= {})
  memory.checkpointer_type = 'memory'
  memory.store_type = 'in_memory'

  const runtimeConfig = new RuntimeConfig(overrides)
  const restoreHandle = overrideConfig(runtimeConfig)
  const restore = (): void => restoreHandle.restore()

  // 2. env 注入（不覆盖宿主已设置的值）
  for (const [k, v] of Object.entries(globalCfg.env ?? {})) {
    if (process.env[k] === undefined && v !== '') process.env[k] = v
  }

  // 3. 构建评测专用图（独立实例，不经过 get_runner 的全局缓存）
  const graph: ModuGraph = await create_agent(undefined, runtimeConfig)
  logger.info('评测用 modu-agent 图构建完成（隔离配置: memory/in_memory）')

  // 4. 执行器：run_sync -> AgentRunResult
  const executor: CaseExecutor = async (evalCase: EvalCase): Promise<AgentRunResult> => {
    const startedAt = Date.now()
    const sessionId = `eval-${runTag}-${evalCase.id}`
    const result = await run_sync(graph, 'eval-user', sessionId, {
      input_type: 'text',
      prompt: evalCase.input,
    })
    const latencyMs = Date.now() - startedAt

    const data = (result?.data ?? {}) as Record<string, any>
    const errorCode = String(result?.error_code ?? '')
    const ok = result?.status === 'success' && !errorCode

    return {
      caseId: evalCase.id,
      ok,
      response: String(data.response ?? ''),
      toolCalls: (Array.isArray(data.tool_results) ? data.tool_results : []).map(toToolCallRecord),
      usage: mapUsage(data.usage),
      iteration: Number(data.iteration ?? 0) || 0,
      reasoningRoundCount: Number(data.reasoning_round_count ?? 0) || 0,
      latencyMs,
      errorCode: ok ? undefined : errorCode || 'EVAL_RUN_FAILED',
      errorMessage: ok ? undefined : String((data as any).message ?? ''),
      timedOut: false,
    }
  }

  return { executor, runtimeConfig, restore }
}

/**
 * 按 global.yaml judge 配置构造 LLM-as-Judge 的 QualityMonitor 依赖项。
 *
 * 复用 modu-agent factory._build_judge_llm：按 judge.provider 读取
 * RuntimeConfig 构造 ChatModel 并包装为 ModuLLM。rule 模式返回 null。
 */
export function buildJudgeLlm(globalCfg: GlobalConfig, runtimeConfig: RuntimeConfig): any | null {
  const mode = globalCfg.judge?.mode ?? 'rule'
  if (mode === 'rule') return null
  try {
    // judge 参数写入 RuntimeConfig 供 _build_judge_llm 读取
    const j = globalCfg.judge ?? {}
    runtimeConfig.updateMany({
      'feedback.quality_monitor_mode': mode,
      'feedback.quality_monitor_llm_timeout': j.timeout_seconds ?? 15,
      'feedback.quality_monitor_llm_temperature': j.temperature ?? 0,
      'feedback.quality_monitor_llm_max_tokens': j.max_tokens ?? 256,
      ...(j.provider ? { 'feedback.quality_monitor_llm_provider': j.provider } : {}),
    })
    return _build_judge_llm(runtimeConfig, {})
  } catch (e) {
    logger.warning(`judge LLM 构造失败，降级 rule 模式: ${String(e)}`)
    return null
  }
}
