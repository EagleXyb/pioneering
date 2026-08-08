// P4 Plan-and-Execute: 步骤分发节点/路由 + 单步收尾节点。
//
// 执行循环接线（对齐方案 §2.3 / §3.2）：
//   planner → step_dispatch → agent ⇄ tools（现有 ReAct 循环，处理当前步骤）
//   agent 无 tool_calls → step_finalize → step_dispatch ↻
//   step_dispatch 检测全部完成 → response（现有收尾链路）
//   步骤失败且 replan_count < max_replans → planner（携带失败上下文重规划）
//
// 边界原则：Executor 不修改计划（只推进游标），重规划决策集中在 stepDispatch 路由。
//
// v1.2 扩展（对应文档 §4.1 建议1/2/8）：
//   - #8 started_at 写入：step_dispatch 节点将 started_at 写入 current_step（transient），
//     step_finalize 读取并合并到 step_results，使步骤耗时可还原
//   - #2 步骤级重试：step_finalize 判定 failed 后，先按 step.retry_policy 重试 N 次
//     （指数退避），仍失败再触发整计划 replan；replan 预算不再因瞬时工具失败被浪费
//   - #1 DAG 并行执行：stepDispatch 路由识别"就绪步骤集合"（pending 且 depends_on
//     全 done），集合大小 > 1 时通过 Send API 并行分发到 agent；集合大小 = 1 时
//     保持原顺序逻辑（向后兼容）
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { Send } from '@langchain/langgraph'
import { Send as SendClass } from '@langchain/langgraph'

import { getConfig } from '../../config/runtime-config.js'
import type { ModuAgentState } from '../state.js'
import type { PlanStep, StepResult } from './types.js'

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
 *   4. v1.2 #8: 写入 started_at 到 current_step（transient），step_finalize 读取并合并到 step_results
 *
 * 全部步骤完成或需要重规划时不做状态写入（由 stepDispatch 路由分流）。
 *
 * v1.2 #2: 支持步骤级重试——若 plan[idx].retry_count > 0（被 step_finalize 重置的待重试步骤），
 *   保留 retry_count 并透传到 current_step，让 agent 节点感知"这是重试"（可注入重试提示）。
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
    const stepStatus = String(step['status'] ?? '')

    // v1.2 #1: DAG 场景下 step_finalize 汇聚到 step_dispatch 节点时，
    // current_step_index 可能指向已 done/running 的步骤（多分支 last-write-wins）。
    // 此时不应重复标记 running 或写入 current_step，让 stepDispatch 路由通过 Send 处理。
    // 仅当步骤为 pending（首次执行）或需重试（step_finalize 重置为 pending）时才写入。
    if (stepStatus !== 'pending') {
      logger.debug(
        'step_dispatch: plan[%d].status=%s (not pending), skip writing current_step',
        idx, stepStatus,
      )
      return {}
    }

    const stepId = String(step['step_id'] ?? `step_${idx + 1}`)
    const startedAt = Date.now()

    // v1.2 #2: 读取重试计数（被 step_finalize 在重试时写入 plan[i].retry_count）
    const retryCount = typeof step['retry_count'] === 'number' ? step['retry_count'] : 0

    // 标记当前步骤 running（整体替换 plan，_lw reducer）
    // v1.2 #8: 同步把 started_at 写入 plan[i]（持久化，便于恢复时还原耗时）
    const updatedPlan = plan.map((s, i) =>
      i === idx ? { ...s, status: 'running', started_at: startedAt } : s,
    )

    logger.info(
      'Dispatching step %d/%d (%s) retry=%d trace_id=%s',
      idx + 1, plan.length, stepId, retryCount, state.trace_id ?? '',
    )

    return {
      plan: updatedPlan,
      // v1.2 #8: current_step 携带 started_at 供 step_finalize 读取
      // v1.2 #2: current_step 携带 retry_count 供 agent 节点感知重试上下文
      current_step: { ...step, status: 'running', started_at: startedAt, retry_count: retryCount },
      step_msg_baseline: (state.messages ?? []).length,
      // SSE: step started
      plan_delta: {
        phase: 'execute',
        step_update: {
          id: stepId,
          // 步骤在 plan 数组中的下标（0 基），供前端映射到 plan-step 节点
          index: idx,
          status: 'running',
          started_at: startedAt,
          ...(retryCount > 0 ? { retry_count: retryCount } : {}),
        },
      },
    }
  }

  return _stepDispatchNode
}

/**
 * 步骤分发路由（条件边）：决定下一个去向。
 *
 *   - 全部步骤 done/skipped → 'response'（映射到 finalize_response 节点）
 *   - 本代际末步失败且 continue_on_failure=false：
 *       replan_count < max_replans → 'planner'（重规划）
 *       否则 → 'response'（重规划耗尽，终止）
 *   - v1.2 #1 DAG 调度：识别"就绪步骤集合"（pending 且 depends_on 全 done）
 *       集合大小 = 1 → 'agent'（顺序执行，向后兼容）
 *       集合大小 > 1 → Send[]（并行分发到 step_dispatch，每个 Send 携带独立 current_step_index）
 *   - 兜底 → 'agent'（执行当前步）
 *
 * 注意：返回值可以是 addConditionalEdges targets 映射的 key（'agent'/'response'/'planner'），
 * 或 Send[]（并行分发）。graph.ts 中注册为：
 *   { agent: 'agent', response: 'finalize_response', planner: 'planner' }
 * LangGraph JS 支持条件路由返回 Send[] 用于并行分发（与路径映射形式兼容）。
 *
 * v1.2 #1 DAG 调度策略（对应文档 §4.1 建议1）：
 *   - 解析 plan 中各步骤的 depends_on 字段
 *   - 依赖步骤 status='done' 视为依赖已满足
 *   - 多个就绪步骤通过 Send API 并行分发到 step_dispatch 节点
 *   - step_dispatch 节点根据 Send 携带的 current_step_index 分发对应步骤
 *   - 单步就绪时保持原顺序逻辑（向后兼容，零风险）
 */
export function stepDispatch(state: ModuAgentState): string | Send[] {
  const config = getConfig()
  const plan = state.plan ?? []
  const idx = state.current_step_index ?? 0

  // 全部完成检测：plan 中所有步骤 status 为 done/skipped/failed（failed 在重试耗尽后落库）
  // 旧逻辑用 idx >= plan.length 检测，但 DAG 并行模式下 current_step_index 不可靠
  // v1.2 #1: 改用 plan 状态扫描检测完成
  if (plan.length === 0 || _isPlanFinished(plan)) {
    return 'response'
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
      return 'response'
    }
    // continue_on_failure=true：失败步骤记 skipped 语义由 step_finalize 落库后继续
    logger.info(
      'Step %s failed, continuing to next step (continue_on_failure=true)',
      lastResult?.['step_id'] ?? 'unknown',
    )
  }

  // v1.2 #1: DAG 调度——识别就绪步骤集合
  const readyIndices = _identifyReadySteps(plan)

  if (readyIndices.length === 0) {
    // 无就绪步骤但有未完成步骤：可能存在循环依赖或全部在 running（不应发生）
    // 兜底：执行 current_step_index 指向的步骤（若已 done 则跳过）
    if (idx < plan.length) {
      const stepStatus = String(plan[idx]?.['status'] ?? '')
      if (stepStatus === 'pending') {
        return 'agent'
      }
    }
    logger.warning(
      'No ready steps but plan not finished (idx=%d, plan_len=%d), terminating',
      idx, plan.length,
    )
    return 'response'
  }

  if (readyIndices.length === 1) {
    // 单步就绪：保持原顺序逻辑（向后兼容）
    // v1.2 #6: 若 task_type=delegation 且 supervisor 节点可用，路由到 'supervisor'
    const readyIdx = readyIndices[0]
    const readyStep = plan[readyIdx] ?? {}
    const taskType = String(readyStep['task_type'] ?? '')
    if (taskType === 'delegation') {
      // 组合模式：task_type=delegation 步骤委托给 supervisor 节点
      // 通过 Send 携带 current_step，让 supervisor 感知步骤上下文
      logger.info(
        'Step %s task_type=delegation, routing to supervisor',
        String(readyStep['step_id'] ?? `step_${readyIdx + 1}`),
      )
      const messagesLen = (state.messages ?? []).length
      return [new SendClass('supervisor', {
        current_step_index: readyIdx,
        current_step: { ...readyStep, status: 'running' },
        step_msg_baseline: messagesLen,
      })]
    }
    if (readyIdx === idx) {
      return 'agent'
    }
    // idx 不匹配：通过 Send 携带正确的 current_step_index 到 step_dispatch 节点
    logger.debug(
      'Single ready step at idx=%d, but current_step_index=%d; using Send to redirect',
      readyIdx, idx,
    )
    return [new SendClass('step_dispatch', { current_step_index: readyIdx })]
  }

  // 多步就绪：通过 Send API 并行分发
  // v1.2 #6: task_type=delegation 的步骤路由到 supervisor，其他步骤路由到 agent
  // 混合并行：delegation 步骤走 supervisor 流，tool_use/reasoning 步骤走 agent 流
  logger.info(
    'DAG parallel dispatch: %d ready steps (indices=%s) trace_id=%s',
    readyIndices.length, readyIndices.join(','), state.trace_id ?? '',
  )
  const messagesLen = (state.messages ?? []).length
  return readyIndices.map((i) => {
    const step = plan[i] ?? {}
    const taskType = String(step['task_type'] ?? '')
    const target = taskType === 'delegation' ? 'supervisor' : 'agent'
    return new SendClass(target, {
      current_step_index: i,
      current_step: { ...step, status: 'running' },
      step_msg_baseline: messagesLen,
    })
  })
}

/**
 * v1.2 #1: 检测 plan 是否全部完成（对应文档 §4.1 建议1）。
 *
 * 全部完成 = 所有步骤 status 为 'done' / 'skipped' / 'failed'
 * （failed 在重试耗尽后落库，视为本步骤终结）
 *
 * 注意：'running' 状态步骤不算完成（正在执行中）；
 *       'pending' 状态步骤不算完成（未开始）。
 */
function _isPlanFinished(plan: Array<Record<string, any>>): boolean {
  if (plan.length === 0) return true
  return plan.every((s) => {
    const st = String(s?.['status'] ?? '')
    return st === 'done' || st === 'skipped' || st === 'failed'
  })
}

/**
 * v1.2 #1: 识别就绪步骤集合（对应文档 §4.1 建议1 DAG 调度）。
 *
 * 就绪条件：
 *   - step.status === 'pending'
 *   - step.depends_on 中所有依赖步骤的 status === 'done'
 *     （依赖步骤 failed/skipped 时不视为就绪，由 stepDispatch 路由决定 replan 或跳过）
 *
 * @returns 就绪步骤在 plan 中的索引列表（按 plan 顺序）
 */
function _identifyReadySteps(plan: Array<Record<string, any>>): number[] {
  const ready: number[] = []
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i] ?? {}
    if (String(step['status'] ?? '') !== 'pending') {
      continue
    }
    const dependsOn = Array.isArray(step['depends_on']) ? step['depends_on'] : []
    const allDepsDone = dependsOn.every((depId: string) => {
      const depStep = plan.find((s) => s?.['step_id'] === depId)
      return depStep && String(depStep['status'] ?? '') === 'done'
    })
    if (allDepsDone) {
      ready.push(i)
    }
  }
  return ready
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
 *
 * v1.2 #2 步骤级重试（对应文档 §4.1 建议2）：
 *   - 判定 failed 后，先读取 step.retry_policy.max_attempts（回退到 plan_execute.step_retry.default_max_attempts）
 *   - 若当前 retry_count < max_attempts：重置 step.status='pending'，递增 retry_count，
 *     不推进 current_step_index，返回 retrying SSE 事件，由 step_dispatch 重新分发
 *   - 指数退避：第 n 次重试等待 base_delay * 2^(n-1) 秒
 *   - 重试预算耗尽后才写入 failed step_results，由 step_dispatch 路由决定 replan
 *
 * v1.2 #8 started_at 合并（对应文档 §4.1 建议8）：
 *   - 读取 state.current_step.started_at（由 step_dispatch 节点写入）
 *   - 兜底读取 plan[idx].started_at（持久化字段）
 *   - 合并到 stepResult.started_at，使步骤耗时可还原
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

    // v1.2 #8: 读取 started_at（优先 current_step transient，兜底 plan[i] 持久化字段）
    const startedAt =
      typeof state.current_step?.['started_at'] === 'number'
        ? state.current_step['started_at']
        : (typeof step['started_at'] === 'number' ? step['started_at'] : undefined)

    // 1. 截取本步增量消息
    const stepMessages = _sliceStepMessages(state)

    // 2. 提取本步 tool_call_id 列表与最终 AIMessage 摘要
    // 修复: 同时统计工具成功/失败状态，识别"调用了工具但全部失败"的情况
    const toolRefs: string[] = []
    const failedToolRefs: string[] = []
    let lastAiContent = ''
    for (const msg of stepMessages) {
      const msgType = typeof (msg as any)._getType === 'function'
        ? (msg as any)._getType()
        : (msg as any).type
      if (msgType === 'tool') {
        const callId = (msg as any).tool_call_id
        if (callId && !toolRefs.includes(callId)) {
          toolRefs.push(callId)
          // 解析工具返回内容，判断是否失败
          const content = (msg as any).content ?? ''
          try {
            const parsed = typeof content === 'string' ? JSON.parse(content) : content
            if (parsed && typeof parsed === 'object' && parsed['status'] === 'error') {
              failedToolRefs.push(callId)
            }
          } catch {
            // 非 JSON content，视为成功
          }
        }
      } else if (msg instanceof AIMessage || msgType === 'ai') {
        const content = (msg as any).content
        if (typeof content === 'string' && content) {
          lastAiContent = content
        }
      }
    }

    // 失败判定（P2-优化 + 修复: 增加 requires_tool 与工具失败校验）：
    //   1. requires_tool=true 但未调用任何工具 → failed（防止 LLM 编造外部数据）
    //      例外：同代际前序步骤已成功调用工具且本步有 AI 输出时，LLM 基于已有工具
    //      结果回答是合理的（如 step_1 已调用 datetime，step_2 不必重复调用）
    //   2. requires_tool=true 且调用了工具但全部失败 → 降级判定（见下）
    //   3. 最终无 AI 输出且无任何工具产出 → failed（原有兜底判定）
    const requiresTool = Boolean(step['requires_tool'])
    const missingToolCallRaw = requiresTool && toolRefs.length === 0
    const allToolsFailedRaw = requiresTool && toolRefs.length > 0 && failedToolRefs.length === toolRefs.length
    const noOutput = !lastAiContent && toolRefs.length === 0

    // 修复: 前序步骤已成功调用工具时，本步骤基于已有结果回答不应判 missingToolCall。
    // 避免 LLM 在 step_1 已获取 datetime 后，step_2（获取日期时间）因未重复调用工具
    // 而被误判 failed → 触发不必要的重规划 → 递归耗尽。
    let missingToolCall = missingToolCallRaw
    if (missingToolCallRaw && lastAiContent) {
      const genResults = _currentGenerationResults(state)
      const prevStepHasToolSuccess = genResults.some(
        (r) => r?.['status'] === 'done' &&
               Array.isArray(r?.['tool_refs']) &&
               r['tool_refs'].length > 0,
      )
      if (prevStepHasToolSuccess) {
        missingToolCall = false
        logger.info(
          'Step %s requires_tool=true but no tool called in this step; ' +
          'allowing because previous steps have successful tool calls and AI output exists',
          stepId,
        )
      }
    }

    // 修复: 工具全失败但 LLM 产出了实质性降级内容时，视为步骤完成（降级模式）。
    // 工具失败 ≠ 步骤失败：LLM 基于工具失败状态生成降级回应（如告知用户工具不可用 +
    // 提供常识性参考）是合理的执行行为。将其判 failed 会触发无意义的重规划（相同工具
    // 仍会失败）并丢失降级输出。仅当工具失败且 LLM 无任何输出时才判 failed。
    let allToolsFailed = allToolsFailedRaw
    let degraded = false
    if (allToolsFailedRaw && lastAiContent) {
      allToolsFailed = false
      degraded = true
      logger.info(
        'Step %s all tools failed but AI produced fallback content; marking as done (degraded mode)',
        stepId,
      )
    }

    const failed = missingToolCall || allToolsFailed || noOutput

    // v1.2 #2: 步骤级重试——failed 时先尝试重试，避免浪费 replan 预算
    if (failed) {
      const retryDecision = _decideStepRetry(step, config)
      if (retryDecision.canRetry) {
        const newRetryCount = retryDecision.currentRetryCount + 1
        const delayMs = retryDecision.baseDelay * Math.pow(2, newRetryCount - 1) * 1000

        logger.warning(
          'Step %s failed, scheduling retry %d/%d (delay=%dms) trace_id=%s',
          stepId, newRetryCount, retryDecision.maxAttempts, delayMs, state.trace_id ?? '',
        )

        // 指数退避等待
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }

        // 重置 step 状态为 pending，递增 retry_count（写入 plan[i]，step_dispatch 读取）
        // 不推进 current_step_index，让 step_dispatch 重新分发同一 step
        const retriedPlan = plan.map((s, i) =>
          i === idx
            ? { ...s, status: 'pending' as const, retry_count: newRetryCount }
            : s,
        )

        return {
          plan: retriedPlan,
          // 不写入 step_results（避免 failed 记录污染代际统计）
          // 不推进 current_step_index，让 step_dispatch 重新分发同一 step
          current_step_index: idx,
          current_step: {},  // 清空，让 step_dispatch 重新写入
          plan_phase: 'executing',
          // SSE: 发出 retry 事件
          plan_delta: {
            phase: 'execute',
            step_update: {
              id: stepId,
              // 步骤在 plan 数组中的下标（0 基），供前端映射到 plan-step 节点
              index: idx,
              status: 'retrying' as any,  // 自定义 status 用于 SSE 展示
              retry_count: newRetryCount,
              max_attempts: retryDecision.maxAttempts,
              error: _buildFailureError(step, stepId, missingToolCall, allToolsFailed, toolRefs),
              started_at: startedAt,
              finished_at: finishedAt,
            },
          },
        }
      }

      logger.warning(
        'Step %s failed and retry budget exhausted (%d/%d), will trigger replan or terminate',
        stepId, retryDecision.currentRetryCount, retryDecision.maxAttempts,
      )
    }

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
    // v1.2 #8: 合并 started_at 到 step_results
    if (startedAt) {
      stepResult['started_at'] = startedAt
    }
    // v1.2 #2: 记录最终重试次数（耗尽重试后的 failed 记录或成功完成的步骤）
    const finalRetryCount = typeof step['retry_count'] === 'number' ? step['retry_count'] : 0
    if (finalRetryCount > 0) {
      stepResult['retry_count'] = finalRetryCount
    }
    if (degraded) {
      // 降级模式标记：工具失败但 LLM 产出了降级内容，便于后续步骤和 response 节点感知
      stepResult['degraded'] = true
      stepResult['error'] =
        `Step "${String(step['title'] ?? stepId)}" tools all failed but AI produced fallback content. ` +
        `The real-time data is unavailable; subsequent steps should treat the output as degraded/reference-only.`
    } else if (failed) {
      // P2-优化: 区分失败原因，便于重规划时注入精准上下文
      stepResult['error'] = _buildFailureError(step, stepId, missingToolCall, allToolsFailed, toolRefs)
    }

    // 4. 更新 plan[i].status + 推进游标
    const updatedPlan = plan.map((s, i) =>
      i === idx ? { ...s, status } : s,
    )

    logger.info(
      'Step %d/%d (%s) finalized: status=%s tools=%d retry=%d trace_id=%s',
      idx + 1, plan.length, stepId, status, toolRefs.length, finalRetryCount, state.trace_id ?? '',
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
          // 步骤在 plan 数组中的下标（0 基），供前端映射到 plan-step 节点
          index: idx,
          status,
          result: stepResult['output'],
          ...(stepResult['error'] ? { error: stepResult['error'] } : {}),
          started_at: startedAt,
          finished_at: finishedAt,
          ...(finalRetryCount > 0 ? { retry_count: finalRetryCount } : {}),
        },
      },
    }
  }

  return _stepFinalizeNode
}

/**
 * v1.2 #2: 决策步骤是否可重试（对应文档 §4.1 建议2）。
 *
 * 优先级：
 *   1. step.retry_policy.max_attempts（PlanStep 级别，由 Planner 输出）
 *   2. plan_execute.step_retry.default_max_attempts（全局配置）
 *   3. 0（不重试）
 *
 * @returns canRetry=true 时返回 maxAttempts/baseDelay/currentRetryCount
 */
function _decideStepRetry(
  step: Record<string, any>,
  config: ReturnType<typeof getConfig>,
): {
  canRetry: boolean
  maxAttempts: number
  baseDelay: number
  currentRetryCount: number
} {
  const currentRetryCount = typeof step['retry_count'] === 'number' ? step['retry_count'] : 0

  // 优先读取 step 级 retry_policy
  const stepPolicy = step['retry_policy']
  const maxAttempts =
    typeof stepPolicy?.['max_attempts'] === 'number'
      ? stepPolicy['max_attempts']
      : Number(config.get('plan_execute.step_retry.default_max_attempts', 0))
  const baseDelay =
    typeof stepPolicy?.['base_delay'] === 'number'
      ? stepPolicy['base_delay']
      : Number(config.get('plan_execute.step_retry.default_base_delay', 1))

  const canRetry = maxAttempts > 0 && currentRetryCount < maxAttempts
  return { canRetry, maxAttempts, baseDelay, currentRetryCount }
}

/**
 * 构建步骤失败错误信息（统一复用，避免重复）。
 */
function _buildFailureError(
  step: Record<string, any>,
  stepId: string,
  missingToolCall: boolean,
  allToolsFailed: boolean,
  toolRefs: string[],
): string {
  const title = String(step['title'] ?? stepId)
  if (missingToolCall) {
    return (
      `Step "${title}" requires tool invocation (requires_tool=true) but no tool was called. ` +
      `The executor MUST call an appropriate tool (e.g. search_engine, datetime, http_request) ` +
      `to obtain real-time/external data. Do not fabricate data.`
    )
  }
  if (allToolsFailed) {
    return (
      `Step "${title}" called ${toolRefs.length} tool(s) but all failed. ` +
      `The required external data could not be obtained. Consider replanning with a different approach or tool.`
    )
  }
  return 'Step produced no AI output and no tool results'
}
