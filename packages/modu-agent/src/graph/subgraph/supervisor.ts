// 对应 Python: modu_graph/subgraph/supervisor.py
// P3-12.3.1 Supervisor 节点：任务拆分 + Send 并行分发。
//
// Supervisor 分析用户输入，将其拆分为多个子任务（research/coding/review 等），
// 通过 LangGraph Send API 并行分发到 subagent_run 节点。
//
// 数据流：
//   Supervisor Node
//       ↓ return {"subtasks": [...]}
//   route_from_supervisor (conditional edge)
//       ↓ return [Send("subagent_run", {"current_subtask": task}) ...]
//   subagent_run × N (并行执行)
//       ↓ return {"subtask_results": {task_id: result}}
//   consensus_node (汇总)
//
// 关键设计：
//   - 任务拆分尊重 orchestration.multi_agent.max_subagents 上限
//   - 每个子任务携带唯一 task_id，结果按 task_id 收集
//   - current_subtask 为 transient 字段，仅 Send 携带，节点不返回
//
// v1.4 §4.4 改造：
//   - 建议1：新增 decompose_task_with_llm，LLM 驱动拆分有依赖关系的子任务列表
//   - 建议5：支持 supervisor_max_rounds 多轮拆分（动态子 Agent 生成）
//   - 建议4：检测 subtask_results 中的 need_help 信号，触发重新拆分
import { randomUUID } from 'crypto'

import type { Send } from '@langchain/langgraph'
import { Send as SendClass } from '@langchain/langgraph'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

import { getConfig } from '../../config/runtime-config.js'
import type { ModuAgentState } from '../state.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[graph.subgraph.supervisor] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[graph.subgraph.supervisor] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[graph.subgraph.supervisor] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[graph.subgraph.supervisor] ${msg}`, ...args),
}

// 默认子任务类型模板（按用户输入拆分为多视角子任务）
const _DEFAULT_TASK_TYPES = ['research', 'coding', 'review']

/**
 * v1.4 §4.4 建议1：LLM 任务拆分提示词。
 *
 * 引导 LLM 将用户目标拆分为有依赖关系的子任务列表，
 * 每个子任务携带 task_type / description / depends_on，
 * 而非 v1.3 前的"相同 prompt 不同视角"。
 */
const _LLM_DECOMPOSE_PROMPT =
  'You are a task decomposition agent. Break down the user\'s goal into a JSON array of subtasks.\n' +
  'Each subtask: {"task_type": "research|coding|review|default", "description": "<specific subtask>", "depends_on": ["<task_id>")}]}\n' +
  'Rules:\n' +
  '- At most {max_subagents} subtasks\n' +
  '- task_type must be one of: research, coding, review, default\n' +
  '- depends_on lists task_ids that must complete before this one starts (empty array = no deps)\n' +
  '- Each description must be specific and actionable\n' +
  'Respond with ONLY the JSON array, no prose.\n' +
  'User goal: {goal}'

/**
 * 将用户输入拆分为多个子任务（规则化版本，向后兼容）。
 *
 * 拆分策略（规则化，确保确定性 + 可测试）：
 *   - 按配置的 task_types 列表为每个类型创建一个子任务
 *   - 每个子任务携带相同 prompt 但不同 task_type（视角）
 *   - 子任务数不超过 max_subagents
 *
 * @param state 主图状态
 * @param maxSubagents 最大子 Agent 数量上限
 * @param taskTypes 自定义任务类型列表（null=使用默认 research/coding/review）
 * @returns 子任务列表，每个元素含 task_id / task_type / task_input
 */
export function decompose_task(
  state: ModuAgentState,
  maxSubagents: number = 5,
  taskTypes?: string[] | null,
): Array<Record<string, any>> {
  let types = taskTypes || _DEFAULT_TASK_TYPES
  // 限制子任务数不超过 max_subagents
  types = types.slice(0, maxSubagents)

  const inputData = state.input_data || {}
  const prompt = inputData.prompt || state.cleaned_text || ''
  const traceId = state.trace_id || ''
  const sessionId = state.session_id || ''

  const subtasks: Array<Record<string, any>> = []
  for (const taskType of types) {
    const taskId = `${taskType}_${randomUUID().replace(/-/g, '').slice(0, 8)}`
    subtasks.push({
      task_id: taskId,
      task_type: taskType,
      task_input: {
        prompt,
        task_type: taskType,
        trace_id: traceId,
        session_id: sessionId,
      },
    })
  }

  logger.info(
    'Task decomposed into %d subtasks: types=%s trace_id=%s',
    subtasks.length,
    types,
    traceId,
  )
  return subtasks
}

/**
 * v1.4 §4.4 建议1：LLM 驱动任务拆分。
 *
 * 与规则化 decompose_task 的区别：
 *   - 每个子任务有独立的 description（具体子任务），而非相同 prompt
 *   - 支持 depends_on 字段表达子任务间依赖（如"先搜索再总结"）
 *   - LLM 根据用户目标智能选择 task_type 数量和种类
 *
 * 失败时自动 fallback 到规则化 decompose_task，确保可用性。
 *
 * @param state 主图状态
 * @param llm LLM 实例（null=直接 fallback 到规则化）
 * @param maxSubagents 最大子 Agent 数
 * @returns 子任务列表
 */
export async function decompose_task_with_llm(
  state: ModuAgentState,
  llm: any | null,
  maxSubagents: number = 5,
): Promise<Array<Record<string, any>>> {
  if (!llm) {
    return decompose_task(state, maxSubagents)
  }

  const inputData = state.input_data || {}
  const goal = inputData.prompt || state.cleaned_text || ''
  const traceId = state.trace_id || ''
  const sessionId = state.session_id || ''

  const prompt = _LLM_DECOMPOSE_PROMPT
    .replace('{max_subagents}', String(maxSubagents))
    .replace('{goal}', goal)

  try {
    const messages = [
      new SystemMessage({ content: 'You are a task decomposition assistant.' }),
      new HumanMessage({ content: prompt }),
    ]
    const response = await llm.invoke(messages)
    const content = (response as any).content ?? ''
    // 提取 JSON 数组（容错：LLM 可能在 JSON 前后加解释文字）
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      throw new Error('No JSON array found in LLM response')
    }
    const parsed: Array<Record<string, any>> = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('LLM returned empty or invalid subtask array')
    }

    const subtasks: Array<Record<string, any>> = []
    for (const item of parsed.slice(0, maxSubagents)) {
      const taskType = item.task_type ?? 'default'
      const taskId = `${taskType}_${randomUUID().replace(/-/g, '').slice(0, 8)}`
      const description = item.description ?? goal
      subtasks.push({
        task_id: taskId,
        task_type: taskType,
        depends_on: Array.isArray(item.depends_on) ? item.depends_on : [],
        task_input: {
          prompt: description, // v1.4：用 LLM 生成的具体子任务描述替代原始 prompt
          task_type: taskType,
          trace_id: traceId,
          session_id: sessionId,
        },
      })
    }

    logger.info(
      'LLM decomposed into %d subtasks: types=%s trace_id=%s',
      subtasks.length,
      subtasks.map((s) => s.task_type).join(','),
      traceId,
    )
    return subtasks
  } catch (e) {
    logger.warning(
      'LLM decomposition failed, falling back to rule-based: %s',
      String(e),
    )
    return decompose_task(state, maxSubagents)
  }
}

/**
 * 创建 Supervisor 节点函数。
 *
 * Supervisor 节点职责：
 *   1. 从 state 读取用户输入
 *   2. 调用 decompose_task 拆分子任务（v1.4：优先 LLM 驱动）
 *   3. 将子任务列表写入 state（供 Send 路由函数读取）
 *   4. 重置 subtask_results（清空上一轮结果）
 *
 * v1.4 §4.4 改造：
 *   - 建议1：plannerLlm 非空时使用 decompose_task_with_llm
 *   - 建议4：检测上轮 subtask_results 中的 need_help 信号
 *   - 建议5：动态子 Agent 生成（多轮拆分）
 *
 * Send 分发由 route_from_supervisor 条件路由函数完成（返回 Send 列表）。
 *
 * @param maxSubagents 最大子 Agent 数（null=从配置读取）
 * @param taskTypes 自定义任务类型列表（null=使用默认）
 * @param plannerLlm LLM 实例用于任务拆分（null=规则化拆分）
 * @returns Supervisor 节点函数
 */
export function make_supervisor_node(
  maxSubagents?: number | null,
  taskTypes?: string[] | null,
  plannerLlm?: any | null,
): (state: ModuAgentState) => Promise<Record<string, any>> {
  async function _supervisorNode(state: ModuAgentState): Promise<Record<string, any>> {
    const config = getConfig()
    const multiAgentCfg = config.get('orchestration.multi_agent', {}) || {}

    const effectiveMax =
      maxSubagents != null ? maxSubagents : multiAgentCfg.max_subagents ?? 5
    const useLlm = multiAgentCfg['use_llm_decompose'] !== false && plannerLlm

    // v1.4 §4.4 建议4：检测上轮 need_help 信号
    const prevResults = state.subtask_results ?? {}
    const needHelpTasks = Object.entries(prevResults)
      .filter(([, r]) => (r as any)?.['status'] === 'need_help')
      .map(([tid, r]) => ({ task_id: tid, reason: (r as any)?.['reason'] ?? '' }))

    if (needHelpTasks.length > 0) {
      logger.warning(
        'Supervisor received need_help from %d subtasks, re-decomposing: %s',
        needHelpTasks.length,
        needHelpTasks.map((t) => t.task_id).join(','),
      )
      // v1.4 §4.4 建议5：动态子 Agent 生成——保留成功的子任务，重新拆分 need_help 的
      const keptSubtasks = (state.subtasks ?? []).filter(
        (t) => !needHelpTasks.some((nh) => nh.task_id === t['task_id']),
      )
      const reDecomposed = useLlm
        ? await decompose_task_with_llm(state, plannerLlm, effectiveMax - keptSubtasks.length)
        : decompose_task(state, Math.max(1, effectiveMax - keptSubtasks.length), taskTypes)

      const newSubtasks = [...keptSubtasks, ...reDecomposed]
      return {
        subtasks: newSubtasks,
        subtask_results: {}, // 清空，重新收集
        consensus_failed: false,
        supervisor_round: (state as any)['supervisor_round'] ?? 1 + 1,
      }
    }

    // v1.4 §4.4 建议1：优先 LLM 驱动拆分
    const subtasks = useLlm
      ? await decompose_task_with_llm(state, plannerLlm, effectiveMax)
      : decompose_task(state, effectiveMax, taskTypes)

    if (subtasks.length === 0) {
      logger.warning('Supervisor produced no subtasks, falling back to empty')
      return {
        subtasks: [],
        subtask_results: {},
        consensus_failed: true,
      }
    }

    return {
      subtasks,
      subtask_results: {}, // 重置，收集本轮子任务结果
      consensus_failed: false,
    }
  }

  return _supervisorNode
}

/**
 * Supervisor 条件路由：返回 Send 列表并行分发子任务。
 *
 * 从 state 读取 subtasks，为每个子任务生成一个 Send 对象，
 * 目标节点为 subagent_run，携带 current_subtask 数据。
 *
 * LangGraph 会并行调度所有 Send，各子任务独立执行后结果通过
 * merge_subtask_results reducer 合并到 subtask_results。
 *
 * v1.4 §4.4 建议1：依赖关系（depends_on）处理——
 * 当前实现为简化版：所有无依赖的子任务并行分发，
 * 有依赖的子任务在依赖完成后由 Supervisor 重新分发。
 * 完整 DAG 调度由 Plan-Execute 模式的 dispatcher 承担。
 *
 * @param state 当前图状态
 * @returns Send 对象列表（每个子任务一个）；无子任务时返回空列表走 END
 */
export function route_from_supervisor(state: ModuAgentState): Send[] {
  const subtasks = state.subtasks || []
  if (!subtasks || subtasks.length === 0) {
    return []
  }

  // v1.4 §4.4 建议1：过滤出无依赖（或依赖已完成）的子任务并行分发
  const completedTaskIds = new Set(
    Object.entries(state.subtask_results ?? {})
      .filter(([, r]) => (r as any)?.['status'] === 'success')
      .map(([tid]) => tid),
  )

  const sends: Send[] = []
  for (const task of subtasks) {
    const taskId = task['task_id'] ?? ''
    // 已有结果的跳过（避免重复执行）
    if (completedTaskIds.has(taskId)) continue

    const deps = Array.isArray(task['depends_on']) ? task['depends_on'] : []
    const depsReady = deps.every((d: string) => completedTaskIds.has(d))
    if (!depsReady) {
      logger.debug(
        'Subtask %s waiting for deps: %s',
        taskId, deps.join(','),
      )
      continue
    }
    sends.push(new SendClass('subagent_run', { current_subtask: task }))
  }

  logger.debug('Supervisor dispatching %d Send(s) to subagent_run', sends.length)
  return sends
}
