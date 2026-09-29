// 对应 Python: modu_graph/adapters/llm_adapter.py
// LLM 适配器：构建 LangChain ChatOpenAI 实例。
//
// 复用现有环境变量约定（MODU_GLM_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY 等），
// 将 ModuAgent 的 BaseReasoningEngine 适配为 LangChain BaseChatModel。
//
// GLM / DeepSeek / Qwen 均兼容 OpenAI 协议，可直接用 ChatOpenAI 对接。
// bind_tools() 原生 function calling 替代手写正则解析 ```tool_call```。
//
// P1（T-12）：provider 收口为**可注册工厂**。
//   - provider 规格（env 名 / 默认模型 / 默认端点）收敛为唯一事实源
//     `llm-provider-registry.ts` 的 `BUILTIN_LLM_PROVIDER_SPECS`（纯数据）；
//   - 本模块提供"实际构造 ChatModel"的回调（含 env 解析 + undici fetch 修复），
//     并通过 `registerBuiltinLLMProviders()` 幂等注册进 ComponentRegistry；
//   - `build_chat_model()` 改为**经注册表**取工厂构造：
//       宿主 `registerLLMProvider` 注册的自定义 provider 即可被直接使用，
//       无需修改内核源码（M2「横向可替换」验收之一）。
//   - 兼容性：未注册时自动回退到内置工厂；未知 provider 仍回退 glm（保持改造前行为）；
//     默认 provider 的"次级兜底"由 `'glm'` 统一为 `'deepseek'`
//     （与 DEFAULT_CONFIG 的 `llm.default_provider` 及全部调用点一致）。
import { ChatOpenAI } from '@langchain/openai'

import type { RuntimeConfig } from '../../config/runtime-config.js'
import { getConfig } from '../../config/runtime-config.js'
import type { LLMProviderConfig, LLMProviderSpec } from '../../core/interfaces/llm-provider.js'
import { getRegistry, type ComponentRegistry } from '../../core/registry.js'
import {
  createBuiltinLLMProviderFactories,
  ensureBuiltinLLMProviders,
  type ChatModelBuilder,
} from './llm-provider-registry.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[graph.llm_adapter] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[graph.llm_adapter] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[graph.llm_adapter] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[graph.llm_adapter] ${msg}`, ...args),
}

/**
 * 默认 provider（`llm.default_provider` 未配置时的次级兜底）。
 *
 * P1（T-12）统一：改造前此处为 `'glm'`，与 DEFAULT_CONFIG 的
 * `llm.default_provider: 'deepseek'`（runtime-config.ts:21）以及
 * `factory.ts:578,715,751` 的 `'deepseek'` 不一致 —— 属"第 4 个默认值来源"。
 */
const DEFAULT_LLM_PROVIDER = 'deepseek'

/** 未知 provider 的降级目标（保持改造前行为：回退 glm）。 */
const UNKNOWN_PROVIDER_FALLBACK = 'glm'

/** 取第一个已设置的环境变量值（跳过空串）。 */
function _firstSetEnv(names?: readonly string[]): string | undefined {
  if (!names) return undefined
  for (const name of names) {
    const v = process.env[name]
    if (v !== undefined && v !== '') return v
  }
  return undefined
}

/**
 * 按"显式参数 > 主 env > 别名 env > 通用 LLM_* > 默认值"解析连接参数。
 *
 * 该顺序与改造前 `_PROVIDER_CONFIG` 路径逐条一致（新增的只有"别名 env"一级，
 * 用于兼容 `reasoning/llm/{gpt,qwen}.ts` 的第二轨命名）。
 */
function _resolveProviderEnv(
  spec: LLMProviderSpec,
  cfg: Pick<LLMProviderConfig, 'apiKey' | 'baseUrl' | 'model'>,
): { apiKey: string; baseUrl: string; model: string } {
  const apiKey =
    cfg.apiKey ||
    process.env[spec.apiKeyEnv] ||
    _firstSetEnv(spec.apiKeyEnvAliases) ||
    process.env.LLM_API_KEY ||
    ''

  const baseUrl =
    cfg.baseUrl ||
    process.env[spec.baseUrlEnv] ||
    _firstSetEnv(spec.baseUrlEnvAliases) ||
    process.env.LLM_BASE_URL ||
    spec.defaultBaseUrl

  const model =
    cfg.model ||
    process.env[spec.modelEnv] ||
    _firstSetEnv(spec.modelEnvAliases) ||
    process.env.LLM_DEFAULT_MODEL ||
    spec.defaultModel

  return { apiKey, baseUrl, model }
}

/**
 * 内置 provider 的实际构造回调（唯一 ChatModel 构造入口）。
 *
 * 保留改造前的全部行为：
 *   - 缺少 API Key 时警告（不抛错，交由 Provider 侧返回 401）
 *   - 覆盖 openai SDK 默认 node-fetch → 使用 Node 内置 undici fetch
 *     （规避 chunked SSE 的 "Premature close"，见下方注释）
 *   - temperature / max_tokens 的"参数 > 配置 > 默认值"顺序
 */
const _buildChatModel: ChatModelBuilder = (
  spec: LLMProviderSpec,
  cfg: { model?: string | null; temperature?: number | null; maxTokens?: number | null; apiKey?: string | null; baseUrl?: string | null },
  runtimeConfig: RuntimeConfig,
): ChatOpenAI => {
  const { apiKey, baseUrl, model } = _resolveProviderEnv(spec, cfg)

  if (!apiKey) {
    logger.warning("API key not set for provider '%s' (env: %s)", spec.id, spec.apiKeyEnv)
  }

  const effectiveTemp =
    cfg.temperature != null ? cfg.temperature : runtimeConfig.get('llm.temperature', 0.7)
  const effectiveMaxTokens =
    cfg.maxTokens != null ? cfg.maxTokens : runtimeConfig.get('llm.max_tokens', 512)

  logger.info(
    'Building ChatOpenAI: provider=%s model=%s base_url=%s temp=%.2f max_tokens=%d',
    spec.id, model, baseUrl, effectiveTemp, effectiveMaxTokens,
  )

  return new ChatOpenAI({
    apiKey,
    configuration: {
      baseURL: baseUrl,
      // P0 修复：覆盖 openai SDK 默认的 node-fetch。
      // node-fetch 对 chunked 且无 content-length 的 SSE 响应，在服务端
      // 发完 [DONE] 正常关闭连接时会误报 "Premature close"（ERR_STREAM_PREMATURE_CLOSE，
      // 见 node-fetch fixResponseChunkedTransferBadEnding）。改用 Node 22 内置
      // undici fetch（能正确处理该场景），规避 DeepSeek 流式调用失败。
      fetch: globalThis.fetch as typeof fetch,
    },
    model,
    temperature: effectiveTemp,
    maxTokens: effectiveMaxTokens,
    streaming: true, // 原生支持流式，替代手写 stream()
  })
}

/**
 * P1（T-12）：幂等注册内置 provider 工厂。
 *
 * - 已注册同 id 的 provider 不会被覆盖（宿主覆盖优先）；
 * - 在 `create_agent` 启动阶段调用一次，使 `registry.listLLMProviders()` 可观测；
 * - 即使不调用，`build_chat_model` 也会按需兜底注册，故**默认行为零变化**。
 *
 * @param registry 目标注册表（默认全局单例）
 * @returns 本次新注册的 provider id 列表
 */
export function registerBuiltinLLMProviders(registry?: ComponentRegistry): string[] {
  const reg = registry ?? getRegistry()
  try {
    const registered = ensureBuiltinLLMProviders(reg, _buildChatModel)
    if (registered.length > 0) {
      logger.info('[P1-T12] Registered builtin LLM providers: %s', registered.join(','))
    }
    return registered
  } catch (e: any) {
    logger.warning('[P1-T12] Failed to register builtin LLM providers: %s', String(e?.message ?? e))
    return []
  }
}

/**
 * 构造 LangChain ChatOpenAI 实例，复用现有环境变量约定。
 *
 * P1（T-12）：改为经 `ComponentRegistry` 的 provider 工厂构造。
 * 未注册时自动回退注册内置工厂，因此对既有调用方**行为等价**。
 *
 * @param provider LLM 提供商（glm/deepseek/gpt/qwen 或宿主自定义），null=从配置读取
 * @param config 运行时配置（默认使用全局单例）
 * @param temperature 温度参数覆盖
 * @param maxTokens 最大 token 覆盖
 * @param model 模型名覆盖（如 "deepseek-chat"），null=从环境变量读取
 * @param registry 目标注册表（默认全局单例；测试可注入隔离实例）
 * @returns ChatOpenAI 实例（streaming=true，支持原生 function calling）
 */
export function build_chat_model(
  provider?: string | null,
  config?: RuntimeConfig | null,
  temperature?: number | null,
  maxTokens?: number | null,
  model?: string | null,
  registry?: ComponentRegistry | null,
): ChatOpenAI {
  if (!config) {
    config = getConfig()
  }
  const reg = registry ?? getRegistry()

  let providerId = (provider || config.get('llm.default_provider', DEFAULT_LLM_PROVIDER) || DEFAULT_LLM_PROVIDER) as string

  // 未注册 → 兜底注册内置工厂（幂等），保持"未显式注册也能用"的既有语义
  let factory = reg.getLLMProvider(providerId)
  if (!factory) {
    registerBuiltinLLMProviders(reg)
    factory = reg.getLLMProvider(providerId)
  }

  if (!factory) {
    logger.warning(
      "Unknown provider '%s', falling back to %s",
      providerId, UNKNOWN_PROVIDER_FALLBACK,
    )
    providerId = UNKNOWN_PROVIDER_FALLBACK
    factory = reg.getLLMProvider(providerId)
    if (!factory) {
      // 极端情况：内置工厂全部注册失败（如 registry 被替换为残缺实现）
      throw new Error(
        `LLM provider '${providerId}' unavailable and builtin providers failed to register`,
      )
    }
  }

  return factory.create(
    { provider: factory.id, model, temperature, maxTokens },
    config,
  )
}

/**
 * 构建保守模式 ChatModel（低温度），用于低置信度感知场景。
 *
 * 对应 coordinator.py 中 confidence < 0.5 时降低 temperature 的逻辑。
 */
export function build_conservative_chat_model(
  provider?: string | null,
  config?: RuntimeConfig | null,
): ChatOpenAI {
  return build_chat_model(
    provider,
    config,
    0.3,
  )
}

/**
 * P1（T-12）：返回内置 provider 工厂列表（不注册），供测试与审计比对。
 */
export function listBuiltinLLMProviders(): Array<{ id: string; defaultModel: string; apiKeyEnv: string }> {
  return createBuiltinLLMProviderFactories(_buildChatModel).map((f) => ({
    id: f.id,
    defaultModel: f.defaultModel,
    apiKeyEnv: f.apiKeyEnv,
  }))
}
