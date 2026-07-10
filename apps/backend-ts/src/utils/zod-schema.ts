// Schema 辅助函数 —— 将 Zod schema 转为 Fastify JSON Schema（用于 OpenAPI 文档生成）
// 运行时校验仍由 Schema.parse() 执行（Zod），Fastify schema 仅做文档展示
// attachValidation: true 确保 Fastify 不自动拒绝验证失败的请求
import { ZodType } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

export function buildSchema(parts: {
  body?: ZodType
  querystring?: ZodType
  params?: ZodType
  tags?: string[]
  summary?: string
  description?: string
  security?: unknown[]
  hide?: boolean
}): {
  schema: Record<string, unknown>
  attachValidation: true
} {
  const schema: Record<string, unknown> = {}

  if (parts.body) schema.body = zodToJsonSchema(parts.body, 'body')
  if (parts.querystring) schema.querystring = zodToJsonSchema(parts.querystring, 'querystring')
  if (parts.params) schema.params = zodToJsonSchema(parts.params, 'params')
  if (parts.tags) schema.tags = parts.tags
  if (parts.summary) schema.summary = parts.summary
  if (parts.description) schema.description = parts.description
  if (parts.security) schema.security = parts.security
  if (parts.hide) schema.hide = parts.hide

  return { schema, attachValidation: true }
}
