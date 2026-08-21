// env.ts
//
// 环境变量统一治理层（纯增强，不改任何既有读取逻辑）。
//
// 背景：modu-agent 中 `process.env` 分散在 11 个文件、约 34 处读取，且仅 3 个
// （MODU_LLM_PROVIDER / MODU_LLM_TEMPERATURE / MODU_MEMORY_STRATEGY）进入
// `RuntimeConfig.fromEnv()`，其余（LLM 密钥/端点/模型、Chroma、工具根目录、
// 代理等）由各模块直接裸读，既不入 DEFAULT_CONFIG，也不被 `/debug/config`
// 溯源快照覆盖——导致环境变量无法审计、密钥无法统一脱敏。
//
// 本模块提供一份**集中注册表**（ENV_VAR_REGISTRY），用于：
//   1. 列出全部环境变量的名称、类别、是否敏感、所属消费模块、是否进入 RuntimeConfig；
//   2. 供 snapshot.ts 生成环境变量来源清单（脱敏后）；
//   3. 供宿主/调试工具审计"到底读了哪些环境变量、哪些是密钥"。
//
// 设计约束：
//   - 纯数据 + 纯函数，零副作用；不修改 RuntimeConfig、不读取/写入任何文件。
//   - **不替代**各模块现有的 `process.env.X` 读取（避免改动业务逻辑引入缺陷）；
//     本模块是"清单/审计层"，与既有读取并存。
//   - 默认行为与现状完全一致：不注册任何变更、不抛异常。

/** 环境变量类别。 */
export type EnvVarCategory =
  | 'llm_connection'   // LLM 密钥/端点/模型（连接类参数）
  | 'llm_behavior'     // 进入 RuntimeConfig 的 LLM 行为参数
  | 'memory'           // 记忆/存储
  | 'tool_path'        // 工具根目录
  | 'proxy'            // 网络代理
  | 'search'           // 外部检索服务
  | 'misc'             // 其他（配置路径等）

/** 单个环境变量的注册信息。 */
export interface EnvVarDescriptor {
  /** 环境变量名（大写） */
  name: string
  /** 类别 */
  category: EnvVarCategory
  /** 是否敏感（密钥/token 类），脱敏快照中会掩盖 */
  sensitive: boolean
  /** 消费该变量的模块（文件/职责描述） */
  consumers: string[]
  /** 是否进入 RuntimeConfig（经 fromEnv 或 getConfig） */
  inRuntimeConfig: boolean
  /** 映射到的配置键（若 inRuntimeConfig 为 true，否则为 null） */
  configKey?: string
  /** 说明 */
  description: string
}

/**
 * 全量环境变量注册表。
 *
 * 与源码核对（`grep process.env.` 于 src/，2026-08-21）：
 *   - reasoning/llm/{glm,deepseek,qwen,gpt}.ts：MODU_*_API_KEY/BASE_URL/MODEL
 *   - graph/adapters/llm-adapter.ts：provider 映射 + 通用 LLM_API_KEY/BASE_URL/DEFAULT_MODEL
 *   - config/runtime-config.ts：MODU_LLM_PROVIDER/TEMPERATURE、MODU_MEMORY_STRATEGY、MODU_CONFIG_PATH
 *   - memory/chroma.ts：MODU_CHROMA_IN_MEMORY/PATH
 *   - tools/{search,file-ops,doc-writer}.ts：TAVILY_API_KEY、HTTP(S)_PROXY、MODU_FILE_OPS_ROOT、MODU_DOC_WRITER_ROOT
 *   - tools/code-executor.ts：PATH（系统变量，已排除，不纳入治理清单）
 */
export const ENV_VAR_REGISTRY: readonly EnvVarDescriptor[] = [
  // ---- LLM 连接类（provider 专属 + 通用）----
  { name: 'MODU_GLM_API_KEY', category: 'llm_connection', sensitive: true, consumers: ['reasoning/llm/glm.ts', 'graph/adapters/llm-adapter.ts'], inRuntimeConfig: false, description: 'GLM API 密钥' },
  { name: 'MODU_GLM_BASE_URL', category: 'llm_connection', sensitive: false, consumers: ['reasoning/llm/glm.ts', 'graph/adapters/llm-adapter.ts'], inRuntimeConfig: false, description: 'GLM 端点' },
  { name: 'MODU_GLM_MODEL', category: 'llm_connection', sensitive: false, consumers: ['reasoning/llm/glm.ts', 'graph/adapters/llm-adapter.ts'], inRuntimeConfig: false, description: 'GLM 模型名' },
  { name: 'MODU_DEEPSEEK_API_KEY', category: 'llm_connection', sensitive: true, consumers: ['reasoning/llm/deepseek.ts', 'graph/adapters/llm-adapter.ts'], inRuntimeConfig: false, description: 'DeepSeek API 密钥' },
  { name: 'MODU_DEEPSEEK_BASE_URL', category: 'llm_connection', sensitive: false, consumers: ['reasoning/llm/deepseek.ts', 'graph/adapters/llm-adapter.ts'], inRuntimeConfig: false, description: 'DeepSeek 端点' },
  { name: 'MODU_DEEPSEEK_MODEL', category: 'llm_connection', sensitive: false, consumers: ['reasoning/llm/deepseek.ts', 'graph/adapters/llm-adapter.ts'], inRuntimeConfig: false, description: 'DeepSeek 模型名' },
  { name: 'MODU_QWEN_API_KEY', category: 'llm_connection', sensitive: true, consumers: ['reasoning/llm/qwen.ts', 'graph/adapters/llm-adapter.ts'], inRuntimeConfig: false, description: 'Qwen API 密钥' },
  { name: 'MODU_QWEN_BASE_URL', category: 'llm_connection', sensitive: false, consumers: ['reasoning/llm/qwen.ts', 'graph/adapters/llm-adapter.ts'], inRuntimeConfig: false, description: 'Qwen 端点' },
  { name: 'MODU_QWEN_MODEL', category: 'llm_connection', sensitive: false, consumers: ['reasoning/llm/qwen.ts', 'graph/adapters/llm-adapter.ts'], inRuntimeConfig: false, description: 'Qwen 模型名' },
  { name: 'MODU_OPENAI_API_KEY', category: 'llm_connection', sensitive: true, consumers: ['reasoning/llm/gpt.ts'], inRuntimeConfig: false, description: 'OpenAI(GPT) API 密钥' },
  { name: 'MODU_OPENAI_BASE_URL', category: 'llm_connection', sensitive: false, consumers: ['reasoning/llm/gpt.ts'], inRuntimeConfig: false, description: 'OpenAI(GPT) 端点' },
  { name: 'MODU_OPENAI_MODEL', category: 'llm_connection', sensitive: false, consumers: ['reasoning/llm/gpt.ts'], inRuntimeConfig: false, description: 'OpenAI(GPT) 模型名' },
  { name: 'LLM_API_KEY', category: 'llm_connection', sensitive: true, consumers: ['reasoning/llm/glm.ts', 'reasoning/llm/deepseek.ts', 'graph/adapters/llm-adapter.ts'], inRuntimeConfig: false, description: '通用 LLM API 密钥（兜底）' },
  { name: 'LLM_BASE_URL', category: 'llm_connection', sensitive: false, consumers: ['reasoning/llm/glm.ts', 'reasoning/llm/deepseek.ts', 'graph/adapters/llm-adapter.ts'], inRuntimeConfig: false, description: '通用 LLM 端点（兜底）' },
  { name: 'LLM_DEFAULT_MODEL', category: 'llm_connection', sensitive: false, consumers: ['reasoning/llm/glm.ts', 'reasoning/llm/deepseek.ts', 'graph/adapters/llm-adapter.ts'], inRuntimeConfig: false, description: '通用 LLM 默认模型名（兜底）' },
  // ---- LLM 行为参数（进入 RuntimeConfig）----
  { name: 'MODU_LLM_PROVIDER', category: 'llm_behavior', sensitive: false, consumers: ['config/runtime-config.ts'], inRuntimeConfig: true, configKey: 'llm.default_provider', description: '默认 LLM provider' },
  { name: 'MODU_LLM_TEMPERATURE', category: 'llm_behavior', sensitive: false, consumers: ['config/runtime-config.ts'], inRuntimeConfig: true, configKey: 'llm.temperature', description: 'LLM 温度' },
  { name: 'MODU_MEMORY_STRATEGY', category: 'memory', sensitive: false, consumers: ['config/runtime-config.ts'], inRuntimeConfig: true, configKey: 'memory.default_strategy', description: '记忆策略' },
  // ---- 记忆/存储 ----
  { name: 'MODU_CHROMA_IN_MEMORY', category: 'memory', sensitive: false, consumers: ['memory/chroma.ts'], inRuntimeConfig: false, description: 'Chroma 是否内存模式' },
  { name: 'MODU_CHROMA_PATH', category: 'memory', sensitive: false, consumers: ['memory/chroma.ts'], inRuntimeConfig: false, description: 'Chroma 持久化路径' },
  // ---- 工具根目录 ----
  { name: 'MODU_FILE_OPS_ROOT', category: 'tool_path', sensitive: false, consumers: ['tools/file-ops.ts'], inRuntimeConfig: false, description: '文件操作工具根目录' },
  { name: 'MODU_DOC_WRITER_ROOT', category: 'tool_path', sensitive: false, consumers: ['tools/doc-writer.ts'], inRuntimeConfig: false, description: '文档写入工具根目录' },
  // ---- 检索 / 代理 ----
  { name: 'TAVILY_API_KEY', category: 'search', sensitive: true, consumers: ['tools/search.ts'], inRuntimeConfig: false, description: 'Tavily 检索 API 密钥' },
  { name: 'HTTP_PROXY', category: 'proxy', sensitive: false, consumers: ['tools/search.ts'], inRuntimeConfig: false, description: 'HTTP 代理' },
  { name: 'HTTPS_PROXY', category: 'proxy', sensitive: false, consumers: ['tools/search.ts'], inRuntimeConfig: false, description: 'HTTPS 代理' },
  { name: 'http_proxy', category: 'proxy', sensitive: false, consumers: ['tools/search.ts'], inRuntimeConfig: false, description: 'HTTP 代理（小写，Linux 约定）' },
  { name: 'https_proxy', category: 'proxy', sensitive: false, consumers: ['tools/search.ts'], inRuntimeConfig: false, description: 'HTTPS 代理（小写，Linux 约定）' },
  // ---- 其他 ----
  { name: 'MODU_CONFIG_PATH', category: 'misc', sensitive: false, consumers: ['config/runtime-config.ts'], inRuntimeConfig: false, description: '显式 JSON 配置文件路径' },
]

/** 敏感键正则（与 snapshot.ts 保持一致，供脱敏复用）。 */
export const SENSITIVE_KEY_RE = /(api[_-]?key|token|secret|password|credential|authorization|bearer)/i

/**
 * 按类别分组返回注册表。
 */
export function groupEnvVarsByCategory(): Record<string, EnvVarDescriptor[]> {
  const out: Record<string, EnvVarDescriptor[]> = {}
  for (const d of ENV_VAR_REGISTRY) {
    ;(out[d.category] ??= []).push(d)
  }
  return out
}

/**
 * 读取单个环境变量的当前值（若已设置），返回 null 表示未设置。
 */
export function readEnvVar(name: string): string | null {
  const v = process.env[name]
  return v === undefined ? null : v
}

/**
 * 收集当前进程**已设置**的环境变量来源清单（供 /debug/config 溯源）。
 *
 * 返回形如：
 *   { 'MODU_GLM_API_KEY': '***', 'MODU_LLM_PROVIDER': 'deepseek', ... }
 * 敏感变量（api_key 等）值被脱敏；未设置的变量不出现。
 *
 * @param opts.maskSensitive 是否对敏感值脱敏（默认 true）
 */
export function collectEnvSources(opts: { maskSensitive?: boolean } = {}): Record<string, string> {
  const mask = opts.maskSensitive ?? true
  const out: Record<string, string> = {}
  for (const d of ENV_VAR_REGISTRY) {
    const v = readEnvVar(d.name)
    if (v === null) continue
    out[d.name] = mask && d.sensitive ? '***' : v
  }
  return out
}

/**
 * 审计辅助：返回当前进程环境变量与注册表的一致性报告。
 * - registered：已注册且已设置的变量数
 * - unregistered：已设置但未纳入注册表的环境变量数（可能遗漏，需人工核对）
 * - sensitiveSet：已设置的敏感变量数（脱敏快照会掩盖）
 */
export function auditEnvVars(): { registered: number; unregistered: number; sensitiveSet: number } {
  const registeredNames = new Set(ENV_VAR_REGISTRY.map((d) => d.name))
  let registered = 0
  let sensitiveSet = 0
  const unregisteredNames = new Set<string>()
  for (const name of Object.keys(process.env)) {
    if (registeredNames.has(name)) {
      const d = ENV_VAR_REGISTRY.find((x) => x.name === name)!
      registered++
      if (d.sensitive) sensitiveSet++
    } else {
      unregisteredNames.add(name)
    }
  }
  return { registered, unregistered: unregisteredNames.size, sensitiveSet }
}
