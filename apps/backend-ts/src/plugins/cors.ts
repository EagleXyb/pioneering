// CORS 插件 —— 对应 Python app/main.py 的 CORSMiddleware
import cors from '@fastify/cors'
import fp from 'fastify-plugin'
import { env } from '../config/env.js'

// 显式配置的源（来自 CORS_ORIGINS），作为白名单基线
const configuredOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)

// 本地回环主机正则：覆盖 5173/5174/5175/3000 等 Vite/dev 端口，
// 避免每次新增 dev server 都要改 .env。
// 同时允许 Electron 生产环境的 file:// 源与无 Origin 头的同源/curl 请求。
const LOCAL_ORIGIN_PATTERN =
  /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i

// AsyncOriginFunction：返回 true 放行该源，false 拒绝。
// 兼容 dev (http://localhost:5174) / prod (file://) / 显式白名单 / 无 Origin 头场景。
async function originValidator(origin: string | undefined): Promise<boolean> {
  // 无 Origin 头：同源请求、Electron file:// 部分场景、curl 等 → 放行
  if (!origin) return true
  // Electron 生产环境 file:// 源
  if (origin === 'file://') return true
  // 本地回环（任意端口）→ 放行，覆盖所有 dev server
  if (LOCAL_ORIGIN_PATTERN.test(origin)) return true
  // 显式白名单
  if (configuredOrigins.includes(origin)) return true
  // 其余拒绝
  return false
}

export const corsPlugin = fp(async (fastify) => {
  await fastify.register(cors, {
    // 函数式 origin：兼容 dev (http://localhost:5174) / prod (file://) / 显式白名单
    origin: originValidator,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
  })
})
