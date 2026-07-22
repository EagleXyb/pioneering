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
  // 默认 8088：避开 Chromium 不安全端口黑名单（6000 是 X11 端口，会被 net::ERR_UNSAFE_PORT 拦截）
  PORT: z.coerce.number().int().default(8088),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:3000,file://'),

  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_SIZE: z.coerce.number().int().default(10 * 1024 * 1024),

  LOG_DIR: z.string().default('./logs'),
})

export const env = EnvSchema.parse(process.env)

// P1-2 修复：JWT_SECRET 弱默认值守卫
// 生产环境使用默认密钥时发出警告（不拒绝启动，避免破坏开发流程）
const _WEAK_JWT_SECRETS = new Set(['default-secret-change-in-production', ''])
if (_WEAK_JWT_SECRETS.has(env.JWT_SECRET)) {
  console.warn(
    '[config] WARNING: JWT_SECRET is using a default/empty value. '
    + 'Set a strong secret via environment variable in production.',
  )
}

export type Env = typeof env
