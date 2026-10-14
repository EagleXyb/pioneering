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
import { computeExponentialBackoffMs } from '../adapters/retry.js'
import type { ModuAgentState } from '../state.js'
import type { PlanStep, StepResult } from './types.js'

/** 单步重试退避基数上限（秒），与 StepRetryPolicySchema.base_delay 对齐。 */
const _MAX_RETRY_BASE_DELAY_SECONDS = 10
/** 单次重试等待上限（毫秒），防止指数退避放大成请求级挂起。 */
const _MAX_RETRY_DELAY_MS = 30_000

/** P0-3：步骤被"提前交付收敛"跳过时展示给用户的原因 */
const _SKIP_REASON_EARLY_COMPLETION =
  '前序步骤已产出完整交付物（文档/终稿），本步为纯推理/写作类步骤，已跳过以避免重复产出。'

/** P0 修复：审批被拒/超时导致上一步失败后，剩余步骤收敛跳过时展示给用户的原因 */
const _SKIP_REASON_APPROVAL_REJECTED =
  '前序步骤因人工审批被拒绝或超时未执行，本步依赖其产物，已自动跳过以避免重复触发审批。'

/**
 * P1-15：supervisor 子图是否实际挂载可用。
 *
 * 图构建仅在 orchestration.multi_agent.enabled=true 时挂载 supervisor 节点；
 * task_type=delegation 的步骤在未挂载时若仍 Send 到 'supervisor' 会触发
 * unknown node 运行时崩溃。未启用时 delegation 一律降级走普通 agent。
 */
function _isSupervisorAvailable(): boolean {
  try {
    return Boolean(getConfig().get('orchestration.multi_agent.enabled', false))
  } catch {
    return false
  }
}

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

    // P0 修复：上一步因审批被拒/超时而失败 → 不再派发后续步骤，也不触发重规划。
    // 一次性把剩余 pending 步骤标记 skipped（下发 SSE），plan_phase 置 'finalizing'，
    // 让 stepDispatch 路由到收尾链路正常结束整轮。
    // 语义：用户拒绝的是具体操作（如写文档），重规划大概率再次生成同样操作、
    // 再次弹审批；且剩余步骤通常依赖被拒步骤的产物，继续执行没有意义。
    const genResults = _currentGenerationResults(state)
    const prevResult = genResults[genResults.length - 1]
    if (prevResult?.['approval_blocked'] === true) {
      const converged = _skipRemainingStepsAfterApprovalRejection(state, plan)
      if (converged) return converged
    }

    // P0-3 提前交付收敛：若前序步骤已产出完整交付物（终稿/文档），
    // 后续"纯推理、不需要外部数据"的步骤再执行只是重复劳动，
    // 且会让最终答复被最后一次重复输出覆盖。此处一次性跳过它们并激活下一个
    // 真正需要执行的步骤（requires_tool=true 或最后一步）。
    if (stepStatus === 'pending' && _shouldSkipForEarlyCompletion(state, plan, idx)) {
      return _skipRedundantStepsAndActivateNext(state, plan, idx)
    }

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
 * P2-1：构造 `Send('step_dispatch', …)` 的 payload。
 *
 * LangGraph 语义：Send 的 args 就是目标节点的**唯一输入**，不会与 channel 状态合并
 * （`node_modules/@langchain/langgraph/dist/pregel/algo.cjs`：`input: packet.args`）。
 * 因此必须把 step_dispatch 节点需要的字段全部带上，否则节点读到 `plan === undefined`
 * 会直接 return {} —— 计划状态不推进，路由下一轮又算出同一批 Send，
 * 直到 `recursionLimit` 报错（最小复现：路由被调用 4095 次）。
 */
function _sendPayload(
  state: ModuAgentState,
  idx: number,
): Record<string, any> {
  const plan = state.plan ?? []
  return {
    plan,
    current_step_index: idx,
    current_step: { ...(plan[idx] ?? {}), status: 'running' },
    step_msg_baseline: (state.messages ?? []).length,
    step_results: state.step_results ?? [],
    replan_count: state.replan_count ?? 0,
    plan_phase: state.plan_phase ?? 'executing',
    artifacts: state.artifacts ?? [],
    trace_id: state.trace_id ?? '',
  }
}

/**
 * P0-3：判定某一步是否可以被"提前交付收敛"跳过。
 *
 * 跳过条件（全部满足）：
 *   1. 本代际已有步骤被 step_finalize 标记为 `early_completion`
 *      （即该步已经产出了整体交付物：完整文档/终稿）
 *   2. 该步骤不需要外部/实时数据（`requires_tool !== true`）——
 *      需要真实数据的步骤不能跳过，否则会失去外部信息
 *   3. 该步骤不是最后一步——最后一步通常是整合/校验，必须执行
 */
function _shouldSkipForEarlyCompletion(
  state: ModuAgentState,
  plan: Array<Record<string, any>>,
  idx: number,
): boolean {
  const early = _currentGenerationResults(state).some(
    (r) => r?.['early_completion'] === true,
  )
  if (!early) return false

  const step = plan[idx] ?? {}
  if (Boolean(step['requires_tool'])) return false
  // 最后一步保留执行（整合/校验/交付）
  if (idx >= plan.length - 1) return false
  return true
}

/**
 * P0-3：跳过冗余步骤并激活下一个真正需要执行的步骤。
 *
 * 与"逐个跳过"的区别：这里在**一次节点调用内**把所有可跳过的 pending 步骤
 * 一次性标记 skipped（每条发一个 SSE step_update），再激活下一个需执行的步骤。
 * 若逐个跳过，路由会落在 `_identifyReadySteps` 的多步就绪分支（Send 路径），
 * 而该分支在当前 LangGraph 语义下拿不到图状态（见 P2-1），会空转至递归上限。
 */
function _skipRedundantStepsAndActivateNext(
  state: ModuAgentState,
  plan: Array<Record<string, any>>,
  idx: number,
): Partial<ModuAgentState> {
  const now = Date.now()
  const updatedPlan: Array<Record<string, any>> = [...plan]
  const stepUpdates: Array<Record<string, any>> = []

  let nextIdx = -1
  for (let i = idx; i < updatedPlan.length; i++) {
    const s = updatedPlan[i] ?? {}
    if (String(s['status'] ?? '') !== 'pending') continue

    const isLastStep = i >= updatedPlan.length - 1
    if (Boolean(s['requires_tool']) || isLastStep) {
      nextIdx = i
      break
    }

    // 可跳过：纯推理/写作且非末步
    updatedPlan[i] = { ...s, status: 'skipped', finished_at: now }
    stepUpdates.push({
      id: String(s['step_id'] ?? `step_${i + 1}`),
      index: i,
      status: 'skipped',
      result: _SKIP_REASON_EARLY_COMPLETION,
      finished_at: now,
    })
  }

  // 全部可跳过（无需要执行的步骤）→ 计划收敛
  if (nextIdx < 0) {
    logger.info(
      'Early-completion convergence: skipped %d redundant step(s), plan finished trace_id=%s',
      stepUpdates.length, state.trace_id ?? '',
    )
    return {
      plan: updatedPlan,
      plan_phase: 'finalizing',
      plan_delta: { phase: 'execute', step_updates: stepUpdates },
    }
  }

  const nextStep = updatedPlan[nextIdx] ?? {}
  const nextStepId = String(nextStep['step_id'] ?? `step_${nextIdx + 1}`)
  updatedPlan[nextIdx] = { ...nextStep, status: 'running', started_at: now }
  stepUpdates.push({
    id: nextStepId,
    index: nextIdx,
    status: 'running',
    started_at: now,
  })

  logger.info(
    'Early-completion convergence: skipped %d redundant step(s), activating step %d/%d (%s) trace_id=%s',
    stepUpdates.filter((u) => u.status === 'skipped').length,
    nextIdx + 1, updatedPlan.length, nextStepId, state.trace_id ?? '',
  )

  return {
    plan: updatedPlan,
    current_step_index: nextIdx,
    current_step: { ...nextStep, status: 'running', started_at: now },
    step_msg_baseline: (state.messages ?? []).length,
    plan_phase: 'executing',
    step_round_count: 0,
    plan_delta: { phase: 'execute', step_updates: stepUpdates },
  }
}

/**
 * P0 修复：审批被拒/超时后收敛剩余步骤。
 *
 * 上一步因人工审批被拒/超时而 failed（stepResult.approval_blocked=true）时，
 * 把剩余所有 pending 步骤一次性标记 skipped（每条下发 SSE step_update），
 * plan_phase 置 'finalizing'，让 stepDispatch 路由到收尾链路正常结束整轮。
 *
 * 不做重规划：重规划大概率再次生成同类工具操作 → 再次弹审批，形成
 * "拒绝 → 重规划 → 再拒绝"循环；且剩余步骤通常依赖被拒步骤的产物。
 *
 * @returns 有 pending 步骤被跳过时返回状态更新；无剩余 pending 时返回 null（交回原逻辑）
 */
function _skipRemainingStepsAfterApprovalRejection(
  state: ModuAgentState,
  plan: Array<Record<string, any>>,
): Partial<ModuAgentState> | null {
  const now = Date.now()
  const updatedPlan: Array<Record<string, any>> = [...plan]
  const stepUpdates: Array<Record<string, any>> = []

  for (let i = 0; i < updatedPlan.length; i++) {
    const s = updatedPlan[i] ?? {}
    if (String(s['status'] ?? '') !== 'pending') continue
    updatedPlan[i] = { ...s, status: 'skipped', finished_at: now }
    stepUpdates.push({
      id: String(s['step_id'] ?? `step_${i + 1}`),
      index: i,
      status: 'skipped',
      result: _SKIP_REASON_APPROVAL_REJECTED,
      finished_at: now,
    })
  }

  if (stepUpdates.length === 0) return null

  logger.info(
    'Approval rejected: skipped %d remaining step(s), converging plan trace_id=%s',
    stepUpdates.length, state.trace_id ?? '',
  )
  return {
    plan: updatedPlan,
    plan_phase: 'finalizing',
    plan_delta: { phase: 'execute', step_updates: stepUpdates },
  }
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

  // P0 修复（回归：含依赖计划第一步即死）：
  // step_dispatch 节点已把当前步由 pending 标记为 running（见 _stepDispatchNode），
  // 而 _identifyReadySteps 只收集 pending 步骤——当前步被排除后，其下游步骤因依赖
  // 未满足同样不就绪，路由会误判 "No ready steps" 并静默终止。
  // 此处优先识别"已被节点激活、等待派发"的当前步，直接交给 agent 执行。
  // 安全性：plan 中 status='running' 只可能由 _stepDispatchNode 写入（agent 执行期间
  // 不改 plan），因此该分支不会重复派发真正在执行中的步骤。
  if (
    idx >= 0 &&
    idx < plan.length &&
    String(plan[idx]?.['status'] ?? '') === 'running'
  ) {
    // delegation 步骤保持组合模式语义：委托给 supervisor 子图（P1-15 守卫：
    // 未挂载 supervisor 时降级普通 agent），与单步就绪分支的路由保持一致，
    // 避免"已激活"快捷路径绕过 delegation 判定。
    const activatedStep = plan[idx] ?? {}
    const activatedTaskType = String(activatedStep['task_type'] ?? '')
    if (activatedTaskType === 'delegation' && _isSupervisorAvailable()) {
      const messagesLen = (state.messages ?? []).length
      return [new SendClass('supervisor', {
        current_step_index: idx,
        current_step: { ...activatedStep, status: 'running' },
        step_msg_baseline: messagesLen,
      })]
    }
    logger.debug(
      'step_dispatch: plan[%d] activated (running), dispatching to agent',
      idx,
    )
    return 'agent'
  }

  // v1.2 #1: DAG 调度——识别就绪步骤集合
  const readyIndices = _identifyReadySteps(plan)

  if (readyIndices.length === 0) {
    // 无就绪步骤但有未完成步骤：可能存在循环依赖或依赖 failed/skipped 步骤的悬空分支
    // 兜底：执行 current_step_index 指向的步骤（若仍为 pending 则直接派发）
    if (idx < plan.length) {
      const stepStatus = String(plan[idx]?.['status'] ?? '')
      if (stepStatus === 'pending') {
        return 'agent'
      }
    }
    // P0 修复：无可执行步骤时不得静默按"成功"收尾——原实现 return 'response' 会让上游
    // 发出 RUN_FINISHED，前端横幅显示"已完成"但实际一步未执行（假成功）。
    // 抛错让上游发 RUN_ERROR，用户可见"失败"与具体卡住的步骤。
    const stalledPending = plan
      .map((s, i) => ({
        id: String(s?.['step_id'] ?? `step_${i + 1}`),
        status: String(s?.['status'] ?? ''),
        deps: Array.isArray(s?.['depends_on']) ? s['depends_on'] : [],
      }))
      .filter((s) => s.status === 'pending')
      .slice(0, 5)
    logger.error(
      'No ready steps but plan not finished (idx=%d, plan_len=%d), aborting with error. pending=%s',
      idx, plan.length, JSON.stringify(stalledPending),
    )
    throw new Error(
      'Plan execution stalled: no executable steps. ' +
      `currentIndex=${idx}, total=${plan.length}, ` +
      `pending=[${stalledPending.map((s) => `${s.id}(deps=${JSON.stringify(s.deps)})`).join(', ')}]`,
    )
  }

  if (readyIndices.length === 1) {
    // 单步就绪：保持原顺序逻辑（向后兼容）
    // v1.2 #6 + P1-15: 仅当 task_type=delegation **且 supervisor 子图已挂载**
    // （multi_agent.enabled=true）时才路由到 'supervisor'；否则降级普通 agent，
    // 避免在未挂载 supervisor 的图配置下抛 unknown node。
    const readyIdx = readyIndices[0]
    const readyStep = plan[readyIdx] ?? {}
    const taskType = String(readyStep['task_type'] ?? '')
    if (taskType === 'delegation' && _isSupervisorAvailable()) {
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
    if (taskType === 'delegation') {
      logger.warning(
        'Step %s task_type=delegation but multi_agent supervisor is not enabled; falling back to agent',
        String(readyStep['step_id'] ?? `step_${readyIdx + 1}`),
      )
    }
    if (readyIdx === idx) {
      return 'agent'
    }
    // idx 不匹配：通过 Send 携带正确的 current_step_index 到 step_dispatch 节点
    logger.debug(
      'Single ready step at idx=%d, but current_step_index=%d; using Send to redirect',
      readyIdx, idx,
    )
    // P2-1：Send 的 payload 就是目标节点的**完整输入**（LangGraph 语义：
    // `input: packet.args`，不会与 channel 状态合并）。此前只带 current_step_index，
    // 节点读到 `state.plan === undefined` → 直接 return {} → 计划状态不推进 →
    // 路由每轮算出同一批 Send → 空转直到 recursion limit（已用最小复现图验证）。
    // 修复：payload 携带节点所需的全部状态字段。
    return [new SendClass('step_dispatch', _sendPayload(state, readyIdx))]
  }

  // 多步就绪
  // v1.2 #6: task_type=delegation 的步骤路由到 supervisor，其他步骤路由到 agent
  // P1-15: supervisor 未挂载时 delegation 步骤同样降级 agent（混合并行不炸图）
  const supervisorAvailable = _isSupervisorAvailable()
  if (!supervisorAvailable && readyIndices.some((i) => String(plan[i]?.['task_type'] ?? '') === 'delegation')) {
    logger.warning('DAG batch contains delegation step(s) but supervisor is disabled; dispatching them to agent')
  }

  // P2-1：真并行暂不启用，改为按就绪顺序逐个派发。
  //
  // 原因（两类缺陷，均已实测/源码确认）：
  //   1. 状态竞争：每个并行分支都会整表替换 `plan`，而 plan 是 last-write-wins
  //      reducer —— 后完成的分支会覆盖先完成的，导致其余步骤的 running 标记丢失，
  //      这些步骤再也不会被 step_finalize 收尾（永远停在 pending）。
  //   2. Send payload 语义：Send 的 args 是目标节点的唯一输入，早期实现只带
  //      current_step_index，节点读不到 plan → return {} → 路由每轮算出同一批
  //      Send → 空转至 recursion limit。
  // 现状下"激活分支"本就先于本分支短路（顺序执行），因此逐个派发与当前实际
  // 行为一致，且保留了正确的执行语义。待 plan 具备按 index 合并的 reducer 后
  // 再启用真并行。
  const firstReady = readyIndices[0]
  logger.info(
    'DAG dispatch: %d ready step(s) (indices=%s) → dispatching first (idx=%d) trace_id=%s',
    readyIndices.length, readyIndices.join(','), firstReady, state.trace_id ?? '',
  )
  return [new SendClass('step_dispatch', _sendPayload(state, firstReady))]
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
    //
    // P0 修复：审批被拒/超时/错误 → 本步直接判 failed。
    // 场景：human_review resume 后回 step_finalize 收尾（见 routeAfterHumanReview）。
    // 以 approval_status 为硬证据判定，不依赖消息层面的推断——否则
    // "LLM 过程正文 + rejection ToolMessage" 会被降级模式误判为 done。
    const approvalBlocked =
      state.plan_phase === 'executing' &&
      (state.approval_status === 'rejected' ||
        state.approval_status === 'timeout' ||
        state.approval_status === 'error')

    let allToolsFailed = allToolsFailedRaw
    let degraded = false
    // 审批被拒/超时不属于"工具失败降级"（approvalBlocked 已强制 failed），
    // 跳过降级判定，避免打出误导性的 "marking as done (degraded mode)" 日志
    if (allToolsFailedRaw && lastAiContent && !approvalBlocked) {
      allToolsFailed = false
      degraded = true
      logger.info(
        'Step %s all tools failed but AI produced fallback content; marking as done (degraded mode)',
        stepId,
      )
    }

    const failed = approvalBlocked || missingToolCall || allToolsFailed || noOutput

    // v1.2 #2: 步骤级重试——failed 时先尝试重试，避免浪费 replan 预算。
    // 审批被拒/超时例外：用户已明确拒绝该操作，自动重试会立即再次触发审批弹窗，
    // 毫无意义——直接落 failed，由 step_dispatch 收敛剩余步骤。
    if (failed && !approvalBlocked) {
      const retryDecision = _decideStepRetry(step, config)
      if (retryDecision.canRetry) {
        const newRetryCount = retryDecision.currentRetryCount + 1
        // 统一走共享退避实现（毫秒口径），并整体钳制到 _MAX_RETRY_DELAY_MS
        const delayMs = computeExponentialBackoffMs(
          newRetryCount - 1,
          retryDecision.baseDelay * 1000,
          _MAX_RETRY_DELAY_MS,
        )

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
          // P0-2: 本步重新执行 → 当前步骤轮次归零，重试不该继承已耗尽的预算
          step_round_count: 0,
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

    // P0-3：检测本步是否已产出"整体交付物"（越级完成）。
    // 判定（同时满足才算）：
    //   · 本步成功且有正文
    //   · 本步不是最后一步
    //   · 后面仍有 pending 步骤
    //   · 已产出文档产物（artifacts 含 document/doc_writer）**或** 正文长度达到终稿量级
    // 该标记会被 step_dispatch 读取，用于跳过后续纯推理/写作类的冗余步骤。
    const isLastStep = idx >= plan.length - 1
    const remainingPending = plan.filter(
      (s, i) => i > idx && String(s?.['status'] ?? '') === 'pending',
    ).length
    const hasDocArtifact = (state.artifacts ?? []).some(
      (a) => a && (String(a['type'] ?? '') === 'document' || String(a['tool'] ?? '') === 'doc_writer'),
    )
    // 判定只以「已产出文档产物」为硬证据。
    // 不采用"正文长度"作为依据：实测中 step_1 的"知识框架/大纲"就能写到 2000+ 字，
    // 若按长度判定会把 step_2~step_6（真正的内容撰写步骤）误判为冗余而跳过，
    // 最终只剩大纲 —— 比不收敛更糟。文档产物是明确的交付证据，误判风险最低。
    const earlyCompletion = remainingPending > 0 && !isLastStep && hasDocArtifact

    const status: StepResult['status'] = failed ? 'failed' : 'done'

    // 3. 组装步骤结果（replan 代际标签隔离重规划前旧结果）
    //
    // P1-1：此前 `output` 直接按 step_summary_max_chars（默认 500）截断，
    // 导致：①后续步骤只能看到前序步骤 500 字符摘要；②前端步骤面板与
    // DB plan_steps.result 同样只有 500 字符 —— 长文档/长清单类步骤的产物几乎全部丢失。
    // 现在 `output` 保存完整产物（受 step_result_max_chars 上限保护，防 checkpoint 膨胀），
    // 另存 `output_summary` 供上下文注入（仍按 step_summary_max_chars 截断）。
    const resultMaxChars = Number(
      config.get('plan_execute.step_result_max_chars', 8000),
    )
    const stepResult: Record<string, any> = {
      step_id: stepId,
      status,
      output: _truncate(lastAiContent, resultMaxChars),
      output_summary: _truncate(lastAiContent, summaryMaxChars),
      tool_refs: toolRefs,
      replan: state.replan_count ?? 0,
      finished_at: finishedAt,
    }
    // v1.2 #8: 合并 started_at 到 step_results
    if (startedAt) {
      stepResult['started_at'] = startedAt
    }
    // P0 修复：标记"本步失败源于审批被拒/超时"，供 step_dispatch 收敛剩余步骤
    // （不再触发重规划——重规划大概率再次生成同样操作、再次弹审批）。
    if (approvalBlocked) {
      stepResult['approval_blocked'] = true
    }
    // v1.2 #2: 记录最终重试次数（耗尽重试后的 failed 记录或成功完成的步骤）
    const finalRetryCount = typeof step['retry_count'] === 'number' ? step['retry_count'] : 0
    if (finalRetryCount > 0) {
      stepResult['retry_count'] = finalRetryCount
    }
    // P2-4：本步输出曾被 max_tokens 截断 → 记录到步骤结果，前端提示"可能不完整"
    if (state.output_truncated) {
      stepResult['truncated'] = true
    }
    // P0-3：标记"本步已产出整体交付物"，供 step_dispatch 收敛后续冗余步骤
    if (earlyCompletion && status !== 'failed') {
      stepResult['early_completion'] = true
      logger.info(
        'Step %s produced the whole deliverable ahead of schedule (%d chars, doc=%s); ' +
        'redundant reasoning steps will be skipped',
        stepId, lastAiContent.length, String(hasDocArtifact),
      )
    }
    if (approvalBlocked) {
      // P0 修复：审批被拒/超时——优先于降级/工具失败文案，明确标注本步未执行
      stepResult['error'] =
        `Step "${String(step['title'] ?? stepId)}" was not executed: ` +
        `tool approval ${String(state.approval_status ?? '')} (rejected by reviewer or timed out).`
    } else if (degraded) {
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
      // P0-2: 当前步骤结束 → 步骤轮次归零。
      // 否则后续步骤会继承本步已用尽的工具预算，一进 agent 就再次触顶
      // （原缺陷：reasoning_round_count 全 run 累加且永不重置）
      step_round_count: 0,
      // P0-2: 清除"本轮因工具上限中止"标记（force_finalize 写入），
      // 避免该标记泄漏到后续步骤、让后续步骤的兜底文案误报"已中止"
      ...(state.forced_finalize ? { forced_finalize: false } : {}),
      // P2-4：复位截断标记（避免泄漏到下一步）
      ...(state.output_truncated ? { output_truncated: false } : {}),
      // P0 修复：审批拒绝/超时收尾后清理审批态，避免泄漏到后续步骤
      // （step_finalize 以 approval_status 判定"本步被审批拦截"，必须归零）
      ...(approvalBlocked
        ? { approval_status: '', approval_feedback: '', tool_requires_approval: false }
        : {}),
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
          // P2-4：输出被 max_tokens 截断 → 前端提示"本步内容可能不完整"
          ...(stepResult['truncated'] ? { truncated: true } : {}),
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
  const rawMaxAttempts =
    typeof stepPolicy?.['max_attempts'] === 'number'
      ? stepPolicy['max_attempts']
      : Number(config.get('plan_execute.step_retry.default_max_attempts', 0))
  const rawBaseDelay =
    typeof stepPolicy?.['base_delay'] === 'number'
      ? stepPolicy['base_delay']
      : Number(config.get('plan_execute.step_retry.default_base_delay', 1))

  // 修复（请求级挂死）：retry_policy 由 LLM 输出，原实现直接使用未校验的值，
  // 若 LLM 输出 base_delay=100，指数退避 100 * 2^n 秒会让请求长时间挂起。
  // 这里统一钳制到 [0, 10] 秒，maxAttempts 钳制到 [0, 5]（与 StepRetryPolicySchema 对齐）。
  const maxAttempts = Math.min(Math.max(Number.isFinite(rawMaxAttempts) ? rawMaxAttempts : 0, 0), 5)
  const baseDelay = Math.min(
    Math.max(Number.isFinite(rawBaseDelay) ? rawBaseDelay : 1, 0),
    _MAX_RETRY_BASE_DELAY_SECONDS,
  )

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
