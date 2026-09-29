// 对应 Python: modu_graph/__init__.py
// modu_graph 模块统一导出
//
// 层次结构：
//   state.ts       —— 状态定义（ModuAgentState + Annotation）
//   nodes.ts       —— LangGraph 节点函数与路由函数
//   graph.ts       —— StateGraph 构建（buildModuGraph + ModuGraph wrapper）
//   factory.ts     —— 配置化组件工厂（create_agent）
//   runner.ts      —— 运行入口（stream_response / run_sync / HITL resume）
//   adapters/      —— 组件适配器层
//   subgraph/      —— 多 Agent 协作子图

// state
export {
  type ModuAgentState,
  type CoreState,
  type HITLModeState,
  type MultiAgentModeState,
  type PlanExecuteModeState,
  type FeedbackModeState,
  ModuAgentStateAnnotation,
  makeInitialState,
  mergeSubtaskResults,
  STATE_SCHEMA_VERSION,
  migrate_state,
} from './state.js'

// nodes
export {
  perceptionNode,
  perceptionNodeSync,
  memoryQueryNode,
  makeMemoryQueryNode,
  memoryUpdateNode,
  makeMemoryUpdateNode,
  routeAfterPerception,
  routeAfterAgent,
  makeAgentNode,
  makeToolResultProcessor,
  responseNode,
  makeFeedbackNode,
  publishPerceptionEvent,
  publishMemoryEvent,
  publishActionEvent,
  publishToolEvents,
  makeHumanReviewNode,
  routeAfterHumanReview,
  routeAfterMemoryQuery,
  makeSubagentNode,
  makeConsensusNode,
  // 需求澄清（HITL clarifying）
  makeClarifyNode,
  assessClarificationNeed,
  type ClarifyDecision,
} from './nodes.js'

// graph
export {
  ModuGraph,
  buildModuGraph,
  composeDefaultGraph,
  resolveGraphProfile,
  createFewShotSelector,
  type ModuGraphInterface,
} from './graph.js'

// P2（T-13）: 图拓扑声明化（GraphSpec）
// P3（T-20）: 扩展开关读取（profileFlag）与扩展子图声明（SubgraphSpec）
export {
  buildFromSpec,
  computeRecursionLimit,
  describeGraphSpec,
  estimatePlanTotalIterations,
  profileFlag,
  type EdgeSpec,
  type EdgeTargets,
  type GraphProfile,
  type GraphSpec,
  type GraphSpecSnapshot,
  type ModuGraphDeps,
  type NodePredicate,
  type NodeSpec,
  type SubgraphSpec,
} from './spec.js'

// factory
export {
  create_agent,
  build_checkpointer,
  build_store,
  _build_judge_llm,
  _build_modu_llm,
  _build_llm_router,
  _discover_and_register_mcp_tools,
} from './factory.js'

// runner
export {
  stream_response,
  run_sync,
  get_runner,
  reset_runner_cache,
  process_request_compat,
  stream_request_compat,
  resume_sync,
  resume_stream,
  get_interrupt_state,
  checkInterruptTimeout,
  sweepExpiredInterrupts,
} from './runner.js'

// adapters（子包统一导出）
export * from './adapters/index.js'

// subgraph（子包统一导出）
export * from './subgraph/index.js'

// plan-execute（P4 子包统一导出）
export * from './plan-execute/index.js'

// P2（T-14）: 内置 Prompt 模板（可注册扩展点）
export {
  PLANNER_PROMPT_TEMPLATE,
  PLANNER_COMPACT_PROMPT_TEMPLATE,
  SUBAGENT_PROMPT_TEMPLATES,
  SUBAGENT_DEFAULT_TEMPLATE_ID,
  DOC_GEN_TASK_PROMPT_TEMPLATE,
  BUILTIN_PROMPT_TEMPLATES,
  registerBuiltinPrompts,
  listBuiltinPromptIds,
} from './prompt-templates.js'

// P2（T-15）: 内置上下文策略（可注册扩展点）
export {
  DEFAULT_AGENT_CONTEXT_FRAGMENTS,
  DefaultAgentContextStrategy,
  getDefaultAgentContextStrategy,
  resetDefaultAgentContextStrategy,
  registerBuiltinContextStrategies,
} from './context-strategies.js'
