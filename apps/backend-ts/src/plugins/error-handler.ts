// 统一错误处理 —— 对应 Python app/main.py 的 HTTPException 处理逻辑
import fp from 'fastify-plugin'
import { randomUUID } from 'crypto'
import { ZodError } from 'zod'

// 自定义业务错误（带 statusCode）
export class HttpError extends Error {
  statusCode: number
  details?: string

  constructor(statusCode: number, message: string, details?: string) {
    super(message)
    this.statusCode = statusCode
    this.details = details
  }
}

// 对应 Python: HTTPException(status_code=409, detail="...")
export class ConflictError extends HttpError {
  constructor(message: string) {
    super(409, message)
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(404, message)
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message: string) {
    super(401, message)
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string) {
    super(400, message)
  }
}

export class BadGatewayError extends HttpError {
  constructor(message: string) {
    super(502, message)
  }
}

export class ForbiddenError extends HttpError {
  constructor(message: string) {
    super(403, message)
  }
}

// P0-5 修复：配额超限/限流错误（429）
export class TooManyRequestsError extends HttpError {
  constructor(message: string) {
    super(429, message)
  }
}

export const errorHandlerPlugin = fp(async (fastify) => {
  fastify.setErrorHandler((error: any, req, reply) => {
    // P2-2 修复：使用 Fastify 内部 req.id 作为 requestId，与请求日志保持一致
    const requestId = req.id ?? randomUUID()

    // Zod 校验错误 → 400
    if (error instanceof ZodError) {
      const details = error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
      return reply.code(400).send({
        code: 400,
        message: '请求参数校验失败',
        details,
        requestId,
      })
    }

    // 业务错误（带 statusCode）—— 对应 Python HTTPException
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({
        code: error.statusCode,
        message: error.message,
        details: error.details,
        requestId,
      })
    }

    // Fastify 内置校验错误（schema 验证失败）
    if ('validation' in error && error.validation) {
      return reply.code(400).send({
        code: 400,
        message: `请求参数校验失败: ${error.message}`,
        requestId,
      })
    }

    // JWT/认证错误
    if (error.statusCode === 401) {
      return reply.code(401).send({
        code: 401,
        message: error.message || '未认证或 Token 已过期',
        requestId,
      })
    }

    // 已知 statusCode 的错误
    if (error.statusCode && error.statusCode !== 500) {
      return reply.code(error.statusCode).send({
        code: error.statusCode,
        message: error.message,
        requestId,
      })
    }

    // 未知错误 → 500（对齐 Python: 未处理异常）
    req.log.error({ err: error, requestId }, '未处理异常')
    return reply.code(500).send({
      code: 500,
      message: '服务器内部错误',
      requestId,
    })
  })
})
