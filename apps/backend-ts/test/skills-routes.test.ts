/**
 * 技能路由单元测试（GET /skills）
 *
 * 数据源合并：ComponentRegistry.listSkills()（已注册）
 *           + SkillLoader.discover(skills.auto_discover_dirs)（目录发现）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const discover = vi.fn()
  class FakeSkillLoader {
    discover = discover
  }
  const state: {
    registered: Record<string, Record<string, unknown>>
    dirs: string[]
  } = {
    registered: {},
    dirs: [],
  }
  return { discover, FakeSkillLoader, state }
})

vi.mock('@pioneering/modu-agent', () => ({
  getConfig: () => ({
    get: (key: string, fallback?: unknown) => {
      if (key === 'skills.auto_discover_dirs') return mocks.state.dirs
      return fallback
    },
  }),
  getRegistry: () => ({
    listSkills: () => mocks.state.registered,
  }),
  SkillLoader: mocks.FakeSkillLoader,
}))

// handler 逻辑测试：mock 认证守卫，直接注入已认证用户
vi.mock('../src/plugins/auth.js', () => ({
  authGuard: async (req: { user?: unknown }) => {
    req.user = { id: 'test-user' }
  },
}))

import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import { skillsRoutes } from '../src/routes/skills.js'

async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify()
  await app.register(skillsRoutes)
  return app
}

/** 构造一个伪技能（discover 返回值的形如 BaseSkill 的最小实现）。 */
function fakeSkill(name: string) {
  return {
    name: () => name,
    description: () => `${name} 描述`,
    version: () => '1.0.0',
    tags: () => ['demo'],
    tools: () => [{}, {}],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.registered = {}
  mocks.state.dirs = []
})

describe('GET /skills', () => {
  it('无注册、无发现目录时返回空列表', async () => {
    const app = await buildServer()
    const reply = await app.inject({ method: 'GET', url: '/skills' })

    expect(reply.statusCode).toBe(200)
    expect(reply.json()).toEqual({ skills: [], total: 0 })
    expect(mocks.discover).not.toHaveBeenCalled()
  })

  it('已注册技能映射为 active=true 且字段完整', async () => {
    mocks.state.registered = {
      math: {
        name: 'math',
        description: '数学计算',
        version: '1.0.0',
        tags: ['math', 'calculation'],
        tool_count: 1,
      },
    }

    const app = await buildServer()
    const reply = await app.inject({ method: 'GET', url: '/skills' })

    expect(reply.json()).toEqual({
      total: 1,
      skills: [
        {
          name: 'math',
          description: '数学计算',
          version: '1.0.0',
          tags: ['math', 'calculation'],
          toolCount: 1,
          active: true,
        },
      ],
    })
  })

  it('目录发现的技能标记 active=false，并与已注册技能去重', async () => {
    mocks.state.dirs = ['skills']
    mocks.state.registered = {
      math: {
        name: 'math',
        description: '数学计算',
        version: '1.0.0',
        tags: [],
        tool_count: 1,
      },
    }
    mocks.discover.mockResolvedValue([fakeSkill('math'), fakeSkill('writer')])

    const app = await buildServer()
    const reply = await app.inject({ method: 'GET', url: '/skills' })
    const body = reply.json() as {
      total: number
      skills: Array<{ name: string; active: boolean; toolCount: number }>
    }

    expect(mocks.discover).toHaveBeenCalledWith(['skills'])
    expect(body.total).toBe(2)
    expect(body.skills.find((s) => s.name === 'math')?.active).toBe(true)
    expect(body.skills.find((s) => s.name === 'writer')).toEqual({
      name: 'writer',
      description: 'writer 描述',
      version: '1.0.0',
      tags: ['demo'],
      toolCount: 2,
      active: false,
    })
  })

  it('discover 抛错时降级返回已注册部分，不返回 5xx', async () => {
    mocks.state.dirs = ['skills']
    mocks.state.registered = {
      math: {
        name: 'math',
        description: '数学计算',
        version: '1.0.0',
        tags: [],
        tool_count: 1,
      },
    }
    mocks.discover.mockRejectedValue(new Error('boom'))

    const app = await buildServer()
    const reply = await app.inject({ method: 'GET', url: '/skills' })

    expect(reply.statusCode).toBe(200)
    const body = reply.json() as { total: number }
    expect(body.total).toBe(1)
  })
})
