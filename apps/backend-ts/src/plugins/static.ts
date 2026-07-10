// 静态文件插件 —— 对应 Python app/main.py 的 StaticFiles 挂载
import fastifyStatic from '@fastify/static'
import fp from 'fastify-plugin'
import path from 'path'
import { fileURLToPath } from 'url'
import { env } from '../config/env.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const staticPlugin = fp(async (fastify) => {
  await fastify.register(fastifyStatic, {
    root: path.resolve(env.UPLOAD_DIR),
    prefix: '/uploads/',
    decorateReply: false,
  })
})
