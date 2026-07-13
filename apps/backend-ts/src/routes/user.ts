// User 路由 —— 对应 Python app/api/v1/user.py
import { FastifyPluginAsync } from 'fastify'
import { authGuard } from '../plugins/auth.js'
import { UpdateProfileRequestSchema, UsageQuerySchema } from '../schemas/user.js'
import { buildSchema } from '../utils/zod-schema.js'
import { z } from 'zod'

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  // 受保护路由（需认证）
  fastify.register(async (app) => {
    app.addHook('preHandler', authGuard)

    // 对应 Python: @router.get("/list")
    app.get('/list', buildSchema({
      querystring: z.object({
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
        search: z.string().optional(),
      }),
      tags: ['user'],
      summary: '用户列表（分页+搜索）',
      security: [],
    }), async (req) => {
      const queryParams = req.query as { page?: string; pageSize?: string; search?: string }
      const page = Math.max(1, parseInt(queryParams.page as string) || 1)
      const pageSize = Math.min(100, Math.max(1, parseInt(queryParams.pageSize as string) || 20))
      const search = queryParams.search

      // 对应 Python: User.username.ilike(...) | User.nickname.ilike(...) | User.email.ilike(...)
      const where = search
        ? {
            OR: [
              { username: { contains: search, mode: 'insensitive' as const } },
              { nickname: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : undefined

      // 对应 Python: select(func.count()).select_from(User).where(*where)
      const total = await fastify.prisma.user.count({ where })

      // 对应 Python: select(User).where(*where).order_by(User.created_at.desc()).offset(...).limit(...)
      const users = await fastify.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })

      // 对应 Python: 循环查询每个用户的 UserQuota
      const list = await Promise.all(
        users.map(async (u) => {
          const quota = await fastify.prisma.userQuota.findUnique({
            where: { userId: u.id },
          })
          return {
            id: u.id,
            username: u.username,
            nickname: u.nickname,
            email: u.email,
            phone: u.phone,
            avatar: u.avatar,
            status: u.status,
            totalTokens: quota ? Number(quota.totalTokens) : 0,
            usedTokens: quota ? Number(quota.usedTokens) : 0,
            dailyLimit: quota ? Number(quota.dailyLimit) : 0,
            dailyUsed: quota ? Number(quota.dailyUsed) : 0,
            createdAt: u.createdAt,
            updatedAt: u.updatedAt,
          }
        }),
      )

      return { list, total, page, pageSize }
    })
  }, { prefix: '/user' })

  // 受保护路由（需认证）—— 对应 Python 中有 Depends(get_current_user) 的路由
  fastify.register(async (app) => {
    // 对应 Python: @router.get("/profile", response_model=UserProfile)
    app.get('/profile', {
      preHandler: authGuard,
      ...buildSchema({ tags: ['user'], summary: '获取当前用户信息', security: [{ BearerAuth: [] }] }),
    }, async (req) => {
      const u = req.user
      return {
        id: u.id,
        username: u.username,
        nickname: u.nickname,
        avatar: u.avatar,
        email: u.email,
        phone: u.phone,
        status: u.status,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      }
    })

    // 对应 Python: @router.put("/profile", response_model=UserProfile)
    app.put('/profile', {
      preHandler: authGuard,
      ...buildSchema({ body: UpdateProfileRequestSchema, tags: ['user'], summary: '更新当前用户信息', security: [{ BearerAuth: [] }] }),
    }, async (req) => {
      const dto = UpdateProfileRequestSchema.parse(req.body)

      // 对应 Python: if dto.nickname is not None / if dto.avatar is not None
      const data: { nickname?: string; avatar?: string } = {}
      if (dto.nickname != null) data.nickname = dto.nickname
      if (dto.avatar != null) data.avatar = dto.avatar

      // 对应 Python: await db.flush(); await db.refresh(current_user)
      const updated = await fastify.prisma.user.update({
        where: { id: req.user.id },
        data,
      })

      return {
        id: updated.id,
        username: updated.username,
        nickname: updated.nickname,
        avatar: updated.avatar,
        email: updated.email,
        phone: updated.phone,
        status: updated.status,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      }
    })

    // 对应 Python: @router.get("/quota")
    app.get('/quota', {
      preHandler: authGuard,
      ...buildSchema({ tags: ['user'], summary: '获取当前用户配额', security: [{ BearerAuth: [] }] }),
    }, async (req) => {
      const quota = await fastify.prisma.userQuota.findUnique({
        where: { userId: req.user.id },
      })

      // 对应 Python: if not quota → 返回默认配额
      if (!quota) {
        return {
          totalTokens: 1_000_000,
          usedTokens: 0,
          dailyLimit: 100_000,
          dailyUsed: 0,
        }
      }

      // 对应 Python: QuotaInfo(total_tokens=quota.total_tokens or 0, ...)
      return {
        totalTokens: Number(quota.totalTokens) || 0,
        usedTokens: Number(quota.usedTokens) || 0,
        dailyLimit: Number(quota.dailyLimit) || 0,
        dailyUsed: Number(quota.dailyUsed) || 0,
        resetAt: quota.resetAt,
      }
    })

    // 对应 Python: @router.get("/quota/usage")
    app.get('/quota/usage', {
      preHandler: authGuard,
      ...buildSchema({
        querystring: UsageQuerySchema,
        tags: ['user'],
        summary: '获取当前用户 Token 用量',
        security: [{ BearerAuth: [] }],
      }),
    }, async (req) => {
      const queryParams = req.query as {
        startDate?: string
        endDate?: string
        page?: string
        pageSize?: string
      }
      const query = UsageQuerySchema.parse({
        startDate: queryParams.startDate,
        endDate: queryParams.endDate,
        page: queryParams.page !== undefined ? Number(queryParams.page) : undefined,
        pageSize: queryParams.pageSize !== undefined ? Number(queryParams.pageSize) : undefined,
      })

      // 对应 Python: where = [TokenUsage.user_id == current_user.id]
      const where = { userId: req.user.id }

      // 对应 Python: select(TokenUsage).where(...).order_by(created_at.desc()).offset(...).limit(...)
      //             select(func.count()).select_from(TokenUsage).where(...)
      const [usages, total] = await Promise.all([
        fastify.prisma.tokenUsage.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        fastify.prisma.tokenUsage.count({ where }),
      ])

      return {
        list: usages.map((u) => ({
          id: Number(u.id),
          model: u.model,
          promptTokens: u.promptTokens,
          completionTokens: u.completionTokens,
          totalTokens: u.totalTokens,
          cost: u.cost ? Number(u.cost) : null,
          createdAt: u.createdAt.toISOString(),
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      }
    })
  }, { prefix: '/user' })
}
