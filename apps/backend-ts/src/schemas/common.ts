// 通用 Zod schema —— 统一响应格式
import { z } from 'zod'

// 统一响应包装（对齐 Python main.py 的 { code, data, message }）
export const ApiResponseSchema = z.object({
  code: z.number(),
  data: z.unknown().nullable(),
  message: z.string().optional(),
})

// 错误响应（对齐 Python schemas/agent.py 的 ErrorResponse）
export const ErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  details: z.string().optional(),
  requestId: z.string().optional(),
})

export type ErrorData = z.infer<typeof ErrorSchema>
