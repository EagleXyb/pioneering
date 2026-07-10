// Fastify 类型扩展 —— 声明装饰器类型
import type { PrismaClient } from '@prisma/client'

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
  }

  interface FastifyRequest {
    user: {
      id: string
      username: string
      nickname: string | null
      avatar: string | null
      email: string | null
      phone: string | null
      status: number
      createdAt: Date
      updatedAt: Date
    }
  }
}
