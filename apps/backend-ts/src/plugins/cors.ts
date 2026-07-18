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

// 判断某个 Origin 是否被允许。抽成独立函数，供 CORS 插件与“手动 hijack 的
// SSE 流式响应”复用——否则流式响应绕过 onSend 钩子会缺失 CORS 头，被浏览器拦截。
// 兼容 dev (http://localhost:5174) / prod (file://，实际发送 "null") / 显式白名单 / 无 Origin 头场景。
export function isOriginAllowed(origin: string | undefined): boolean {
  // 无 Origin 头：同源请求、curl 等 → 放行
  if (!origin) return true
  // Electron 生产环境 file:// 源：浏览器对 file:// 页面发送的是字面量 "null"
  // 不透明源（而非字符串 "file://"），故必须放行 "null"，否则所有响应都会被
  // CORS 拦截，渲染端 fetch 直接抛 "TypeError: Failed to fetch"。
  if (origin === 'null' || origin === 'file://') return true
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
    origin: isOriginAllowed,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
  })
})
