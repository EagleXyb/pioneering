// 环境变量校验 —— 对应 Python app/config.py
// 使用 Zod 校验 + 解析 process.env，提供类型安全的 env 对象
import { z } from 'zod'
import dotenv from 'dotenv'

dotenv.config()

const EnvSchema = z.object({
  DATABASE_URL: z.string().default('postgresql://postgres:root@localhost:5432/pioneering'),

  JWT_SECRET: z.string().default('default-secret-change-in-production'),
  JWT_EXPIRATION_HOURS: z.coerce.number().int().default(2),
  REFRESH_TOKEN_EXPIRATION_DAYS: z.coerce.number().int().default(30),

  LLM_API_KEY: z.string().default(''),
  LLM_BASE_URL: z.string().default('https://api.deepseek.com/v1'),
  LLM_DEFAULT_MODEL: z.string().default('deepseek-chat'),

  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(6000),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:3000'),

  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_SIZE: z.coerce.number().int().default(10 * 1024 * 1024),

  LOG_DIR: z.string().default('./logs'),
})

export const env = EnvSchema.parse(process.env)

export type Env = typeof env
