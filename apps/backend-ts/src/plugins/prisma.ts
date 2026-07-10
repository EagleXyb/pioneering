// Prisma Client 装饰器插件 —— 对应 Python app/database.py 的 get_db
import fp from 'fastify-plugin'
import { PrismaClient } from '@prisma/client'
import { env } from '../config/env.js'

export const prismaPlugin = fp(async (fastify) => {
  const prisma = new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log: ['warn', 'error'],
  })

  await prisma.$connect()
  fastify.log.info('数据库连接成功 (Prisma)')

  fastify.decorate('prisma', prisma)

  fastify.addHook('onClose', async (server) => {
    await server.prisma.$disconnect()
  })
})
