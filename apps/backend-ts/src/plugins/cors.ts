// CORS 插件 —— 对应 Python app/main.py 的 CORSMiddleware
import cors from '@fastify/cors'
import fp from 'fastify-plugin'
import { env } from '../config/env.js'

export const corsPlugin = fp(async (fastify) => {
  await fastify.register(cors, {
    // 对齐 Python: allow_origins=settings.cors_origins.split(",")
    origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
  })
})
