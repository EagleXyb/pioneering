// System 路由 —— 对应 Python app/api/v1/system.py
import { FastifyPluginAsync } from 'fastify'

// 注意：不要为响应声明 `response` schema，否则 Fastify 的 fast-json-stringify
// 在未指定 properties 时会把对象序列化为 {}（导致 version / models 等字段丢失）
const SCHEMA_MODELS = { tags: ['system'], summary: '获取支持的模型列表', security: [] }
const SCHEMA_CONFIG = { tags: ['system'], summary: '获取系统配置', security: [] }
const SCHEMA_HEALTH = { tags: ['system'], summary: '健康检查', security: [] }

// 对应 Python: SUPPORTED_MODELS
const SUPPORTED_MODELS = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek 快速模型',
    max_tokens: 128000,
    pricing: { input_price: 0.14, output_price: 0.28 },
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek 专业模型',
    max_tokens: 128000,
    pricing: { input_price: 0.28, output_price: 0.56 },
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量级多模态模型，适用于日常对话和代码生成',
    max_tokens: 128000,
    pricing: { input_price: 0.15, output_price: 0.6 },
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: '高性能多模态模型，适用于复杂任务',
    max_tokens: 128000,
    pricing: { input_price: 2.5, output_price: 10 },
  },
]

export const systemRoutes: FastifyPluginAsync = async (fastify) => {
  // 对应 Python: @router.get("/system/models")
  fastify.get('/system/models', { schema: SCHEMA_MODELS }, async () => {
    return SUPPORTED_MODELS
  })

  // 对应 Python: @router.get("/system/config")
  fastify.get('/system/config', { schema: SCHEMA_CONFIG }, async () => {
    return {
      max_message_length: 10000,
      max_session_count: 100,
      supported_models: SUPPORTED_MODELS,
      file_upload: {
        max_size: 10485760,
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
