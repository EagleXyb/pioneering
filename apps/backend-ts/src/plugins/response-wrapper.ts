// 统一响应包装中间件 —— 对应 Python app/main.py 的 response_wrapper
// 对所有非 SSE 响应包装为 { code, data, message } 格式
import fp from 'fastify-plugin'
import { randomUUID } from 'crypto'

const SKIP_PATHS = new Set(['/docs', '/redoc', '/openapi.json', '/docs/', '/redoc/', '/chat/completions'])

function safeJsonParse(str: string): unknown {
  try {
    return JSON.parse(str)
  } catch {
    return null
  }
}

export const responseWrapperPlugin = fp(async (fastify) => {
  fastify.addHook('onSend', async (req, reply, payload) => {
    // 跳过文档路由（对齐 Python skip_paths）
    const urlPath = req.url.split('?')[0]
    if (SKIP_PATHS.has(urlPath) || urlPath.startsWith('/docs/') || urlPath.startsWith('/redoc/')) {
      return payload
    }

    // 跳过 SSE 流式响应（对齐 Python: "text/event-stream" in content_type）
    // 跳过 HTML（对齐 Python: "text/html" in content_type）
    const contentType = (reply.getHeader('content-type') as string) ?? ''
    if (contentType.includes('text/event-stream') || contentType.includes('text/html')) {
      return payload
    }

    // 跳过 204 无内容
    if (reply.statusCode === 204) {
      return payload
    }

    // 仅对字符串 payload 处理（JSON 响应）
    if (typeof payload !== 'string') {
      return payload
    }

    // 跳过已包装的响应（避免双重包装）
    // P2-6 修复：error-handler 已发送 { code, message, details, requestId }，
    // 但缺少 data 字段，导致此处 dedup 检查未命中，错误响应被二次重包，
    // 原始 requestId 被覆盖、details 被塌缩为 message。
    // 修复：同时识别成功响应（code + data）和错误响应（code + requestId）
    const parsed = safeJsonParse(payload)
    if (parsed && typeof parsed === 'object' && 'code' in (parsed as object) && ('data' in (parsed as object) || 'requestId' in (parsed as object))) {
      return payload
    }

    // 构建包装内容（对齐 Python: { code, data, message }）
    const statusCode = reply.statusCode

    if (statusCode < 400) {
      // 成功响应
      const wrapped = {
        code: statusCode,
        data: parsed,
        message: 'success',
      }
      return JSON.stringify(wrapped)
    } else {
      // 错误响应（对齐 Python: error_msg 提取）
      let errorMsg = 'error'
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>
        errorMsg = (obj.detail as string) || (obj.message as string) || JSON.stringify(parsed)
      } else if (typeof parsed === 'string') {
        errorMsg = parsed
      }

      const wrapped = {
        code: statusCode,
        message: errorMsg,
        details: errorMsg,
        requestId: randomUUID(),
      }
      return JSON.stringify(wrapped)
    }
  })
})
