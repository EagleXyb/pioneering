// Auth 路由 —— 对应 Python app/api/v1/auth.py
import { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'crypto'
import { authGuard } from '../plugins/auth.js'
import { hashPassword, verifyPassword, createAccessToken } from '../core/security.js'
import { genId } from '../utils/id.js'
import {
  ConflictError,
  UnauthorizedError,
  BadRequestError,
} from '../plugins/error-handler.js'
import { env } from '../config/env.js'
import {
  RegisterRequestSchema,
  LoginRequestSchema,
  RefreshTokenRequestSchema,
  UpdateProfileRequestSchema,
} from '../schemas/user.js'
import { buildSchema } from '../utils/zod-schema.js'
import { z } from 'zod'

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // 对应 Python: _generate_refresh_token
  function generateRefreshToken(): string {
    return `rt_${randomUUID().replace(/-/g, '')}`
  }

  // 对应 Python: _create_refresh_token
  async function createRefreshToken(userId: string): Promise<string> {
    const tokenStr = generateRefreshToken()
    const expiresAt = new Date(
      Date.now() + env.REFRESH_TOKEN_EXPIRATION_DAYS * 24 * 60 * 60 * 1000,
    )
    await fastify.prisma.refreshToken.create({
      data: {
        id: genId('rt_'),
        userId,
        token: tokenStr,
        expiresAt,
      },
    })
    return tokenStr
  }

  // 对应 Python: _generate_auth_response
  async function generateAuthResponse(user: {
    id: string
    username: string
    nickname: string | null
    avatar: string | null
    email: string | null
    phone: string | null
  }) {
    const accessToken = createAccessToken(user.id, { username: user.username })
    const refreshToken = await createRefreshToken(user.id)
    return {
      token: accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        avatar: user.avatar,
        email: user.email,
        phone: user.phone,
      },
    }
  }

  fastify.register(
    async (app) => {
      // 对应 Python: @router.post("/register")
      app.post('/register', buildSchema({
        body: RegisterRequestSchema,
        tags: ['auth'],
        summary: '用户注册',
        security: [],
      }), async (req) => {
        const dto = RegisterRequestSchema.parse(req.body)

        // 检查用户名是否已存在
        const existingByUsername = await fastify.prisma.user.findFirst({
          where: { username: dto.username },
        })
        if (existingByUsername) {
          throw new ConflictError('用户名已被注册')
        }

        // 检查邮箱是否已存在
        if (dto.email) {
          const existingByEmail = await fastify.prisma.user.findFirst({
            where: { email: dto.email },
          })
          if (existingByEmail) {
            throw new ConflictError('邮箱已被注册')
          }
        }

        const user = await fastify.prisma.user.create({
          data: {
            id: genId('user_'),
            username: dto.username,
            email: dto.email,
            passwordHash: hashPassword(dto.password),
            nickname: dto.username,
            status: 1,
          },
        })
        return generateAuthResponse(user)
      })

      // 对应 Python: @router.post("/login")
      app.post('/login', buildSchema({
        body: LoginRequestSchema,
        tags: ['auth'],
        summary: '用户登录',
        security: [],
      }), async (req) => {
        const dto = LoginRequestSchema.parse(req.body)

        const user = await fastify.prisma.user.findFirst({
          where: { username: dto.username },
        })
        if (!user) {
          throw new UnauthorizedError('用户名或密码错误')
        }
        if (!user.passwordHash) {
          throw new UnauthorizedError('该账号未设置密码，请使用微信登录')
        }

        if (!verifyPassword(dto.password, user.passwordHash)) {
          throw new UnauthorizedError('用户名或密码错误')
        }

        return generateAuthResponse(user)
      })

      // 对应 Python: @router.post("/wechat/miniprogram")
      app.post('/wechat/miniprogram', buildSchema({
        querystring: z.object({ code: z.string() }),
        tags: ['auth'],
        summary: '微信小程序登录',
        security: [],
      }), async (req) => {
        const { code } = req.query as { code?: string }
        if (!code) {
          throw new BadRequestError('code 不能为空')
        }

        const mockOpenid = `wx_mp_${code.slice(0, 16)}`
        let user = await fastify.prisma.user.findFirst({
          where: { username: mockOpenid },
        })

        if (user) {
          user = await fastify.prisma.user.update({
            where: { id: user.id },
            data: { wechatOpenid: mockOpenid },
          })
        } else {
          user = await fastify.prisma.user.create({
            data: {
              id: genId('user_'),
              username: mockOpenid,
              wechatOpenid: mockOpenid,
              nickname: '微信用户',
            },
          })
        }

        return generateAuthResponse(user)
      })

      // 对应 Python: @router.post("/wechat/web")
      app.post('/wechat/web', buildSchema({
        querystring: z.object({ code: z.string() }),
        tags: ['auth'],
        summary: '微信网页登录',
        security: [],
      }), async (req) => {
        const { code } = req.query as { code?: string }
        if (!code) {
          throw new BadRequestError('code 不能为空')
        }

        const mockOpenid = `wx_web_${code.slice(0, 16)}`
        let user = await fastify.prisma.user.findFirst({
          where: { username: mockOpenid },
        })

        if (user) {
          user = await fastify.prisma.user.update({
            where: { id: user.id },
            data: { wechatUnionid: mockOpenid },
          })
        } else {
          user = await fastify.prisma.user.create({
            data: {
              id: genId('user_'),
              username: mockOpenid,
              wechatUnionid: mockOpenid,
              nickname: '微信用户',
            },
          })
        }

        return generateAuthResponse(user)
      })

      // 对应 Python: @router.post("/refresh")
      app.post('/refresh', buildSchema({
        body: RefreshTokenRequestSchema,
        tags: ['auth'],
        summary: '刷新令牌',
        security: [],
      }), async (req) => {
        const dto = RefreshTokenRequestSchema.parse(req.body)

        const rt = await fastify.prisma.refreshToken.findFirst({
          where: {
            token: dto.refresh_token,
            revoked: false,
            expiresAt: { gt: new Date() },
          },
        })
        if (!rt) {
          throw new UnauthorizedError('刷新令牌无效或已过期')
        }

        await fastify.prisma.refreshToken.update({
          where: { id: rt.id },
          data: { revoked: true },
        })

        const user = await fastify.prisma.user.findUnique({
          where: { id: rt.userId },
        })
        if (!user) {
          throw new UnauthorizedError('用户不存在')
        }

        return generateAuthResponse(user)
      })

    },
    { prefix: '/auth' },
  )
}
