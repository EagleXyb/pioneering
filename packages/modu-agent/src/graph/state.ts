// 对应 Python: modu_graph/state.py
// ModuAgent LangGraph 类型化状态定义
import type { BaseMessage } from '@langchain/core/messages'
import { messagesStateReducer } from '@langchain/langgraph'

// P0-1: 复杂度评估结果类型（仅类型导入，不引入运行时依赖）
import type { ComplexityAssessment } from '../reasoning/complexity-assessor.js'

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
 *   原 context["history"]         → 已移除（僵尸字段，无节点读取；长期记忆由 store/Chroma 承载）
 *   原 context["perception"]      → State.perception_result / cleaned_text
 *   原 context["native_tools"]    → 由 LangGraph bind_tools 接管
 *   原 context["tool_results"]    → State.tool_results
 *
 * 状态字段分层（对应文档 §2.3 建议1）：
 *   - CoreState：基础字段（messages/tool_results/error_code 等所有模式共用）
 *   - HITLModeState：Human-in-the-loop 专属字段
 *   - MultiAgentModeState：多 Agent 协作专属字段
 *   - PlanExecuteModeState：Plan-and-Execute 专属字段
 *   - FeedbackModeState：反馈/进化专属字段
 *   ModuAgentState 为上述类型的组合别名，保持向后兼容
 *
 * 状态 schema 版本号（对应文档 §2.3 建议3）：
 *   新增 state_schema_version 字段，Checkpointer 读取时按版本迁移
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
  /** v1.4 §4.4 建议3：子 Agent 间共享黑板 */
  blackboard?: Record<string, any>

  // === P4 Plan-and-Execute ===
  plan?: Array<Record<string, any>>
  current_step_index?: number
  step_results?: Array<Record<string, any>>
  replan_count?: number
  plan_phase?: string
  // transient: 当前步骤上下文（step_dispatch 注入，agent 节点读取）
  current_step?: Record<string, any>
  // transient: 本步开始时的 messages 基线长度（step_finalize 截取增量用）
  step_msg_baseline?: number
  // transient: PlanStateDelta，供 EventBridge 发 SSE
  plan_delta?: Record<string, any> | null

  // === P0 优化（ReAct 模式业务定制化） ===
  // P0-1: 复杂度评估结果（perception 节点写入，agentNode/routeAfterAgent 读取）
  complexity_assessment?: ComplexityAssessment | null
  // P0-1: 当前已用 Thought 轮数（routeAfterAgent 递增，reducer 聚合）
  reasoning_round_count?: number
  // P0-3: Observation 蒸馏历史（distiller 写入，agentNode 读取上下文）
  observation_history?: Array<Record<string, any>>
  // P0-4: 置信度历史（advisory 模式采集，不影响路由）
  confidence_history?: number[]
  // P0-4: 信息增益历史（advisory 模式采集，不影响路由）
  information_gain_history?: number[]
  // P0-4: 终止决策建议（advisory 模式写入，第一阶段不改变路由）
  termination_advice?: Record<string, any> | null
  // P1-2: Observation 三级记忆（ObservationMemory.serialize() 整体替换）
  // toolResultProcessor 写入，agentNode 读取注入 SystemMessage
  observation_memory?: Record<string, any> | null

  // === Artifact 产物追踪 ===
  // 记录本次会话中生成/修改的文件产物，供前端展示附件卡片和"查看所有产物"
  artifacts?: Array<Record<string, any>>

  // === 任务类型识别（perception 节点写入，routeAfterAgent 读取用于强制约束）===
  // 'document_generation'：用户要求生成文档/报告/文件，必须调用 doc_writer
  task_type?: string | null
  // doc_writer 强制回退计数（防止无限循环，最多 2 次）
  doc_writer_enforcement_count?: number
  // doc_writer 调用成功标记（成功后设为 true，阻止后续重复调用和强制回退）
  doc_writer_succeeded?: boolean
  // doc_writer 连续失败次数（达到上限后强制终止，避免无限重试）
  doc_writer_fail_count?: number
}

/**
 * LangGraph 状态注解（用于 StateGraph 构造）。
 *
 * 对应 Python:
 *   class ModuAgentState(TypedDict, total=False):
 *       messages: Annotated[List[BaseMessage>, add_messages]
 *       subtask_results: Annotated[Dict, merge_subtask_results]
 *
 * JS 版使用 Annotation.Root 构建等效语义。
 */
import { Annotation } from '@langchain/langgraph'

// 状态 schema 版本号（对应文档 §2.3 建议3）
// 必须在 ModuAgentStateAnnotation 之前声明，避免 Annotation.Root 初始化时 TDZ
/** 当前状态 schema 版本号，字段重构时递增并补充 migrate_state 迁移逻辑 */
export const STATE_SCHEMA_VERSION = 1 as const

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
  /**
   * v1.4 §4.4 建议3：子 Agent 间共享黑板。
   *
   * 子 Agent 可将中间结果写入黑板，其他子 Agent 可读取。
   * 使用合并 reducer：每个子 Agent 写入自己的 key（如 task_id），
   * 多个并行子 Agent 写入会合并而非覆盖。
   *
   * 典型用法：
   *   - research 子 Agent 写入 {search_results: [...]}
   *   - coding 子 Agent 读取黑板获取 search_results 作为上下文
   */
  blackboard: Annotation<Record<string, any>>({
    reducer: (prev, next) => ({ ...(prev ?? {}), ...(next ?? {}) }),
    default: () => ({}),
  }),

  // === P4 Plan-and-Execute ===
  plan: Annotation<Array<Record<string, any>>>(_lw<Array<Record<string, any>>>(() => [])),
  current_step_index: Annotation<number>(_lw(() => 0)),
  step_results: Annotation<Array<Record<string, any>>>({
    // P1-6 修复：next 为空数组时覆盖（清空语义），非空时追加
    // dispatcher 正常返回 [stepResult]（非空）→ 追加
    // planner 重规划返回 []（空）→ 清空旧步骤结果
    reducer: (prev, next) => {
      if (!next || next.length === 0) {
        return []
      }
      return [...(prev ?? []), ...next]
    },
    default: () => [],
  }),
  replan_count: Annotation<number>(_lw(() => 0)),
  plan_phase: Annotation<string>(_lw(() => '')),
  current_step: Annotation<Record<string, any>>(_lw(() => ({}))),
  step_msg_baseline: Annotation<number>(_lw(() => 0)),
  plan_delta: Annotation<Record<string, any> | null>(_lw<Record<string, any> | null>(() => null)),

  // 状态 schema 版本号（对应文档 §2.3 建议3）
  // Checkpointer 持久化时一并保存；读取时由 migrate_state 按版本迁移
  state_schema_version: Annotation<number>(_lw<number>(() => STATE_SCHEMA_VERSION)),

  // === P0 优化（ReAct 模式业务定制化） ===
  // P0-1: 复杂度评估结果（last-write-wins，perception 节点写入）
  complexity_assessment: Annotation<ComplexityAssessment | null>(_lw<ComplexityAssessment | null>(() => null)),
  // P0-1: Thought 轮数计数器（累加 reducer，routeAfterAgent 递增）
  reasoning_round_count: Annotation<number>({
    reducer: (prev, next) => (prev ?? 0) + (next ?? 0),
    default: () => 0,
  }),
  // P0-3: Observation 蒸馏历史（追加 reducer）
  observation_history: Annotation<Array<Record<string, any>>>({
    reducer: (prev, next) => [...(prev ?? []), ...(next ?? [])],
    default: () => [],
  }),
  // P0-4: 置信度历史（追加 reducer，advisory 采集）
  confidence_history: Annotation<number[]>({
    reducer: (prev, next) => [...(prev ?? []), ...(next ?? [])],
    default: () => [],
  }),
  // P0-4: 信息增益历史（追加 reducer，advisory 采集）
  information_gain_history: Annotation<number[]>({
    reducer: (prev, next) => [...(prev ?? []), ...(next ?? [])],
    default: () => [],
  }),
  // P0-4: 终止决策建议（last-write-wins，advisory 模式写入）
  termination_advice: Annotation<Record<string, any> | null>(_lw<Record<string, any> | null>(() => null)),
  // P1-2: Observation 三级记忆（last-write-wins，ObservationMemory.serialize() 整体替换）
  // 对应风险 R-06 规避策略②：reducer 整体替换避免并发覆盖
  observation_memory: Annotation<Record<string, any> | null>(_lw<Record<string, any> | null>(() => null)),

  // === Artifact 产物追踪（append reducer，toolResultProcessor 写入）===
  artifacts: Annotation<Array<Record<string, any>>>({
    reducer: (prev, next) => [...(prev ?? []), ...(next ?? [])],
    default: () => [],
  }),

  // === 任务类型识别（last-write-wins，perception 节点写入）===
  task_type: Annotation<string | null>(_lw<string | null>(() => null)),
  // doc_writer 强制回退计数（累加 reducer，docGenEnforceNode 递增）
  doc_writer_enforcement_count: Annotation<number>({
    reducer: (prev, next) => (prev ?? 0) + (next ?? 0),
    default: () => 0,
  }),
  // doc_writer 成功标记（last-write-wins，toolResultProcessor 在成功时写入 true，一旦成功永不重置）
  doc_writer_succeeded: Annotation<boolean>({
    reducer: (prev, next) => (prev ?? false) || (next ?? false),
    default: () => false,
  }),
  // doc_writer 失败次数（累加 reducer，toolResultProcessor 在失败时递增）
  doc_writer_fail_count: Annotation<number>({
    reducer: (prev, next) => (prev ?? 0) + (next ?? 0),
    default: () => 0,
  }),
})

// ============================================================
// 状态 schema 版本号（对应文档 §2.3 建议3）—— migrate_state 实现
// ============================================================
// 常量 STATE_SCHEMA_VERSION 已在 ModuAgentStateAnnotation 之前声明（避免 TDZ）

/**
 * 按版本号迁移历史 checkpoint 状态。
 *
 * 使用方式（在 Checkpointer 读取状态后调用）：
 * ```ts
 * const tuple = await checkpointer.getTuple(config)
 * if (tuple?.values) {
 *   const migrated = migrate_state(tuple.values as any)
 *   // 使用 migrated 而非原始 tuple.values
 * }
 * ```
 *
 * 迁移规则按版本递增补充：
 *   - v0 → v1：移除僵尸 history 字段；补齐 state_schema_version
 *
 * 未注册的版本号（高于当前 STATE_SCHEMA_VERSION）原样返回并记录警告。
 */
export function migrate_state<T extends Record<string, any>>(state: T): T & { state_schema_version: number } {
  const current = (state as any).state_schema_version
  if (typeof current === 'number' && current >= STATE_SCHEMA_VERSION) {
    return state as T & { state_schema_version: number }
  }

  const migrated: Record<string, any> = { ...state }

  // v0 → v1 迁移：移除僵尸 history 字段（对应文档 §2.3 建议2）
  if ('history' in migrated) {
    delete migrated['history']
  }
  // v0 → v1 迁移：补齐 schema 版本号
  if (typeof migrated['state_schema_version'] !== 'number') {
    migrated['state_schema_version'] = STATE_SCHEMA_VERSION
  }

  return migrated as T & { state_schema_version: number }
}

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
    blackboard: {},
    plan: [],
    current_step_index: 0,
    step_results: [],
    replan_count: 0,
    plan_phase: '',
    current_step: {},
    step_msg_baseline: 0,
    plan_delta: null,
    state_schema_version: STATE_SCHEMA_VERSION,
    // P0 优化字段初始化
    complexity_assessment: null,
    reasoning_round_count: 0,
    observation_history: [],
    confidence_history: [],
    information_gain_history: [],
    termination_advice: null,
    observation_memory: null,
    artifacts: [],
    task_type: null,
    doc_writer_enforcement_count: 0,
    doc_writer_succeeded: false,
    doc_writer_fail_count: 0,
  }
}

// ============================================================
// 状态字段分层（对应文档 §2.3 建议1）
// ============================================================
//
// 将 ModuAgentState 30+ 字段按模式拆分为 CoreState + 各 ModeState 组合，
// 新增模式通过新增 ModeState 隔离，避免 CoreState 持续膨胀。
// ModuAgentState 保留为组合别名，向后兼容现有 ~80 个使用点。

/** 核心状态：所有模式共用的基础字段。 */
export interface CoreState {
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
  // 记忆更新状态
  memory_update_status?: string
  memory_update_key?: string
  memory_update_error?: string
  // per-session 配置覆盖
  config_overrides?: Record<string, any>
  // 状态 schema 版本号
  state_schema_version?: number
  // === P0 优化字段（ReAct 模式业务定制化） ===
  // P0-1: 复杂度评估结果
  complexity_assessment?: ComplexityAssessment | null
  // P0-1: Thought 轮数计数器
  reasoning_round_count?: number
  // P0-3: Observation 蒸馏历史
  observation_history?: Array<Record<string, any>>
  // P0-4: 置信度历史（advisory）
  confidence_history?: number[]
  // P0-4: 信息增益历史（advisory）
  information_gain_history?: number[]
  // P0-4: 终止决策建议（advisory）
  termination_advice?: Record<string, any> | null
}

/** Human-in-the-loop 模式专属状态。 */
export interface HITLModeState {
  pending_tool_calls?: Array<Record<string, any>>
  tool_requires_approval?: boolean
  approval_status?: string
  approval_feedback?: string
}

/** 多 Agent 协作模式专属状态。 */
export interface MultiAgentModeState {
  subtasks?: Array<Record<string, any>>
  subtask_results?: Record<string, Record<string, any>>
  consensus_result?: Record<string, any> | null
  consensus_failed?: boolean
  current_subtask?: Record<string, any>
  /** v1.4 §4.4 建议3：子 Agent 间共享黑板 */
  blackboard?: Record<string, any>
}

/** Plan-and-Execute 模式专属状态。 */
export interface PlanExecuteModeState {
  plan?: Array<Record<string, any>>
  current_step_index?: number
  step_results?: Array<Record<string, any>>
  replan_count?: number
  plan_phase?: string
  current_step?: Record<string, any>
  step_msg_baseline?: number
  plan_delta?: Record<string, any> | null
}

/** 反馈/进化模式专属状态。 */
export interface FeedbackModeState {
  evaluation?: Record<string, any> | null
  should_evolve?: boolean
  evolution_action?: Record<string, any> | null
}
