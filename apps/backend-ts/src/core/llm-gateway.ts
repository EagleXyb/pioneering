// 后端侧网关装配（P1）
//
// 本文件是"宿主装配"：把 config/models.ts 的目录、.env 的连接参数
// 注入到共享的 @pioneering/llm-gateway，业务代码只依赖导出的单例。
// P2 起，modu-agent 也会改为消费同一个网关实例（注入 provider factory）。
import { createLLMGateway } from '@pioneering/llm-gateway'
import { env } from '../config/env.js'
import { AVAILABLE_MODELS, MODEL_ALIASES } from '../config/models.js'
import { resolveLlmSecrets } from './secrets.js'

const llmSecrets = resolveLlmSecrets({
  provider: env.SECRET_PROVIDER,
  filePath: env.LLM_SECRET_FILE,
  envFallback: { apiKey: env.LLM_API_KEY, baseUrl: env.LLM_BASE_URL },
})
console.info(`[llm-gateway] secrets source=${llmSecrets.source}`)

export const llmGateway = createLLMGateway({
  models: AVAILABLE_MODELS.map((m) => ({
    alias: m.alias,
    model_id: m.id,
    provider: m.provider,
    display_name: m.name,
    description: m.description,
    capabilities: m.capabilities,
    context_window: m.max_tokens,
    pricing: m.pricing,
    status: m.status,
  })),
  aliases: MODEL_ALIASES,
  defaultAlias: 'fast',
  // 单宿主阶段：连接参数来自统一 LLM_* 环境变量。
  // 后续云边双模会在这里换成 SecretProvider / 密钥服务。
  resolveProvider: () => ({
    apiKey: llmSecrets.apiKey,
    baseUrl: llmSecrets.baseUrl,
  }),
  policy: {
    idleTimeoutMs: env.LLM_STREAM_IDLE_TIMEOUT_MS,
    requestTimeoutMs: 120_000,
    maxAttempts: 2,
  },
})
