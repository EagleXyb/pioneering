// 对应 Python: components/reasoning/__init__.py
// 推理层组件包（P2-3: 补充模块导出）
//
// 统一 LLM 接口改造（对应文档 §2.1）：
//   透传 llm 子包的 router / cost-tracker 导出，便于顶层统一消费。
export { BaseLLMReasoner } from './llm/base-llm.js'
export { DeepSeekLLMReasoner } from './llm/deepseek.js'
export { GLMLLMReasoner } from './llm/glm.js'
export { GPTLLMReasoner } from './llm/gpt.js'
export { QwenLLMReasoner } from './llm/qwen.js'
export {
  RuleBasedLLMRouter,
  PassthroughLLMRouter,
  type RouteRule,
  type RouteRuleCondition,
  type RouteTable,
} from './llm/router.js'
export {
  is_cost_tracking_enabled,
  publish_llm_cost_event,
  type CostEventContext,
} from './llm/cost-tracker.js'

// P1-4: 四层 Prompt 解耦架构
export { PromptComposer, type PromptComposerInput } from './prompt-composer.js'
export {
  DOMAIN_ADAPTERS,
  registerDomainAdapter,
  getDomainAdapter,
  renderDomainAdapter,
  type DomainAdapter,
} from './domain-adapters.js'
