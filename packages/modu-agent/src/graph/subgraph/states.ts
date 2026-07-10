// 对应 Python: modu_graph/subgraph/states.py
// P3-12.3.1 子 Agent 隔离状态定义。
//
// 每个子 Agent 使用独立的 SubAgentState，避免并行执行时
// 多个子 Agent 的 messages 写入主 ModuAgentState.messages
// 导致顺序非确定（风险 R2）。
//
// 子图仅在自身状态空间内操作，结果通过 task_output 返回，
// 由主图的 consensus_node 汇总写入主 state。
import type { BaseMessage } from '@langchain/core/messages'
import { Annotation, messagesStateReducer } from '@langchain/langgraph'

/**
 * Last-write-wins reducer 工厂（与 state.ts 中 _lw 相同）。
 * LangGraph JS 的 SingleReducer 要求提供 reducer 函数。
 */
function _lw<T>(defaultValue: () => T): {
  reducer: (left: T, right: T) => T
  default: () => T
} {
  return {
    reducer: (_left: T, right: T) => right,
    default: defaultValue,
  }
}

/**
 * 子 Agent 独立状态注解。
 *
 * 使用 Annotation.Root 构建带 reducer 的状态注解。
 * 对应 Python SubAgentState (TypedDict)。
 *
 * 字段：
 *   task_id          - 子任务唯一标识（用于结果收集索引）
 *   task_type        - 子任务类型（research / coding / review 等）
 *   task_input       - 子任务输入数据（含 prompt / context 等）
 *   messages         - 子 Agent 独立消息历史（不污染主 state）
 *   task_output      - 子任务输出结果（由子图填充，consensus_node 读取）
 *   trace_id         - 继承自主图的链路追踪标识
 *   parent_session_id - 父会话标识（用于关联主图 checkpoint）
 *   error            - 子任务执行错误信息（null=无错误）
 */
export const SubAgentStateAnnotation = Annotation.Root({
  task_id: Annotation<string>(_lw(() => '')),
  task_type: Annotation<string>(_lw(() => '')),
  task_input: Annotation<Record<string, any>>(_lw(() => ({}))),
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => messagesStateReducer(prev, next as any),
    default: () => [],
  }),
  task_output: Annotation<Record<string, any> | null>(_lw<Record<string, any> | null>(() => null)),
  trace_id: Annotation<string>(_lw(() => '')),
  parent_session_id: Annotation<string>(_lw(() => '')),
  error: Annotation<string | null>(_lw<string | null>(() => null)),
})

/** 子 Agent 状态类型。 */
export type SubAgentState = typeof SubAgentStateAnnotation.State

/**
 * 构建子 Agent 初始状态。
 *
 * 对应 Python make_subagent_initial_state。
 *
 * @param taskId 子任务标识
 * @param taskType 子任务类型
 * @param taskInput 子任务输入
 * @param traceId 链路追踪 ID
 * @param parentSessionId 父会话 ID
 * @returns 初始化的 SubAgentState
 */
export function makeSubagentInitialState(
  taskId: string,
  taskType: string,
  taskInput: Record<string, any>,
  traceId: string = '',
  parentSessionId: string = '',
): SubAgentState {
  return {
    task_id: taskId,
    task_type: taskType,
    task_input: taskInput,
    messages: [],
    task_output: null,
    trace_id: traceId,
    parent_session_id: parentSessionId,
    error: null,
  }
}
