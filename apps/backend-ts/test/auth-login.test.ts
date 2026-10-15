/**
 * POST /auth/login 契约与前置校验回归（阶段 3 / P1）
 *
 * 使用真实路由 + 真实 errorHandler，仅以 decorate 注入 prisma 桩，验证：
 *   - 请求体契约收敛：缺失 / 空串 / 超长字段 → 400（此前 z.string() 无约束）
 *   - 用户不存在、密码错误 → 401「用户名或密码错误」（不泄露账号是否存在）
 *   - 账号被禁用（status !== 1）→ 401（此前该字段只写不读）
 *   - 未设置密码（passwordHash 为 null，微信建号）→ 401 引导其它登录方式
 *   - 成功路径返回 token / refreshToken / user
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import { authRoutes } from '../src/routes/auth.js'
import { errorHandlerPlugin } from '../src/plugins/error-handler.js'
import { hashPassword } from '../src/core/security.js'

const userFindFirst = vi.fn()
const refreshTokenCreate = vi.fn()

const fakePrisma = {
  user: { findFirst: userFindFirst, findUnique: vi.fn() },
  refreshToken: { create: refreshTokenCreate },
}

async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify()
  app.decorate('prisma', fakePrisma as never)
  await app.register(errorHandlerPlugin)
  await app.register(authRoutes)
  return app
}

/** 构造一条可登录的用户记录（status=1 已启用） */
function activeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user_test',
    username: 'design@nova-ai.com',
    nickname: 'design',
    avatar: null,
    email: 'design@nova-ai.com',
    phone: null,
    passwordHash: hashPassword('password123'),
    wechatOpenid: null,
    wechatUnionid: null,
    status: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

const VALID_PAYLOAD = { username: 'design@nova-ai.com', password: 'password123' }

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  refreshTokenCreate.mockResolvedValue({})
  app = await buildServer()
})

async function login(payload: unknown) {
  return app.inject({ method: 'POST', url: '/auth/login', payload: payload as never })
}

describe('POST /auth/login — 请求体契约', () => {
  it('缺少 username → 400', async () => {
    const res = await login({ password: 'password123' })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('请求参数校验失败')
  })

  it('缺少 password → 400', async () => {
    const res = await login({ username: 'design@nova-ai.com' })
    expect(res.statusCode).toBe(400)
  })

  it('空串 username / password → 400（不再穿透到查库与 bcrypt 比对）', async () => {
    expect((await login({ username: '', password: 'password123' })).statusCode).toBe(400)
    expect((await login({ username: 'design@nova-ai.com', password: '' })).statusCode).toBe(400)
    expect(userFindFirst).not.toHaveBeenCalled()
  })

  it('username 超过 100 字符 → 400（对齐 users.username VarChar(100)）', async () => {
    const res = await login({ username: 'a'.repeat(101), password: 'password123' })
    expect(res.statusCode).toBe(400)
    expect(userFindFirst).not.toHaveBeenCalled()
  })

  it('password 超过 128 字符 → 400（对齐 RegisterRequest 的 max 128）', async () => {
    const res = await login({ username: 'design@nova-ai.com', password: 'a'.repeat(129) })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /auth/login — 凭证与账号状态', () => {
  it('用户不存在 → 401 用户名或密码错误', async () => {
    userFindFirst.mockResolvedValue(null)
    const res = await login(VALID_PAYLOAD)
    expect(res.statusCode).toBe(401)
    expect(res.json().message).toBe('用户名或密码错误')
  })

  it('密码错误 → 401 用户名或密码错误', async () => {
    userFindFirst.mockResolvedValue(activeUser())
    const res = await login({ username: 'design@nova-ai.com', password: 'wrong-password' })
    expect(res.statusCode).toBe(401)
    expect(res.json().message).toBe('用户名或密码错误')
    expect(refreshTokenCreate).not.toHaveBeenCalled()
  })

  it('账号被禁用（status !== 1）→ 401，即使密码正确', async () => {
    userFindFirst.mockResolvedValue(activeUser({ status: 0 }))
    const res = await login(VALID_PAYLOAD)
    expect(res.statusCode).toBe(401)
    expect(res.json().message).toBe('账号已被禁用，请联系管理员')
    expect(refreshTokenCreate).not.toHaveBeenCalled()
  })

  it('未设置密码（passwordHash 为 null）→ 401 引导其它登录方式', async () => {
    userFindFirst.mockResolvedValue(activeUser({ passwordHash: null }))
    const res = await login(VALID_PAYLOAD)
    expect(res.statusCode).toBe(401)
    expect(res.json().message).toBe('该账号未设置密码，请使用微信登录')
  })
})

describe('POST /auth/login — 成功路径', () => {
  it('返回 token / refreshToken / user，且不包含 passwordHash', async () => {
    userFindFirst.mockResolvedValue(activeUser())
    const res = await login(VALID_PAYLOAD)
    expect(res.statusCode).toBe(200)

    const body = res.json()
    expect(typeof body.token).toBe('string')
    expect(body.token.length).toBeGreaterThan(0)
    expect(body.refreshToken).toMatch(/^rt_/)
    expect(body.user).toMatchObject({
      id: 'user_test',
      username: 'design@nova-ai.com',
      email: 'design@nova-ai.com',
    })
    expect(body.user.passwordHash).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('passwordHash')
  })

  it('按 username 精确匹配查询（契约稳定：登录暂不支持邮箱/手机号）', async () => {
    userFindFirst.mockResolvedValue(activeUser())
    await login(VALID_PAYLOAD)
    expect(userFindFirst).toHaveBeenCalledWith({
      where: { username: 'design@nova-ai.com' },
    })
  })

  it('成功登录会持久化一个未撤销的 refresh token', async () => {
    userFindFirst.mockResolvedValue(activeUser())
    await login(VALID_PAYLOAD)
    expect(refreshTokenCreate).toHaveBeenCalledTimes(1)
    const arg = refreshTokenCreate.mock.calls[0][0] as {
      data: { userId: string; token: string; expiresAt: Date }
    }
    expect(arg.data.userId).toBe('user_test')
    expect(arg.data.token).toMatch(/^rt_/)
    expect(arg.data.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })
})
