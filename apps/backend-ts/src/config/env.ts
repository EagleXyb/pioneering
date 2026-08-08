// 环境变量校验 —— 对应 Python app/config.py
// 使用 Zod 校验 + 解析 process.env，提供类型安全的 env 对象
import { z } from 'zod'
import dotenv from 'dotenv'
import os from 'node:os'
import path from 'node:path'

dotenv.config()

// 文档生成产物的默认根目录。
// 优先读 MODU_DOC_WRITER_ROOT（由 desktop 主进程在打包态注入为 userData/Documents），
// 否则 fallback 到跨平台稳定的 ~/.pioneering/documents（开发态即生效，且不受系统临时清理影响）。
// 不放在 os.tmpdir()，因为临时目录会被系统定期清理，导致用户文档丢失。
const _defaultDocRoot = path.join(os.homedir(), '.pioneering', 'documents')

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

  DOC_WRITER_ROOT: z
    .string()
    .default(_defaultDocRoot)
    .describe('文档生成产物根目录，可由 MODU_DOC_WRITER_ROOT 覆盖'),
})

export const env = EnvSchema.parse(process.env)

// 将解析后的文档根同步回 MODU_DOC_WRITER_ROOT，使 modu-agent 包内的 DocWriterTool
// （通过 process.env.MODU_DOC_WRITER_ROOT 读取）能命中同一路径。
// 这样无论是开发态手动启动还是打包态由 desktop 注入，文档落盘位置都一致。
process.env['MODU_DOC_WRITER_ROOT'] = env.DOC_WRITER_ROOT

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
