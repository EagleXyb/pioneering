// 对应 Python: modu_graph/adapters/__init__.py
// langgraph.adapters 子包：组件适配器层。
//
// 将现有 ModuAgent 组件（BaseTool / BaseReasoningEngine / BaseMemory）
// 包装为 LangChain / LangGraph 原生类型，保留原接口以支持双轨运行。
//
// 统一 LLM 接口改造（对应文档 §2.1）：
//   新增 modu-llm-adapter 导出，将 LangChain ChatOpenAI 包装为 ModuLLM 接口，
//   消除与 BaseLLMReasoner 的双轨抽象。
export { LangGraphEventBridge } from './event-bridge.js'
export {
  build_chat_model,
  build_conservative_chat_model,
  registerBuiltinLLMProviders,
  listBuiltinLLMProviders,
} from './llm-adapter.js'
// P1（T-12）: provider 规格表 + 内置工厂装配（纯数据 + 回调注入，无 @langchain 依赖）
export {
  BUILTIN_LLM_PROVIDER_SPECS,
  createBuiltinLLMProviderFactories,
  ensureBuiltinLLMProviders,
  type ChatModelBuilder,
} from './llm-provider-registry.js'
export { MCPToolAdapter } from './mcp-tool-adapter.js'
export { ModuLLMAdapter, wrap_chat_model_as_modu, unwrap_modu_llm } from './modu-llm-adapter.js'
export { ToolRateLimiter, get_tool_rate_limiter, _reset_tool_rate_limiter_for_test } from './rate-limiter.js'
export { with_tool_retry, apply_llm_retry } from './retry.js'
// P0（T-02）: LLM token 用量埋点（通用适配层）
export { apply_llm_metrics, extractTokenUsage } from './llm-metrics.js'
export { ChromaStore, InMemoryStoreAdapter } from './store-adapter.js'
export { wrap_modu_tool, build_langchain_tools } from './tool-adapter.js'
// P2-3: 动态工具编排
export {
  hasDependency,
  planExecution,
  parseToolCalls,
  shouldOrchestrate,
  formatExecutionPlan,
  type ToolCallItem,
  type ExecutionGroup,
  type ExecutionPlan,
} from './tool-orchestrator.js'
