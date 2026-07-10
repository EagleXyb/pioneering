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
import { randomUUID } from 'crypto'

import type { Send } from '@langchain/langgraph'
import { Send as SendClass } from '@langchain/langgraph'

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
 * 将用户输入拆分为多个子任务。
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
 * 创建 Supervisor 节点函数。
 *
 * Supervisor 节点职责：
 *   1. 从 state 读取用户输入
 *   2. 调用 decompose_task 拆分子任务
 *   3. 将子任务列表写入 state（供 Send 路由函数读取）
 *   4. 重置 subtask_results（清空上一轮结果）
 *
 * Send 分发由 route_from_supervisor 条件路由函数完成（返回 Send 列表）。
 *
 * @param maxSubagents 最大子 Agent 数（null=从配置读取）
 * @param taskTypes 自定义任务类型列表（null=使用默认）
 * @returns Supervisor 节点函数
 */
export function make_supervisor_node(
  maxSubagents?: number | null,
  taskTypes?: string[] | null,
): (state: ModuAgentState) => Record<string, any> {
  function _supervisorNode(state: ModuAgentState): Record<string, any> {
    const config = getConfig()
    const multiAgentCfg = config.get('orchestration.multi_agent', {}) || {}

    const effectiveMax =
      maxSubagents != null ? maxSubagents : multiAgentCfg.max_subagents ?? 5

    const subtasks = decompose_task(state, effectiveMax, taskTypes)

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
 * @param state 当前图状态
 * @returns Send 对象列表（每个子任务一个）；无子任务时返回空列表走 END
 */
export function route_from_supervisor(state: ModuAgentState): Send[] {
  const subtasks = state.subtasks || []
  if (!subtasks || subtasks.length === 0) {
    return []
  }

  const sends: Send[] = []
  for (const task of subtasks) {
    sends.push(new SendClass('subagent_run', { current_subtask: task }))
  }

  logger.debug('Supervisor dispatching %d Send(s) to subagent_run', sends.length)
  return sends
}
