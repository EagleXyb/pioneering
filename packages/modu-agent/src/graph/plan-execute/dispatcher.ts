// P4 Plan-and-Execute: 步骤分发节点/路由 + 单步收尾节点。
//
// 执行循环接线（对齐方案 §2.3 / §3.2）：
//   planner → step_dispatch → agent ⇄ tools（现有 ReAct 循环，处理当前步骤）
//   agent 无 tool_calls → step_finalize → step_dispatch ↻
//   step_dispatch 检测全部完成 → response（现有收尾链路）
//   步骤失败且 replan_count < max_replans → planner（携带失败上下文重规划）
//
// 边界原则：Executor 不修改计划（只推进游标），重规划决策集中在 stepDispatch 路由。
import { AIMessage, type BaseMessage } from '@langchain/core/messages'

import { getConfig } from '../../config/runtime-config.js'
import type { ModuAgentState } from '../state.js'
import type { StepResult } from './types.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[graph.plan_execute.dispatcher] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[graph.plan_execute.dispatcher] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[graph.plan_execute.dispatcher] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[graph.plan_execute.dispatcher] ${msg}`, ...args),
}

/** 本代际（当前 replan_count）的步骤结果——隔离重规划前的旧结果。 */
function _currentGenerationResults(state: ModuAgentState): Array<Record<string, any>> {
  const replanCount = state.replan_count ?? 0
  return (state.step_results ?? []).filter(
    (r) => (r?.['replan'] ?? 0) === replanCount,
  )
}

/**
 * 步骤分发节点：将当前步骤写入 transient 上下文字段。
 *
 * 作为 planner/agent 之后的入口节点，负责：
 *   1. 定位 plan[current_step_index]，写入 current_step（供 agent 注入步骤上下文）
 *   2. 记录本步 messages 基线长度（供 step_finalize 截取增量）
 *   3. 标记步骤 running，组装 SSE step_update delta
 *
 * 全部步骤完成或需要重规划时不做状态写入（由 stepDispatch 路由分流）。
 */
export function makeStepDispatchNode(): (
  state: ModuAgentState,
) => Partial<ModuAgentState> {
  function _stepDispatchNode(state: ModuAgentState): Partial<ModuAgentState> {
    const plan = state.plan ?? []
    const idx = state.current_step_index ?? 0

    // 越界保护：无剩余步骤时透传（stepDispatch 路由到 response）
    if (idx >= plan.length || plan.length === 0) {
      return {}
    }

    const step = plan[idx] ?? {}
    const stepId = String(step['step_id'] ?? `step_${idx + 1}`)

    // 标记当前步骤 running（整体替换 plan，_lw reducer）
    const updatedPlan = plan.map((s, i) =>
      i === idx ? { ...s, status: 'running' } : s,
    )

    logger.info(
      'Dispatching step %d/%d (%s) trace_id=%s',
      idx + 1, plan.length, stepId, state.trace_id ?? '',
    )

    return {
      plan: updatedPlan,
      current_step: { ...step, status: 'running' },
      step_msg_baseline: (state.messages ?? []).length,
      // SSE: step started
      plan_delta: {
        phase: 'execute',
        step_update: {
          id: stepId,
          status: 'running',
          started_at: Date.now(),
        },
      },
    }
  }

  return _stepDispatchNode
}

/**
 * 步骤分发路由（条件边）：决定下一个去向。
 *
 *   - idx >= plan.length → 'finalize_response'（全部完成）
 *   - 本代际末步失败且 continue_on_failure=false：
 *       replan_count < max_replans → 'planner'（重规划）
 *       否则 → 'finalize_response'（重规划耗尽，终止）
 *   - 其他 → 'agent'（执行当前步）
 */
export function stepDispatch(state: ModuAgentState): string {
  const config = getConfig()
  const plan = state.plan ?? []
  const idx = state.current_step_index ?? 0

  if (plan.length === 0 || idx >= plan.length) {
    return 'finalize_response'
  }

  const genResults = _currentGenerationResults(state)
  const lastResult = genResults[genResults.length - 1]
  const lastFailed = lastResult?.['status'] === 'failed'

  if (lastFailed) {
    const continueOnFailure = Boolean(
      config.get('plan_execute.continue_on_failure', false),
    )
    if (!continueOnFailure) {
      const replanCount = state.replan_count ?? 0
      const maxReplans = Number(config.get('plan_execute.max_replans', 2))
      if (replanCount < maxReplans) {
        logger.warning(
          'Step %s failed, triggering replan (%d/%d)',
          lastResult?.['step_id'] ?? 'unknown', replanCount + 1, maxReplans,
        )
        return 'planner'
      }
      logger.warning(
        'Step %s failed and replan budget exhausted (%d), terminating',
        lastResult?.['step_id'] ?? 'unknown', replanCount,
      )
      return 'finalize_response'
    }
    // continue_on_failure=true：失败步骤记 skipped 语义由 step_finalize 落库后继续
    logger.info(
      'Step %s failed, continuing to next step (continue_on_failure=true)',
      lastResult?.['step_id'] ?? 'unknown',
    )
  }

  return 'agent'
}

/**
 * 从 messages 尾部截取本步增量消息。
 *
 * 以 step_msg_baseline 为基线；基线异常（小于 0 或大于当前长度）时回退为全部消息。
 */
function _sliceStepMessages(state: ModuAgentState): BaseMessage[] {
  const messages = state.messages ?? []
  const baseline = state.step_msg_baseline ?? 0
  if (baseline < 0 || baseline > messages.length) {
    return messages
  }
  return messages.slice(baseline)
}

/**
 * 截断文本到指定长度（步骤摘要注入/落库用）。
 */
function _truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }
  return text.slice(0, maxChars) + '...'
}

/**
 * 创建单步收尾节点。
 *
 * 核心逻辑（对齐方案 §4.4）：
 *   1. 定位 plan[current_step_index]，按基线截取本步新增消息；
 *   2. 提取本步 tool_call_id 列表与最终 AIMessage 摘要；
 *   3. 追加 step_results，更新 plan[i].status，current_step_index + 1；
 *   4. 组装 PlanStateDelta（phase='execute' + step_update）供 EventBridge 发 SSE。
 *
 * 失败判定：本步最终 AIMessage 为空且无有效工具结果时记 failed；
 * agent 节点的 LLM 异常由图层捕获，此处仅需处理消息层面的异常形态。
 */
export function makeStepFinalizeNode(): (
  state: ModuAgentState,
) => Promise<Partial<ModuAgentState>> {
  async function _stepFinalizeNode(
    state: ModuAgentState,
  ): Promise<Partial<ModuAgentState>> {
    const config = getConfig()
    const summaryMaxChars = Number(
      config.get('plan_execute.step_summary_max_chars', 500),
    )

    const plan = state.plan ?? []
    const idx = state.current_step_index ?? 0

    // 越界保护：游标异常时不产生任何写入
    if (idx >= plan.length || plan.length === 0) {
      logger.warning(
        'step_finalize invoked with out-of-range index %d (plan.length=%d), skipping',
        idx, plan.length,
      )
      return {}
    }

    const step = plan[idx] ?? {}
    const stepId = String(step['step_id'] ?? `step_${idx + 1}`)
    const finishedAt = Date.now()

    // 1. 截取本步增量消息
    const stepMessages = _sliceStepMessages(state)

    // 2. 提取本步 tool_call_id 列表与最终 AIMessage 摘要
    const toolRefs: string[] = []
    let lastAiContent = ''
    for (const msg of stepMessages) {
      const msgType = typeof (msg as any)._getType === 'function'
        ? (msg as any)._getType()
        : (msg as any).type
      if (msgType === 'tool') {
        const callId = (msg as any).tool_call_id
        if (callId && !toolRefs.includes(callId)) {
          toolRefs.push(callId)
        }
      } else if (msg instanceof AIMessage || msgType === 'ai') {
        const content = (msg as any).content
        if (typeof content === 'string' && content) {
          lastAiContent = content
        }
      }
    }

    // 失败判定：最终无 AI 输出且无任何工具产出
    const failed = !lastAiContent && toolRefs.length === 0
    const status: StepResult['status'] = failed ? 'failed' : 'done'

    // 3. 组装步骤结果（replan 代际标签隔离重规划前旧结果）
    const stepResult: Record<string, any> = {
      step_id: stepId,
      status,
      output: _truncate(lastAiContent, summaryMaxChars),
      tool_refs: toolRefs,
      replan: state.replan_count ?? 0,
      finished_at: finishedAt,
    }
    if (failed) {
      stepResult['error'] = 'Step produced no AI output and no tool results'
    }

    // 4. 更新 plan[i].status + 推进游标
    const updatedPlan = plan.map((s, i) =>
      i === idx ? { ...s, status } : s,
    )

    logger.info(
      'Step %d/%d (%s) finalized: status=%s tools=%d trace_id=%s',
      idx + 1, plan.length, stepId, status, toolRefs.length, state.trace_id ?? '',
    )

    return {
      plan: updatedPlan,
      step_results: [stepResult],
      current_step_index: idx + 1,
      current_step: {},
      plan_phase: idx + 1 >= plan.length ? 'finalizing' : 'executing',
      // SSE: step completed
      plan_delta: {
        phase: 'execute',
        step_update: {
          id: stepId,
          status,
          result: stepResult['output'],
          ...(stepResult['error'] ? { error: stepResult['error'] } : {}),
          finished_at: finishedAt,
        },
      },
    }
  }

  return _stepFinalizeNode
}
