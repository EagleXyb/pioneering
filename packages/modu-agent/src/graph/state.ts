// 对应 Python: modu_graph/state.py
// ModuAgent LangGraph 类型化状态定义
import type { BaseMessage } from '@langchain/core/messages'
import { messagesStateReducer } from '@langchain/langgraph'

/**
 * P3-12.3.1: 子任务结果合并 reducer。
 *
 * 用于 subtask_results 字段——多个并行 Subagent 节点通过 Send API
 * 并发写入各自的结果时，LangGraph 调用此 reducer 合并。
 *
 * 合并策略：右值优先（right wins），即后写入的结果覆盖同 task_id 的先写入值。
 */
export function mergeSubtaskResults(
  left: Record<string, Record<string, any>>,
  right: Record<string, Record<string, any>>,
): Record<string, Record<string, any>> {
  const merged: Record<string, Record<string, any>> = { ...(left || {}) }
  Object.assign(merged, right || {})
  return merged
}

/**
 * ModuAgent LangGraph 图状态。
 *
 * 对应 Python ModuAgentState (TypedDict)。
 * 使用 Annotation.Root 构建带 reducer 的状态注解。
 *
 * 关键映射：
 *   原 context["history"]         → State.history
 *   原 context["perception"]      → State.perception_result / cleaned_text
 *   原 context["native_tools"]    → 由 LangGraph bind_tools 接管
 *   原 context["tool_results"]    → State.tool_results
 */
export interface ModuAgentState {
  // 消息历史（LangGraph 内置 reducer，自动追加）
  messages?: BaseMessage[]

  // 会话标识
  user_id?: string
  session_id?: string
  trace_id?: string

  // 原始输入
  input_data?: Record<string, any>

  // 感知结果
  perception_result?: Record<string, any> | null
  cleaned_text?: string | null
  detected_language?: string | null
  sensitivity_level?: number
  confidence?: number
  injection_detected?: boolean
  pii_detected?: boolean

  // 记忆
  history?: Array<Record<string, any>>
  knowledge?: Array<Record<string, any>>

  // 工具
  tool_results?: Array<Record<string, any>>

  // 元数据
  iteration?: number

  // 最终响应
  response?: string
  error_code?: string
  error_message?: string
  usage?: Record<string, number>

  // 记忆更新状态（P0-3: memory_update_node 接入图结构）
  memory_update_status?: string
  memory_update_key?: string
  memory_update_error?: string

  // 反馈评估与进化（P0-1: feedback/evolution 闭环）
  evaluation?: Record<string, any> | null
  should_evolve?: boolean
  evolution_action?: Record<string, any> | null

  // P0-2: per-session 配置覆盖
  config_overrides?: Record<string, any>

  // === P3-12.3.2 Human-in-the-loop ===
  pending_tool_calls?: Array<Record<string, any>>
  tool_requires_approval?: boolean
  approval_status?: string
  approval_feedback?: string

  // === P3-12.3.1 多 Agent 协作 ===
  subtasks?: Array<Record<string, any>>
  subtask_results?: Record<string, Record<string, any>>
  consensus_result?: Record<string, any> | null
  consensus_failed?: boolean
  current_subtask?: Record<string, any>
}

/**
 * LangGraph 状态注解（用于 StateGraph 构造）。
 *
 * 对应 Python:
 *   class ModuAgentState(TypedDict, total=False):
 *       messages: Annotated[List[BaseMessage], add_messages]
 *       subtask_results: Annotated[Dict, merge_subtask_results]
 *
 * JS 版使用 Annotation.Root 构建等效语义。
 */
import { Annotation } from '@langchain/langgraph'

/**
 * Last-write-wins reducer 工厂（带默认值）。
 *
 * LangGraph JS 的 SingleReducer 要求提供 reducer 函数；
 * 仅提供 { default } 不够（与 Python Annotated[T, ...] 不同）。
 * 此工厂生成"后值覆盖前值"的 reducer，语义等同于 Python TypedDict 的默认覆盖行为。
 *
 * 使用 noinfer 标记防止 T 从 defaultValue 参数窄化
 * （如 () => null 推断为 T=null 而非 T=Record<string,any>|null）。
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

export const ModuAgentStateAnnotation = Annotation.Root({
  // 消息历史（LangGraph 内置 reducer，自动追加）
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => messagesStateReducer(prev, next as any),
    default: () => [],
  }),

  // 会话标识
  user_id: Annotation<string>(_lw(() => '')),
  session_id: Annotation<string>(_lw(() => '')),
  trace_id: Annotation<string>(_lw(() => '')),

  // 原始输入
  input_data: Annotation<Record<string, any>>(_lw(() => ({}))),

  // 感知结果
  perception_result: Annotation<Record<string, any> | null>(_lw<Record<string, any> | null>(() => null)),
  cleaned_text: Annotation<string | null>(_lw<string | null>(() => null)),
  detected_language: Annotation<string | null>(_lw<string | null>(() => null)),
  sensitivity_level: Annotation<number>(_lw(() => 0)),
  confidence: Annotation<number>(_lw(() => 1.0)),
  injection_detected: Annotation<boolean>(_lw(() => false)),
  pii_detected: Annotation<boolean>(_lw(() => false)),

  // 记忆
  history: Annotation<Array<Record<string, any>>>(_lw<Array<Record<string, any>>>(() => [])),
  knowledge: Annotation<Array<Record<string, any>>>(_lw<Array<Record<string, any>>>(() => [])),

  // 工具
  tool_results: Annotation<Array<Record<string, any>>>({
    reducer: (prev, next) => [...(prev ?? []), ...(next ?? [])],
    default: () => [],
  }),

  // 元数据
  iteration: Annotation<number>(_lw(() => 0)),

  // 最终响应
  response: Annotation<string>(_lw(() => '')),
  error_code: Annotation<string>(_lw(() => '')),
  error_message: Annotation<string>(_lw(() => '')),
  usage: Annotation<Record<string, number>>(_lw<Record<string, number>>(() => ({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }))),

  // 记忆更新状态
  memory_update_status: Annotation<string>(_lw(() => '')),
  memory_update_key: Annotation<string>(_lw(() => '')),
  memory_update_error: Annotation<string>(_lw(() => '')),

  // 反馈评估与进化
  evaluation: Annotation<Record<string, any> | null>(_lw<Record<string, any> | null>(() => null)),
  should_evolve: Annotation<boolean>(_lw(() => false)),
  evolution_action: Annotation<Record<string, any> | null>(_lw<Record<string, any> | null>(() => null)),

  // P0-2: per-session 配置覆盖
  config_overrides: Annotation<Record<string, any>>(_lw(() => ({}))),

  // === P3-12.3.2 Human-in-the-loop ===
  pending_tool_calls: Annotation<Array<Record<string, any>>>(_lw<Array<Record<string, any>>>(() => [])),
  tool_requires_approval: Annotation<boolean>(_lw(() => false)),
  approval_status: Annotation<string>(_lw(() => '')),
  approval_feedback: Annotation<string>(_lw(() => '')),

  // === P3-12.3.1 多 Agent 协作 ===
  subtasks: Annotation<Array<Record<string, any>>>(_lw<Array<Record<string, any>>>(() => [])),
  subtask_results: Annotation<Record<string, Record<string, any>>>({
    reducer: mergeSubtaskResults,
    default: () => ({}),
  }),
  consensus_result: Annotation<Record<string, any> | null>(_lw<Record<string, any> | null>(() => null)),
  consensus_failed: Annotation<boolean>(_lw(() => false)),
  current_subtask: Annotation<Record<string, any>>(_lw(() => ({}))),
})

/**
 * 构建图初始状态。
 * 对应 Python make_initial_state。
 */
export function makeInitialState(
  userId: string,
  sessionId: string,
  traceId: string,
  inputData: Record<string, any>,
): typeof ModuAgentStateAnnotation.State {
  return {
    messages: [],
    user_id: userId,
    session_id: sessionId,
    trace_id: traceId,
    input_data: inputData,
    perception_result: null,
    cleaned_text: null,
    detected_language: null,
    sensitivity_level: 0,
    confidence: 1.0,
    injection_detected: false,
    pii_detected: false,
    history: [],
    knowledge: [],
    tool_results: [],
    iteration: 0,
    response: '',
    error_code: '',
    error_message: '',
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    memory_update_status: '',
    memory_update_key: '',
    memory_update_error: '',
    evaluation: null,
    should_evolve: false,
    evolution_action: null,
    config_overrides: {},
    pending_tool_calls: [],
    tool_requires_approval: false,
    approval_status: '',
    approval_feedback: '',
    subtasks: [],
    subtask_results: {},
    consensus_result: null,
    consensus_failed: false,
    current_subtask: {},
  }
}
