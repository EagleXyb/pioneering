// Schema 辅助函数 —— 将 Zod schema 转为 Fastify JSON Schema（用于 OpenAPI 文档生成）
// 运行时校验仍由 Schema.parse() 执行（Zod），Fastify schema 仅做文档展示
// attachValidation: true 确保 Fastify 不自动拒绝验证失败的请求
import { ZodType } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

export function buildSchema(parts: {
  body?: ZodType
  querystring?: ZodType
  params?: ZodType
  /** 200 响应 schema，用于 OpenAPI 文档生成。若不传，默认使用 { type: 'object' } */
  response?: ZodType
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

  if (parts.body) schema.body = inlineZodRef(zodToJsonSchema(parts.body, 'body'))
  if (parts.querystring) schema.querystring = inlineZodRef(zodToJsonSchema(parts.querystring, 'querystring'))
  if (parts.params) schema.params = inlineZodRef(zodToJsonSchema(parts.params, 'params'))
  if (parts.tags) schema.tags = parts.tags
  if (parts.summary) schema.summary = parts.summary
  if (parts.description) schema.description = parts.description
  if (parts.security) schema.security = parts.security
  if (parts.hide) schema.hide = parts.hide

  // @fastify/swagger 在无 response 时尝试从 handler 返回值推断类型，
  // reply.hijack() 路由会返回 undefined 导致 OpenAPI JSON 生成报错。
  // 此处兜底注入最低响应 schema 避免崩溃。
  if (parts.response) {
    schema.response = { '200': inlineZodRef(zodToJsonSchema(parts.response, 'response')) }
  } else {
    schema.response = { '2xx': { type: 'object', description: '默认响应' } }
  }

  return { schema, attachValidation: true }
}

/**
 * zod-to-json-schema 默认生成 $ref 格式（嵌套在 definitions 中），
 * 但 @fastify/swagger 不支持 $ref 顶级引用，需内联展开为纯 JSON Schema。
 */
function inlineZodRef(input: Record<string, unknown>): Record<string, unknown> {
  // 若顶层是 $ref，从 definitions 中取出定义体内联
  if (input.$ref && typeof input.$ref === 'string') {
    const refPath = input.$ref as string  // e.g. "#/definitions/body"
    const defKey = refPath.replace('#/definitions/', '')
    const definitions = input.definitions as Record<string, unknown> | undefined
    if (definitions && definitions[defKey]) {
      return { ...definitions[defKey] as Record<string, unknown>, $schema: undefined }
    }
  }
  // 非 $ref 格式直接返回，去掉 $schema 字段（Fastify 不识别）
  const { $schema, ...rest } = input as { $schema?: string }
  void $schema
  return rest
}
