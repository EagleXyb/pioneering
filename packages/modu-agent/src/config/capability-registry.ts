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
    // P0（T-05）新增：输出护栏接线（此前 sanitizeOutput/detectOutputSensitive 为零调用死代码）
    id: 'output_guard',
    name: '输出敏感信息护栏（脱敏）',
    configPrefix: 'perception.security.sanitize_output',
    enabledKey: 'perception.security.sanitize_output.enabled',
    configKeys: [],
    implementation: ['perception/security/output-guard-node.ts', 'graph/graph.ts'],
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
      // 以下键此前为"已消费但 DEFAULT_CONFIG 未声明"，现已补齐到 DEFAULT_CONFIG
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
  {
    // P1（T-10）：统一策略引擎（input / tool / output 三层护栏判定收口）
    id: 'policy_engine',
    name: '统一策略引擎（三层护栏判定）',
    configPrefix: 'policy.engine',
    enabledKey: 'policy.engine.enabled',
    configKeys: [],
    implementation: [
      'core/policy-engine.ts',
      'core/interfaces/policy.ts',
      'perception/security/policy-rules.ts',
      'graph/factory.ts',
      'graph/nodes.ts',
    ],
    defaultEnabled: false,
    status: 'implemented',
  },
  {
    // P2（T-13）：图拓扑声明化（GraphSpec）—— 节点/边可注册，含 T-10c HITL 拓扑声明化
    id: 'graph_spec',
    name: '图拓扑声明化（GraphSpec）',
    configPrefix: 'graph.spec',
    enabledKey: 'graph.spec.enabled',
    configKeys: [],
    implementation: [
      'graph/spec.ts',
      'graph/graph.ts',
      'core/registry.ts',
    ],
    defaultEnabled: true,
    status: 'implemented',
  },
  {
    // P2（T-14）：Prompt 注册表（内联 prompt 收敛为可注册模板）
    id: 'prompt_registry',
    name: 'Prompt 注册表（提示词可注册）',
    configPrefix: 'prompt.registry',
    enabledKey: 'prompt.registry.enabled',
    configKeys: [],
    implementation: [
      'reasoning/prompt-registry.ts',
      'graph/prompt-templates.ts',
      'core/registry.ts',
      'graph/plan-execute/prompts.ts',
      'graph/subgraph/builder.ts',
      'graph/factory.ts',
    ],
    defaultEnabled: true,
    status: 'implemented',
  },
  {
    // P2（T-15）：上下文策略（agentNode 过程式注入收敛为可注册策略）
    id: 'context_registry',
    name: '上下文策略（上下文可注册）',
    configPrefix: 'context.registry',
    enabledKey: 'context.registry.enabled',
    configKeys: [],
    implementation: [
      'reasoning/context-builder.ts',
      'graph/context-strategies.ts',
      'core/registry.ts',
      'graph/nodes.ts',
    ],
    defaultEnabled: true,
    status: 'implemented',
  },
  {
    // P3（T-23）：内置感知处理器注册（修复 §0.1 #12「感知处理器从未注册」）。
    // 默认关闭：开启会改变默认运行行为（perception_result 由 null 变非 null）。
    id: 'perception_builtin_processors',
    name: '内置感知处理器（感知器可注册 + 管线可达）',
    configPrefix: 'perception.builtin_processors',
    enabledKey: 'perception.builtin_processors.enabled',
    configKeys: ['perception.max_length'],
    implementation: [
      'perception/builtin-processors.ts',
      'perception/pipeline.ts',
      'graph/factory.ts',
    ],
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
 * 已知"被消费但 DEFAULT_CONFIG 未声明"的配置键清单（应始终保持为空）。
 *
 * 历史来源（2026-08-21 源码核对，均已在 DEFAULT_CONFIG 补齐声明）：
 *   - graph/plan-execute/planner.ts → plan_execute.planner_max_tokens
 *   - graph/plan-execute/dispatcher.ts → plan_execute.step_retry.default_max_attempts / default_base_delay
 *   - graph/factory.ts → tools.register_defaults
 *
 * 这些键此前靠 `config.get(key, fallback)` 的 fallback 掩盖了"未声明"，且
 * loadConfigYamlValidated 只校验"已存在键"，故这些键不受类型安全保护。
 * 新增消费点时应同步声明，避免重新积累脱节项。
 */
export const UNDECLARED_CONSUMED_KEYS: readonly string[] = []

/**
 * 已知「已声明（在 DEFAULT_CONFIG）但无消费点」的配置键基线
 * （P3 T-22，对应目标 G-2 / 验证层 L7）。
 *
 * 语义：**增量不得累积**。本清单是 2026-09-29 的实测基线；新增悬挂键必须走
 * 「接线或删除」（§9 D-06 口径），否则 `tests/config/config-consumption-audit.test.ts`
 * 的 `newDanglingKeys` 断言会失败。清单中已不再悬挂的键会被 `staleBaselineKeys`
 * 断言检出，必须同步移除（防止清单腐化，使 L7 门禁长期有效）。
 *
 * 基线构成（T-22 首批处置 3 项 + T-23 处置 1 项，故由实测 13 项收敛为 10 项）：
 *   - 待**单独决策**（6 项，`LLMParser` 语义解析族）：`perception.deep_parsing.*`
 *     对应 `LLMParser` 构造参数（intent / quality / local NER / local sentiment /
 *     spacy_model 及其总开关），而 `LLMParser` 依赖 `LLMAdapter` 注入，**不在
 *     T-23 范围**（T-23 只注册纯本地 `TextPreprocessor`）→ 待后续"语义解析是否
 *     默认启用"决策后再接线或删除（涉及每轮额外 LLM 调用成本，需独立评审）。
 *   - 待**单独决策**（3 项，感知事件日志 / 上下文压缩）：`perception.event_log_path`、
 *     `perception.event_log_max_size_mb`、`perception.enable_context_reduction`
 *     均为**未实现能力**的配置面（源码零读取，且无对应实现模块）。
 *   - 待**单独决策**（1 项）：`plan_execute.compact_completed_steps`
 *     为「压缩已完成步骤」的未实现开关（源码零读取；`PLANNER_COMPACT_*` 模板由
 *     **重试**触发，与本键无关）→ 需「接线压缩逻辑」或「删除该键」，不属 P3 范围。
 *     该键同时被注册表 `configKeys` 声称已消费 —— 本审计正是通过「注册表方向」
 *     交叉校验发现此点（`registryKeysUnconsumed`）。
 *   - 已处置（**不在**本清单，作为回归哨兵）：
 *       `llm.max_format_retries`、`event_bus.max_log_size` → 零消费，已删除（D-06）；
 *       `perception.default_processor` → 已接线（`perception/pipeline.ts` `_resolvePipeline`）；
 *       `perception.max_length` → 已接线（`perception/builtin-processors.ts`，T-23）。
 */
export const DECLARED_UNCONSUMED_KEYS: readonly string[] = [
  'perception.deep_parsing.enable',
  'perception.deep_parsing.enable_intent',
  'perception.deep_parsing.enable_local_ner',
  'perception.deep_parsing.enable_local_sentiment',
  'perception.deep_parsing.enable_quality',
  'perception.deep_parsing.spacy_model',
  'perception.enable_context_reduction',
  'perception.event_log_max_size_mb',
  'perception.event_log_path',
  'plan_execute.compact_completed_steps',
]

/** 配置键「声明 ↔ 消费」一致性审计结果（G-2 / L7）。 */
export interface ConfigConsumptionAudit {
  /** ① 注册表声明（`enabledKey` / `configKeys`）但 DEFAULT_CONFIG 未声明的键 → 必须为空 */
  registryKeysNotDeclared: string[]
  /**
   * ② 注册表声明但源码中无消费点的键（诊断用：识别「注册表宣称已消费、实为悬挂」）。
   *
   * 不变式：本集合必须**全部已在基线登记**（注册表不得为未登记的悬挂键背书）。
   */
  registryKeysUnconsumed: string[]
  /** ③ 实测无消费点的键全集 = DEFAULT_CONFIG 叶子键 ∪ 注册表声明键（含已登记基线） */
  unconsumedKeys: string[]
  /** ④ ③ 中已在基线（`DECLARED_UNCONSUMED_KEYS`）登记的键 */
  baselineKeys: string[]
  /** ⑤ ③ 中**未登记的新增悬挂键**（增量门禁，必须为空） */
  newDanglingKeys: string[]
  /** ⑥ 基线清单中已不再悬挂的键（清单防腐化，必须为空） */
  staleBaselineKeys: string[]
}

/**
 * 把嵌套配置对象展开为点分叶子键列表（纯函数）。
 *
 * 约定：`null` / 数组 / 原始值均视为**叶子**（数组按整体消费，与
 * `config.get('llm.router.rules')` 的读法一致）。
 */
export function flattenConfigKeys(obj: Record<string, any>, prefix = ''): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(obj ?? {})) {
    const dotted = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenConfigKeys(v as Record<string, any>, dotted))
    } else {
      out.push(dotted)
    }
  }
  return out
}

/**
 * 审计配置键的「声明 ↔ 消费」一致性（G-2 / L7 的自动化载体）。
 *
 * 消费判定（与源码读法对齐）：
 *   1. **精确命中**：`consumedKeys` 含该点分键；
 *   2. **前缀覆盖**：`consumedKeys` 含某个**含点**的祖先前缀
 *      （如 `get('orchestration.multi_agent', {})` 整体读取即载入其子树）；
 *   3. 其余判为未消费。
 *
 * ⚠️ 第 2 层刻意要求前缀**含点**：否则裸前缀（如 `'llm'` / `'tools'`）会掩盖整棵
 * 子树，使门禁形同虚设（实测：放宽后 131 个叶子键仅剩 1 个"未消费"，含 10 个
 * 真实悬挂的 `perception.*`）。
 *
 * ⚠️ 调用方扫描 `consumedKeys` 时必须**排除声明面文件自身**（`config/capability-registry.ts`
 * 的 `configKeys` 数组与基线常量）：它们是"声明"而非"消费"，否则会产生自引用
 * 假阴性（实测：不排除时 11 个悬挂键全部被自身声明"消费"掉，门禁失效）。
 *
 * @param args.defaultConfig 配置面声明（通常传 `DEFAULT_CONFIG`）
 * @param args.consumedKeys  源码中出现的配置键字面量（由调用方扫描，见测试）
 * @param args.registry      能力注册表（默认 `CAPABILITY_REGISTRY`）
 * @param args.exemptKeys    基线清单（默认 `DECLARED_UNCONSUMED_KEYS`）
 */
export function auditConfigConsumption(args: {
  defaultConfig: Record<string, any>
  consumedKeys: readonly string[]
  registry?: readonly CapabilityDescriptor[]
  exemptKeys?: readonly string[]
}): ConfigConsumptionAudit {
  const registry = args.registry ?? CAPABILITY_REGISTRY
  const exempt = args.exemptKeys ?? DECLARED_UNCONSUMED_KEYS
  const declared = flattenConfigKeys(args.defaultConfig)
  const declaredSet = new Set(declared)
  const consumed = new Set(args.consumedKeys)

  const isConsumed = (key: string): boolean => {
    if (consumed.has(key)) return true
    const parts = key.split('.')
    for (let i = parts.length - 1; i >= 1; i--) {
      const prefix = parts.slice(0, i).join('.')
      if (prefix.includes('.') && consumed.has(prefix)) return true
    }
    return false
  }

  const registryKeys: string[] = []
  for (const c of registry) {
    if (c.enabledKey) registryKeys.push(c.enabledKey)
    for (const k of c.configKeys) registryKeys.push(k)
  }
  const registryKeySet = [...new Set(registryKeys)].sort()

  const registryKeysNotDeclared = registryKeySet.filter((k) => !declaredSet.has(k))
  const registryKeysUnconsumed = registryKeySet.filter((k) => !isConsumed(k))

  const declaredUnconsumed = declared.filter((k) => !isConsumed(k))
  const unconsumedKeys = [...new Set([...declaredUnconsumed, ...registryKeysUnconsumed])].sort()

  const exemptSet = new Set(exempt)
  const baselineKeys = unconsumedKeys.filter((k) => exemptSet.has(k))
  const newDanglingKeys = unconsumedKeys.filter((k) => !exemptSet.has(k))
  const staleBaselineKeys = [...exemptSet].filter((k) => !unconsumedKeys.includes(k)).sort()

  return {
    registryKeysNotDeclared: registryKeysNotDeclared.sort(),
    registryKeysUnconsumed: registryKeysUnconsumed.sort(),
    unconsumedKeys,
    baselineKeys,
    newDanglingKeys,
    staleBaselineKeys,
  }
}

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
