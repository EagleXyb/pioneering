// 对应 Python: core/__init__.py
// core 模块统一导出
export { BaseActionExecutor, BaseTool } from './interfaces/action.js'
export { BaseFeedbackLoop, BaseEvolutionSignal } from './interfaces/feedback.js'
export { BaseMemory, BaseStorageAdapter } from './interfaces/memory.js'
export { BasePerception, BaseSensor } from './interfaces/perception.js'
export { BaseReasoningEngine, BaseReasoningStrategy } from './interfaces/reasoning.js'
export { BaseSkill } from './interfaces/skill.js'
// 统一 LLM 接口（对应文档 §2.1）：ModuLLM / LLMMessage / LLMResult / LLMRouter 等
export type {
  LLMMessageRole,
  LLMToolCall,
  LLMMessage,
  LLMUsage,
  LLMResult,
  LLMInvokeOptions,
  LLMRetryOptions,
  ModuLLM,
  LLMRouteContext,
  LLMRouter,
} from './interfaces/llm.js'
// P1（T-12）: LLM provider 注册表契约
export type {
  LLMProviderConfig,
  LLMProviderSpec,
  LLMProviderFactory,
} from './interfaces/llm-provider.js'
// P1（T-11）: 记忆策略统一契约
export type {
  MemoryItem,
  MemoryStrategy,
  MemoryRecallContext,
  MemoryPersistContext,
} from './interfaces/memory-strategy.js'
// P1（T-10）: 统一策略引擎契约 + 默认/空实现
export type {
  PolicyStage,
  PolicySubject,
  PolicyContext,
  PolicyEffect,
  PolicyDecision,
  PolicyRule,
  PolicyEngine,
  ToolApprovalDetail,
} from './interfaces/policy.js'
export { DefaultPolicyEngine, NoopPolicyEngine } from './policy-engine.js'
// P2（T-14）: Prompt 注册表契约
export type {
  PromptRole,
  PromptMessage,
  PromptTemplate,
  PromptRegistry,
} from './interfaces/prompt.js'
// P2（T-15）: 上下文策略契约
export type {
  ContextPlacement,
  ContextFragmentOutput,
  ContextRuntime,
  ContextFragment,
  ContextStrategy,
  ContextRegistry,
} from './interfaces/context.js'
export {
  ComponentRegistry,
  getRegistry,
  resetRegistry,
  overrideRegistry,
  setSkillToolWrapperFactory,
} from './registry.js'
