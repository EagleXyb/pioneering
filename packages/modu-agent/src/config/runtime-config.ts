// 对应 Python: config/runtime_config.py
// RuntimeConfig：线程安全（Node 单线程模型简化并发）+ 热更新支持 + 变更回调
import { EventEmitter } from 'events'
import path from 'path'
import fs from 'fs'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[config] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[config] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[config] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[config] ${msg}`, ...args),
}

// ============================================================
// 默认配置（对应 Python _DEFAULT_CONFIG，逐字段等价）
// ============================================================

export const DEFAULT_CONFIG: Record<string, any> = {
  llm: {
    default_provider: 'deepseek',
    temperature: 0.7,
    max_tokens: 512,
    prompt_template: '',
    tool_call_pattern: /```tool_call\s*\n(.*?)\n```/,
    max_reasoning_iterations: 3,
    max_format_retries: 2,
    retry: {
      max_attempts: 2,
    },
    // 统一 LLM 接口层连接池配置（对应文档 §2.1 连接池显式化建议）
    // 仅作用于 BaseLLMReasoner 自研 fetch 路径；LangChain ChatOpenAI 路径由 openai SDK 内部管理
    connection_pool: {
      enabled: false,           // 默认关闭，保持 undici 默认行为；启用后使用显式 Agent
      max_connections: 100,     // undici Agent maxConnections（每主机连接上限）
      keep_alive_timeout: 4000, // undici Agent keepAliveTimeout（毫秒）
      keep_alive_max_timeout: 300000,
    },
    // 统一 LLM 接口层成本核算开关（对应文档 §2.1 成本核算建议）
    // 启用后 invoke() 会发布 EventDomain.LLM + EventAction.COST 事件
    cost_tracking: {
      enabled: true,
    },
    // LLM 模型路由配置（对应文档 §2.1 模型路由层建议）
    // RuleBasedLLMRouter 按 rules 顺序匹配，首个命中规则胜出
    router: {
      enabled: false,           // 默认关闭，启用后 create_agent 会包装为 LLMRouter
      default_route: 'default', // 无规则命中时的兜底路由名
      routes: {
        // 路由名 → { provider, model, temperature?, max_tokens? }
        default: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      },
      rules: [
        // 示例规则：按 task_type 路由
        // { when: { task_type: 'planning' }, route: 'pro' },
        // { when: { estimated_complexity: 'high' }, route: 'pro' },
      ],
    },
  },
  memory: {
    default_strategy: 'cache',
    context_window: 'last_5_turns',
    enable_compression: false,
    checkpointer_type: 'memory',
    store_type: 'chroma',
    chroma_persist_path: null,
  },
  orchestration: {
    engine: 'langgraph',
    multi_agent: {
      enabled: false,
      max_subagents: 5,
      consensus_strategy: 'majority_vote',
      consensus_quorum: 2,
      subgraph_timeout_ms: 30000,
      consensus_failure_as_evolution_signal: true,
      // v1.4 §4.4 建议1：LLM 驱动任务拆分（默认开启，plannerLlm 为空时自动 fallback）
      use_llm_decompose: true,
      // v1.4 §4.4 建议14：子 Agent 失败重试次数（0=不重试）
      subagent_max_retries: 1,
    },
    // 路由分叉配置化（对应文档 §2.3 建议4）
    // 按顺序匹配，首个命中规则胜出；无规则命中时按内置默认优先级回退
    // 运行时新增模式只需追加规则，无需改源码
    mode_router: [
      { when: { config_key: 'orchestration.multi_agent.enabled', config_value: true }, route: 'supervisor' },
      { when: { configurable_key: 'plan_execute_enabled', configurable_value: true }, route: 'planner' },
      { when: { config_key: 'plan_execute.enabled', config_value: true }, route: 'planner' },
    ],
  },
  // P4 Plan-and-Execute 模式（默认关闭，零侵入；与 multi_agent 互斥，multi_agent 优先）
  plan_execute: {
    enabled: false,
    max_steps: 10,
    max_replans: 2,
    planner_temperature: 0.2,
    continue_on_failure: false,
    compact_completed_steps: false,
    step_summary_max_chars: 500,
  },
  tools: {
    default_timeout_ms: 1800000,
    retry: {
      max_attempts: 3,
      base_delay: 0.5,
      max_delay: 5.0,
    },
    human_in_loop: {
      enabled: false,
      approval_timeout_seconds: 300,
      auto_reject_on_timeout: true,
      sensitive_tools: ['code_executor', 'sql_query', 'file_ops_write'],
    },
    // 工具结果字符级截断（对应文档 §4.3 建议1）
    // 启用后 wrap_modu_tool 在返回前按工具名截断结果，避免大响应撑爆 LLM 上下文
    // - default: 全局默认上限（0 表示不截断）
    // - limits.{tool_name}: 按工具名单独配置，覆盖 default
    // 截断时在结果末尾追加 "[truncated]" 标记
    max_result_chars: {
      default: 0,  // 默认不截断；启用时建议设置为 8000~20000
      limits: {
        // 示例：
        // search_engine: 4000,
        // http_request: 8000,
      },
    },
    // 工具结果缓存（对应文档 §4.3 建议2）
    // 启用后 wrap_modu_tool 按 tool_name + hash(args) 缓存结果，避免重复调用
    // - enabled: 全局开关（默认 false）
    // - default_ttl_ms: 默认 TTL（毫秒），0 表示永不过期
    // - max_entries: 全局最大缓存条目数（LRU 淘汰）
    // - tools.{tool_name}.ttl_ms: 按工具名单独配置 TTL（覆盖 default_ttl_ms）
    //   仅在 tools.{tool_name} 配置存在时该工具才启用缓存
    //   （即仅对显式配置的工具启用，避免误缓存副作用工具如 file_ops_write）
    result_cache: {
      enabled: false,
      default_ttl_ms: 60000,  // 60s
      max_entries: 100,
      tools: {
        // 示例：
        // search_engine: { ttl_ms: 120000 },
        // http_request: { ttl_ms: 60000 },
      },
    },
    // 工具限流配置（对应文档 §2.5 建议7）
    // 启用后 wrap_modu_tool 外层包装 token bucket，按工具名配置 RPM 上限
    // 缺失工具名的配置表示不限流
    rate_limit: {
      enabled: false,  // 默认关闭，启用后按工具名读取 limits
      limits: {
        // 示例：code_executor 60 RPM，http_request 120 RPM
        // code_executor: 60,
        // http_request: 120,
      },
    },
  },
  skills: {
    enabled: false,
    auto_discover_dirs: [],
    active: [],
  },
  streaming: {
    chunk_size: 4,
  },
  event_bus: {
    max_log_size: 1000,
    // 事件 TTL（毫秒），0 表示不启用（对应文档 §2.2 建议5）
    // 启用后 PersistentEventLog 会丢弃超过 TTL 的事件，避免日志无限累积
    event_ttl_ms: 0,
    // 持久化日志文件路径（空字符串表示不持久化到文件）
    log_file_path: '',
    // 持久化日志单文件最大大小（MB），超过后滚动
    log_max_file_size_mb: 10.0,
    // 仅持久化指定 domain 的事件；null 表示全部
    log_domains: null,
  },
  perception: {
    default_processor: 'text_preprocessor',
    max_length: 2048,
    sensitivity_threshold: 5,
    routing: {
      text: { pipeline: ['text_preprocessor', 'llm_parser'] },
      image: { pipeline: ['image_processor', 'text_preprocessor'] },
      audio: { pipeline: ['audio_processor', 'text_preprocessor'] },
    },
    fusion: {
      strategy: 'weighted_average',
      weights: { text: 0.5, image: 0.3, audio: 0.2 },
    },
    security: {
      enable_guard: true,
      block_on_injection: false,
      block_on_pii: false,
      // LLM-based Prompt 注入二次校验（对应文档 §2.5 建议1）
      // 默认关闭：启用后会对关键词检测未命中（risk_level=0）的输入
      // 调用 LLM 做语义级二次校验，增加延迟但提升对抗绕过能力
      llm_judge: {
        enabled: false,
        // 仅在关键词检测 risk_level 低于此阈值时触发 LLM 二次校验
        // （关键词已判定高风险时无需再调用 LLM，节省成本）
        risk_threshold: 1,
      },
    },
    deep_parsing: {
      enable: true,
      enable_intent: true,
      enable_quality: false,
      enable_local_ner: true,
      enable_local_sentiment: true,
      spacy_model: null,
    },
    event_log_path: 'logs/perception_events.jsonl',
    event_log_max_size_mb: 10.0,
    evolution_report_interval: 100,
    enable_context_reduction: true,
  },
  feedback: {
    evolution_threshold: 0.6,
    enable_evolution: true,
    min_sample_size: 10,
    quality_monitor_mode: 'rule',
    quality_monitor_llm_timeout: 10.0,
    quality_monitor_llm_provider: null,
    quality_monitor_llm_temperature: 0.0,
    quality_monitor_llm_max_tokens: 256,
  },
  observability: {
    tracing: {
      enabled: false,
      otlp_endpoint: '',
      service_name: 'modu-agent',
      sampling_rate: 0.1,
    },
    metrics: {
      enabled: false,
      prometheus_port: 9090,
      path: '/metrics',
    },
    logging: {
      structured: false,
      level: 'INFO',
    },
  },
  mcp: {
    enabled: false,
    default_timeout: 30.0,
    servers: [],
  },
  // === P0 优化（ReAct 模式业务定制化）===
  // 所有 P0 优化项均通过 feature flag 控制，默认行为与现状一致（零侵入）。
  // 风险登记表 R-01~R-04 要求：字段全 optional + 异常降级 + 默认关闭高风险项
  react_optimization: {
    // P0-1: Thought 分层推理框架
    // 启用后 perception 节点调用 ComplexityAssessor 评估 tier，
    // agentNode 按 tier 调整温度，routeAfterAgent 按 reasoning_budget 终止
    complexity_assessment: {
      enabled: false,  // R-01 中等风险，默认关闭；启用后 LLM 评估失败自动回退规则化评估
    },
    // P0-2: CoT 锚点 + 反思后缀
    // 启用后 agentNode 按 tier 拼接 CoT prompt（tier_3 强制启用锚点+反思）
    cot_anchor: {
      enabled: false,  // R-02 低风险，默认关闭以便 A/B 测试对比 avg_rounds_per_task
    },
    // P0-3: Observation 多层蒸馏器
    // 启用后 toolResultProcessor 对工具结果三层蒸馏，写入 observation_history
    observation_distillation: {
      enabled: true,   // R-03 中等风险，默认启用（异常自动降级回原始 content）
      max_tokens: 500, // 蒸馏后 summary 的 token 预算上限
    },
    // P0-4: 自适应终止判定引擎
    // 第一阶段：advisory 模式，仅采集 confidence_history/information_gain_history/termination_advice
    // 不改变 routeAfterAgent 路由；第二阶段待 false_positive_rate < 5% 后才影响路由
    // P1-3: 场景化参数动态调优
    //   - scene_profile: 显式指定场景（quick_qa/complex_analysis/creative_generation/high_stakes_decision）
    //   - use_tier_mapping: 启用 tier→scene 自动映射（默认 true）
    //   优先级：scene_profile > tier 映射 > 默认 complex_analysis
    adaptive_termination: {
      enabled: false,  // R-04 高风险，第一阶段默认关闭；启用后仅 advisory 不改变路由
      scene_profile: null,  // R-07 低风险，默认 null 启用 tier 映射
      use_tier_mapping: true,  // 按 complexity_assessment.tier 自动选择场景配置
    },
    // P1-4: 四层 Prompt 解耦架构
    // 启用后通过 PromptComposer 组装 system prompt（systemCore + domain + taskSpec + runtimeContext）
    // 默认关闭，启用后 domain 为空时行为与现状完全一致（字符等价）
    prompt_composer: {
      enabled: false,  // R-08 中等风险，默认关闭；启用后通过 configurable.domain 注入领域适配
    },
    // P1-5: 工具能力矩阵 + 意图路由
    // 启用后 _filterToolsByTaskType 升级为"先 task_type 粗筛 → 再 intent 细筛"两级管道
    // intent 匹配失败时回退到 task_type 结果（等价现状）
    tool_capability_matrix: {
      enabled: false,  // R-09 中等风险，默认关闭；启用后通过 subtask.intent 触发细筛
    },
  },
}

// ============================================================
// 辅助函数（对应 Python _shallow_copy / _deep_copy_dict）
// ============================================================

function shallowCopy(value: any): any {
  if (Array.isArray(value)) return [...value]
  if (value && typeof value === 'object') return { ...value }
  return value
}

function deepCopyDict(value: any): any {
  return structuredClone(value)
}

/**
 * 运行时配置（P2-10: 热更新支持）。
 *
 * Node.js 单线程模型简化了并发，无需 RLock。
 * 变更回调改用 EventEmitter（对应 Python register_change_callback）。
 *
 * 对应 Python RuntimeConfig：
 *   - get(key_path, default) 点分路径读取
 *   - update(key_path, value) 返回旧值
 *   - update_many(updates) 批量原子更新
 *   - register_change_callback(callback) 注册变更监听
 *   - as_dict() 返回深拷贝
 */
export class RuntimeConfig {
  private _data: Record<string, any>
  // P2-10: 配置变更回调（用 EventEmitter 替代 Python 的回调列表）
  private _emitter = new EventEmitter()

  constructor(configData?: Record<string, any> | null) {
    // P2-4 修复：深拷贝 DEFAULT_CONFIG，避免嵌套 dict 被多个实例共享
    this._data = deepCopyDict(DEFAULT_CONFIG)
    if (configData) {
      RuntimeConfig._deepMerge(this._data, configData)
    }
  }

  static fromFile(filePath: string): RuntimeConfig {
    const p = path.resolve(filePath)
    if (!fs.existsSync(p)) {
      logger.warning('Config file not found: %s, using defaults', filePath)
      return new RuntimeConfig()
    }
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
    return new RuntimeConfig(data)
  }

  static fromEnv(): RuntimeConfig {
    const data: Record<string, any> = {}
    const provider = process.env.MODU_LLM_PROVIDER
    if (provider) {
      ;(data.llm ??= {}).default_provider = provider
    }
    const temp = process.env.MODU_LLM_TEMPERATURE
    if (temp) {
      ;(data.llm ??= {}).temperature = parseFloat(temp)
    }
    const strategy = process.env.MODU_MEMORY_STRATEGY
    if (strategy) {
      ;(data.memory ??= {}).default_strategy = strategy
    }
    return new RuntimeConfig(data)
  }

  /** 线程安全地读取配置值（点分路径）。 */
  get(keyPath: string, defaultValue: any = null): any {
    const keys = keyPath.split('.')
    let current: any = this._data
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key]
      } else {
        return defaultValue
      }
    }
    // 返回浅拷贝避免外部直接修改内部状态（对 dict/list 类型）
    if (current && typeof current === 'object') {
      return shallowCopy(current)
    }
    return current
  }

  /** 线程安全地设置配置值（底层方法，等价于 update 但语义更直观）。 */
  set(keyPath: string, value: any): void {
    this.update(keyPath, value)
  }

  /**
   * 线程安全地更新配置值，返回旧值。
   * 供 evolution 策略（如 ParameterTuneStrategy）在运行时动态调整参数使用。
   * 变更后会触发已注册的回调。
   */
  update(keyPath: string, value: any): any {
    const keys = keyPath.split('.')
    let current: any = this._data
    for (const key of keys.slice(0, -1)) {
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {}
      }
      current = current[key]
    }
    const lastKey = keys[keys.length - 1]
    const oldValue = current[lastKey]
    current[lastKey] = value

    // 触发回调
    this._notifyChange(keyPath, oldValue, value)
    return oldValue
  }

  /**
   * 批量原子更新配置。
   * 在单次操作内完成多个更新。适用于 evolution 策略一次调整多个参数的场景。
   */
  updateMany(updates: Record<string, any>): Record<string, any> {
    const oldValues: Record<string, any> = {}
    for (const [keyPath, value] of Object.entries(updates)) {
      const keys = keyPath.split('.')
      let current: any = this._data
      for (const key of keys.slice(0, -1)) {
        if (!(key in current) || typeof current[key] !== 'object') {
          current[key] = {}
        }
        current = current[key]
      }
      const lastKey = keys[keys.length - 1]
      oldValues[keyPath] = current[lastKey]
      current[lastKey] = value
    }
    // 批量触发回调
    for (const [keyPath, value] of Object.entries(updates)) {
      this._notifyChange(keyPath, oldValues[keyPath], value)
    }
    return oldValues
  }

  /**
   * 注册配置变更回调。
   * 回调签名：(keyPath: string, oldValue: any, newValue: any) => void
   * evolution 策略可注册回调以响应配置变更（如重新构建图）。
   *
   * 对应 Python register_change_callback，返回注销函数。
   */
  registerChangeCallback(
    callback: (keyPath: string, oldValue: any, newValue: any) => void,
  ): () => void {
    const handler = (payload: { keyPath: string; oldValue: any; newValue: any }) => {
      try {
        callback(payload.keyPath, payload.oldValue, payload.newValue)
      } catch (e) {
        logger.warning("Config change callback failed for '%s': %s", payload.keyPath, String(e))
      }
    }
    this._emitter.on('change', handler)
    return () => {
      this._emitter.off('change', handler)
    }
  }

  /** 通知所有注册的回调（异常隔离，单个回调失败不影响其他）。 */
  private _notifyChange(keyPath: string, oldValue: any, newValue: any): void {
    if (oldValue === newValue) return
    this._emitter.emit('change', { keyPath, oldValue, newValue })
  }

  /** 返回配置的深拷贝（避免外部修改内部状态）。 */
  asDict(): Record<string, any> {
    return deepCopyDict(this._data)
  }

  private static _deepMerge(base: Record<string, any>, override: Record<string, any>): void {
    for (const [key, value] of Object.entries(override)) {
      if (key in base && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])
          && value && typeof value === 'object' && !Array.isArray(value)) {
        RuntimeConfig._deepMerge(base[key], value)
      } else {
        base[key] = value
      }
    }
  }
}

// ============================================================
// 全局单例（对应 Python 模块级 _config + get_config + reset_config）
// ============================================================

let _config: RuntimeConfig | null = null

/**
 * 获取全局 RuntimeConfig 单例。
 * P2-1: 新增 override 参数用于测试隔离。
 */
export function getConfig(override?: RuntimeConfig | null): RuntimeConfig {
  if (override !== undefined && override !== null) {
    _config = override
  }
  if (_config === null) {
    const configPath = process.env.MODU_CONFIG_PATH ?? ''
    if (configPath) {
      _config = RuntimeConfig.fromFile(configPath)
    } else {
      _config = RuntimeConfig.fromEnv()
    }
  }
  return _config
}

/** 重置全局 config 单例（测试清理用）。 */
export function resetConfig(): void {
  _config = null
}

/**
 * P2-1: 测试用上下文管理器——临时替换全局 config 单例，退出时自动恢复。
 */
export function overrideConfig(config: RuntimeConfig): { restore: () => void } {
  const old = _config
  _config = config
  return {
    restore: () => {
      _config = old
    },
  }
}
