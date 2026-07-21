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
    },
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
