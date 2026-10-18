// System 路由 —— 对应 Python app/api/v1/system.py
import { FastifyPluginAsync } from 'fastify'
import { env } from '../config/env.js'
import { AVAILABLE_MODELS } from '../config/models.js'
import { llmGateway } from '../core/llm-gateway.js'

// 注意：不要为响应声明 `response` schema，否则 Fastify 的 fast-json-stringify
// 在未指定 properties 时会把对象序列化为 {}（导致 version / models 等字段丢失）
const SCHEMA_MODELS = { tags: ['system'], summary: '获取支持的模型列表', security: [] }
const SCHEMA_CAPABILITIES = { tags: ['system'], summary: '获取模型能力清单', security: [] }
const SCHEMA_CONFIG = { tags: ['system'], summary: '获取系统配置', security: [] }
const SCHEMA_HEALTH = { tags: ['system'], summary: '健康检查', security: [] }

// P0：模型目录收敛到 config/models.ts（单一事实源）。
// P4：对外字段 max_tokens 更名为 context_window（与请求体 max_tokens 的补全上限语义解耦）。
const SUPPORTED_MODELS = AVAILABLE_MODELS.map((m) => ({
  id: m.id,
  name: m.name,
  description: m.description,
  context_window: m.max_tokens,
  pricing: m.pricing,
  alias: m.alias,
  provider: m.provider,
  capabilities: m.capabilities,
  status: m.status,
}))

export const systemRoutes: FastifyPluginAsync = async (fastify) => {
  // 对应 Python: @router.get("/system/models")
  fastify.get('/system/models', { schema: SCHEMA_MODELS }, async () => {
    return SUPPORTED_MODELS
  })

  // P1：能力清单（客户端据此渲染模型选择器与能力标签）
  // 与 /system/models 的区别：这里给的是接入层视角（alias / provider / capabilities / status），
  // 不含密钥与端点，也不会出现"可选但不可用"的条目。
  fastify.get('/capabilities', { schema: SCHEMA_CAPABILITIES }, async () => {
    return llmGateway.getCapabilities()
  })

  // 对应 Python: @router.get("/system/config")
  fastify.get('/system/config', { schema: SCHEMA_CONFIG }, async () => {
    return {
      max_message_length: 10000,
      max_session_count: 100,
      supported_models: SUPPORTED_MODELS,
      file_upload: {
        max_size: env.MAX_UPLOAD_SIZE,
        allowed_types: [
          'image/png',
          'image/jpeg',
          'image/gif',
          'image/webp',
          'application/pdf',
          'text/plain',
        ],
      },
    }
  })

  // 对应 Python: @router.get("/health")
  fastify.get('/health', { schema: SCHEMA_HEALTH }, async () => {
    return {
      status: 'healthy',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    }
  })
}
