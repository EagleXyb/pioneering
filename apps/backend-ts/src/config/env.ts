// 环境变量校验 —— 对应 Python app/config.py
// 使用 Zod 校验 + 解析 process.env，提供类型安全的 env 对象
import { z } from 'zod'
import dotenv from 'dotenv'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_MODEL, REASONING_MODEL } from './models.js'

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
  // P5：密钥来源（env 默认；file 用于容器 Secret 挂载）
  SECRET_PROVIDER: z.enum(['env', 'file']).default('env'),
  LLM_SECRET_FILE: z.string().default(''),
  // P0：默认模型与推理模型收敛到 config/models.ts，避免与目录/前端三处漂移
  LLM_DEFAULT_MODEL: z.string().default(DEFAULT_MODEL),
  LLM_REASONING_MODEL: z.string().default(REASONING_MODEL),
  // P0：流式空闲超时（毫秒）。流式不再设总时长上限，只在无数据超过该值时中止。
  LLM_STREAM_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  // P4：分层限流（每分钟请求数；0 表示不限制）
  RATE_LIMIT_USER_RPM: z.coerce.number().int().nonnegative().default(60),
  RATE_LIMIT_MODEL_RPM: z.coerce.number().int().nonnegative().default(120),

  HOST: z.string().default('0.0.0.0'),
  // 默认 8088：避开 Chromium 不安全端口黑名单（6000 是 X11 端口，会被 net::ERR_UNSAFE_PORT 拦截）
  PORT: z.coerce.number().int().default(8088),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:3000,file://'),

  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_SIZE: z.coerce.number().int().default(10 * 1024 * 1024),

  LOG_DIR: z.string().default('./logs'),

  // L3：技能管理面
  // 管理员用户 id（逗号分隔）。为空时管理写接口一律 403（fail-closed），
  // 避免「默认谁都能改技能白名单」。
  ADMIN_USER_IDS: z.string().default(''),
  // 技能启用状态持久化文件（文件系统实现，免 DB 迁移）
  SKILLS_STATE_PATH: z.string().default('./data/skills.state.json'),

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
