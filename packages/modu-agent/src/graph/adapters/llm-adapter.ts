// 对应 Python: modu_graph/adapters/llm_adapter.py
// LLM 适配器：构建 LangChain ChatOpenAI 实例。
//
// 复用现有环境变量约定（MODU_GLM_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY 等），
// 将 ModuAgent 的 BaseReasoningEngine 适配为 LangChain BaseChatModel。
//
// GLM / DeepSeek / Qwen 均兼容 OpenAI 协议，可直接用 ChatOpenAI 对接。
// bind_tools() 原生 function calling 替代手写正则解析 ```tool_call```。
import { ChatOpenAI } from '@langchain/openai'

import type { RuntimeConfig } from '../../config/runtime-config.js'
import { getConfig } from '../../config/runtime-config.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[graph.llm_adapter] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[graph.llm_adapter] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[graph.llm_adapter] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[graph.llm_adapter] ${msg}`, ...args),
}

// Provider → 环境变量映射表
const _PROVIDER_CONFIG: Record<string, Record<string, string>> = {
  glm: {
    api_key: 'MODU_GLM_API_KEY',
    base_url: 'MODU_GLM_BASE_URL',
    model: 'MODU_GLM_MODEL',
    default_base_url: 'https://open.bigmodel.cn/api/paas/v4',
    default_model: 'glm-4-flash',
  },
  deepseek: {
    api_key: 'MODU_DEEPSEEK_API_KEY',
    base_url: 'MODU_DEEPSEEK_BASE_URL',
    model: 'MODU_DEEPSEEK_MODEL',
    default_base_url: 'https://api.deepseek.com',
    default_model: 'deepseek-v4-flash',
  },
  gpt: {
    api_key: 'OPENAI_API_KEY',
    base_url: 'OPENAI_BASE_URL',
    model: 'OPENAI_MODEL',
    default_base_url: 'https://api.openai.com/v1',
    default_model: 'gpt-4o-mini',
  },
  qwen: {
    api_key: 'MODU_QWEN_API_KEY',
    base_url: 'MODU_QWEN_BASE_URL',
    model: 'MODU_QWEN_MODEL',
    default_base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    default_model: 'qwen-plus',
  },
}

/**
 * 构建 LangChain ChatOpenAI 实例，复用现有环境变量约定。
 *
 * @param provider LLM 提供商（glm/deepseek/gpt/qwen），null=从配置读取
 * @param config 运行时配置（默认使用全局单例）
 * @param temperature 温度参数覆盖
 * @param maxTokens 最大 token 覆盖
 * @param model 模型名覆盖（如 "deepseek-chat"），null=从环境变量读取
 * @returns ChatOpenAI 实例（streaming=true，支持原生 function calling）
 */
export function build_chat_model(
  provider?: string | null,
  config?: RuntimeConfig | null,
  temperature?: number | null,
  maxTokens?: number | null,
  model?: string | null,
): ChatOpenAI {
  if (!config) {
    config = getConfig()
  }

  provider = (provider || config.get('llm.default_provider', 'glm') || 'glm') as string
  let pcfg = _PROVIDER_CONFIG[provider]

  if (!pcfg) {
    logger.warning("Unknown provider '%s', falling back to glm", provider)
    pcfg = _PROVIDER_CONFIG.glm
    provider = 'glm'
  }

  // 解析 API key（优先 provider 专属变量，其次通用 LLM_API_KEY）
  const apiKey = process.env[pcfg.api_key] || process.env.LLM_API_KEY || ''
  if (!apiKey) {
    logger.warning("API key not set for provider '%s' (env: %s)", provider, pcfg.api_key)
  }

  // 解析 base_url
  const baseUrl =
    process.env[pcfg.base_url] ||
    process.env.LLM_BASE_URL ||
    pcfg.default_base_url

  // 解析 model（参数覆盖 > 环境变量 > 默认值）
  const effectiveModel =
    model != null
      ? model
      : process.env[pcfg.model] ||
        process.env.LLM_DEFAULT_MODEL ||
        pcfg.default_model

  // 解析温度和 max_tokens（参数覆盖 > 配置 > 默认值）
  const effectiveTemp =
    temperature != null ? temperature : config.get('llm.temperature', 0.7)
  const effectiveMaxTokens =
    maxTokens != null ? maxTokens : config.get('llm.max_tokens', 512)

  logger.info(
    'Building ChatOpenAI: provider=%s model=%s base_url=%s temp=%.2f max_tokens=%d',
    provider, effectiveModel, baseUrl, effectiveTemp, effectiveMaxTokens,
  )

  return new ChatOpenAI({
    apiKey,
    configuration: { baseURL: baseUrl },
    model: effectiveModel,
    temperature: effectiveTemp,
    maxTokens: effectiveMaxTokens,
    streaming: true, // 原生支持流式，替代手写 stream()
  })
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
