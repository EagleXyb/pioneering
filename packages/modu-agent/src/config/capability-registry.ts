// capability-registry.ts
//
// 配置能力注册表（纯数据 + 纯函数，零副作用）。
//
// 背景：`runtimeConfig.get()` 消费点分散在 17+ 个文件、100+ 处调用，且存在
// "声明面与消费面脱节"（如 plan_execute.planner_max_tokens 被消费但
// DEFAULT_CONFIG 未声明）。缺少一份权威的"配置键 → 能力 → 消费模块"清单，
// 导致改配置时无法预知影响面、无法审计哪些键真正被消费。
//
// 本模块提供集中注册表，用于：
//   1. 列出全部配置键（配置块）、能力名称、消费模块、是否在 DEFAULT_CONFIG 声明；
//   2. 供调试/文档工具生成"消费清单"，识别"已声明未消费"或"已消费未声明"的键；
//   3. 作为未来"能力裁剪/插件化"的基础（统一遍历接线）。
//
// 设计约束：
//   - 纯数据 + 纯函数，不修改 RuntimeConfig、不接入 factory 接线逻辑。
//   - 与现有分散的 `config.get()` 调用并存，不做替换（避免改动业务逻辑）。

/** 单个配置能力的注册信息。 */
export interface CapabilityDescriptor {
  /** 能力标识（如 markdown_prompt / plan_execute / adaptive_termination） */
  id: string
  /** 能力名称（人类可读） */
  name: string
  /** 所属配置块（点分前缀，如 react_optimization.markdown_prompt） */
  configPrefix: string
  /** 控制该能力的 feature flag 配置键（如 react_optimization.markdown_prompt.enabled） */
  enabledKey?: string
  /** 该能力的核心配置键（不含 enabled，可为空数组） */
  configKeys: string[]
  /** 消费该能力的实现模块（文件/职责） */
  implementation: string[]
  /** 默认是否启用（DEFAULT_CONFIG 中的 enabled 默认值） */
  defaultEnabled: boolean
  /** 状态：implemented=已实现，planned=规划未落地 */
  status: 'implemented' | 'planned'
}

/**
 * 配置能力注册表（与 DEFAULT_CONFIG + 源码消费点核对，2026-08-21）。
 *
 * 说明：
 *   - "planned" 项为原方案文档规划但当前代码未落地为独立模块的能力，
 *     仅作登记，避免与已实现项混淆。
 */
export const CAPABILITY_REGISTRY: readonly CapabilityDescriptor[] = [
  // ---- 已实现（implemented）----
  {
    id: 'markdown_prompt',
    name: 'Markdown 文档提示注入',
    configPrefix: 'react_optimization.markdown_prompt',
    enabledKey: 'react_optimization.markdown_prompt.enabled',
    configKeys: [
      'react_optimization.markdown_prompt.system_prompt_max_chars',
      'react_optimization.markdown_prompt.runtime_context_max_chars',
    ],
    implementation: ['config/markdown-loader.ts', 'config/markdown-prompt-aggregator.ts', 'graph/factory.ts'],
    defaultEnabled: false,
    status: 'implemented',
  },
  {
    id: 'prompt_composer',
    name: '四层 Prompt 解耦组装',
    configPrefix: 'react_optimization.prompt_composer',
    enabledKey: 'react_optimization.prompt_composer.enabled',
    configKeys: [],
    implementation: ['reasoning/prompt-composer.ts', 'graph/factory.ts'],
    defaultEnabled: false,
    status: 'implemented',
  },
  {
    id: 'complexity_assessment',
    name: 'Thought 分层推理（复杂度评估）',
    configPrefix: 'react_optimization.complexity_assessment',
    enabledKey: 'react_optimization.complexity_assessment.enabled',
    configKeys: [],
    implementation: ['reasoning/complexity-assessor.ts', 'graph/nodes.ts'],
    defaultEnabled: false,
    status: 'implemented',
  },
  {
    id: 'cot_anchor',
    name: 'CoT 锚点 + 反思后缀',
    configPrefix: 'react_optimization.cot_anchor',
    enabledKey: 'react_optimization.cot_anchor.enabled',
    configKeys: [],
    implementation: ['reasoning/cot-anchors.ts', 'graph/nodes.ts'],
    defaultEnabled: false,
    status: 'implemented',
  },
  {
    id: 'observation_distillation',
    name: 'Observation 多层蒸馏',
    configPrefix: 'react_optimization.observation_distillation',
    enabledKey: 'react_optimization.observation_distillation.enabled',
    configKeys: ['react_optimization.observation_distillation.max_tokens'],
    implementation: ['graph/adapters/observation-distiller.ts', 'graph/nodes.ts'],
    defaultEnabled: true,
    status: 'implemented',
  },
  {
    id: 'adaptive_termination',
    name: '自适应终止判定',
    configPrefix: 'react_optimization.adaptive_termination',
    enabledKey: 'react_optimization.adaptive_termination.enabled',
    configKeys: [
      'react_optimization.adaptive_termination.scene_profile',
      'react_optimization.adaptive_termination.use_tier_mapping',
    ],
    implementation: ['graph/termination-engine.ts', 'graph/nodes.ts'],
    defaultEnabled: false,
    status: 'implemented',
  },
  {
    id: 'tool_capability_matrix',
    name: '工具能力矩阵 + 意图路由',
    configPrefix: 'react_optimization.tool_capability_matrix',
    enabledKey: 'react_optimization.tool_capability_matrix.enabled',
    configKeys: [],
    implementation: ['graph/adapters/tool-adapter.ts', 'graph/nodes.ts'],
    defaultEnabled: false,
    status: 'implemented',
  },
  {
    id: 'action_guardrails',
    name: '写操作安全护栏',
    configPrefix: 'react_optimization.action_guardrails',
    enabledKey: 'react_optimization.action_guardrails.enabled',
    configKeys: ['react_optimization.action_guardrails.dry_run_enabled'],
    implementation: ['tools/tool-guardrails.ts', 'graph/nodes.ts'],
    defaultEnabled: false,
    status: 'implemented',
  },
  {
    id: 'few_shot',
    name: 'Few-shot 动态示例选择',
    configPrefix: 'react_optimization.few_shot',
    enabledKey: 'react_optimization.few_shot.enabled',
    configKeys: [
      'react_optimization.few_shot.max_examples',
      'react_optimization.few_shot.max_tokens_budget',
      'react_optimization.few_shot.min_quality_score',
      'react_optimization.few_shot.mmr_lambda',
    ],
    implementation: ['skills/few-shot-selector.ts', 'graph/nodes.ts'],
    defaultEnabled: false,
    status: 'implemented',
  },
  {
    id: 'parallel_tools',
    name: '动态工具编排（并行）',
    configPrefix: 'react_optimization.parallel_tools',
    enabledKey: 'react_optimization.parallel_tools.enabled',
    configKeys: ['react_optimization.parallel_tools.conservative_mode'],
    implementation: ['graph/nodes.ts'],
    defaultEnabled: false,
    status: 'implemented',
  },
  {
    id: 'plan_execute',
    name: 'Plan-and-Execute 模式',
    configPrefix: 'plan_execute',
    enabledKey: 'plan_execute.enabled',
    configKeys: [
      'plan_execute.max_steps',
      'plan_execute.max_replans',
      'plan_execute.planner_temperature',
      'plan_execute.continue_on_failure',
      'plan_execute.compact_completed_steps',
      'plan_execute.step_summary_max_chars',
      // 以下为"已消费但 DEFAULT_CONFIG 未声明"的键（见 registerUndeclaredKeys）
      'plan_execute.planner_max_tokens',
      'plan_execute.step_retry.default_max_attempts',
      'plan_execute.step_retry.default_base_delay',
    ],
    implementation: ['graph/plan-execute/planner.ts', 'graph/plan-execute/dispatcher.ts'],
    defaultEnabled: false,
    status: 'implemented',
  },
  {
    id: 'multi_agent',
    name: '多 Agent 编排',
    configPrefix: 'orchestration.multi_agent',
    enabledKey: 'orchestration.multi_agent.enabled',
    configKeys: ['orchestration.multi_agent.max_subagents', 'orchestration.multi_agent.consensus_strategy'],
    implementation: ['graph/subgraph/supervisor.ts', 'graph/subgraph/builder.ts'],
    defaultEnabled: false,
    status: 'implemented',
  },
  {
    id: 'llm_as_judge',
    name: 'LLM-as-Judge（质量监控 + 注入校验）',
    configPrefix: 'feedback',
    enabledKey: undefined,
    configKeys: ['feedback.quality_monitor_mode', 'feedback.quality_monitor_llm_provider'],
    implementation: ['feedback/quality-monitor.ts', 'perception/security/guard.ts', 'graph/factory.ts'],
    defaultEnabled: false,
    status: 'implemented',
  },
  {
    id: 'mcp',
    name: 'MCP 工具集成',
    configPrefix: 'mcp',
    enabledKey: 'mcp.enabled',
    configKeys: ['mcp.default_timeout', 'mcp.servers'],
    implementation: ['mcp/client.ts', 'mcp/discovery.ts', 'graph/factory.ts'],
    defaultEnabled: false,
    status: 'implemented',
  },
  // ---- 规划未落地（planned）----
  {
    id: 'sandbox',
    name: '工具执行沙箱（独立配置模块）',
    configPrefix: 'tools',
    configKeys: [],
    implementation: ['tools/code-executor.ts（功能已存在，白名单+子进程隔离）'],
    defaultEnabled: false,
    status: 'planned',
  },
  {
    id: 'rag',
    name: 'RAG 检索增强生成（独立模块）',
    configPrefix: '',
    configKeys: [],
    implementation: ['memory/chroma.ts（底层向量记忆，非标准 RAG）'],
    defaultEnabled: false,
    status: 'planned',
  },
  {
    id: 'behavior',
    name: '行为配置（独立模块）',
    configPrefix: '',
    configKeys: [],
    implementation: [],
    defaultEnabled: false,
    status: 'planned',
  },
  {
    id: 'factory_config',
    name: '工厂配置（独立模块）',
    configPrefix: '',
    configKeys: [],
    implementation: [],
    defaultEnabled: false,
    status: 'planned',
  },
  {
    id: 'testing_config',
    name: '测试配置（独立模块）',
    configPrefix: '',
    configKeys: [],
    implementation: [],
    defaultEnabled: false,
    status: 'planned',
  },
]

/**
 * 已知"被消费但 DEFAULT_CONFIG 未声明"的配置键清单。
 *
 * 来源（2026-08-21 源码核对）：
 *   - graph/plan-execute/planner.ts:435 → plan_execute.planner_max_tokens
 *   - graph/plan-execute/dispatcher.ts:622,626 → plan_execute.step_retry.default_max_attempts / default_base_delay
 *
 * 这些键靠 `config.get(key, fallback)` 的 fallback 掩盖了"未声明"，且
 * loadConfigYamlValidated 只校验"已存在键"，故这些键不受类型安全保护。
 */
export const UNDECLARED_CONSUMED_KEYS: readonly string[] = [
  'plan_execute.planner_max_tokens',
  'plan_execute.step_retry.default_max_attempts',
  'plan_execute.step_retry.default_base_delay',
]

/**
 * 按状态/前缀过滤能力清单。
 */
export function listCapabilities(opts: { status?: 'implemented' | 'planned' } = {}): CapabilityDescriptor[] {
  const out = CAPABILITY_REGISTRY.filter((c) => (opts.status ? c.status === opts.status : true))
  return [...out]
}

/**
 * 返回"已实现能力"的 feature flag 开关清单（enabledKey 非空）。
 * 供未来统一接线遍历（替代 factory 中散落的 if 判断）。
 */
export function listEnabledKeys(): Array<{ id: string; enabledKey: string; defaultEnabled: boolean }> {
  const out: Array<{ id: string; enabledKey: string; defaultEnabled: boolean }> = []
  for (const c of CAPABILITY_REGISTRY) {
    if (c.status === 'implemented' && c.enabledKey) {
      out.push({ id: c.id, enabledKey: c.enabledKey, defaultEnabled: c.defaultEnabled })
    }
  }
  return out
}

/**
 * 给定一个 RuntimeConfig（或其 asDict 结果），返回每个已实现能力的当前启用状态。
 * 用于调试"哪些能力当前实际开启"。
 */
export function capabilityStatus(runtimeConfig: { get: (k: string, d?: any) => any }): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const c of CAPABILITY_REGISTRY) {
    if (c.status === 'implemented' && c.enabledKey) {
      out[c.id] = Boolean(runtimeConfig.get(c.enabledKey, c.defaultEnabled))
    }
  }
  return out
}
