/**
 * 技能管理面写接口（L3-1.3）—— 路由测试
 *
 * 覆盖：启用（白名单 + 热注册 + 工具就位）、停用（反注册 + 工具回收）、
 *       未发现技能 404、reload 对齐。
 *
 * 说明：`skill-state` 以内存桩替代（真实文件行为见 skill-state.test.ts），
 * 认证/管理员守卫以桩替代（授权逻辑见 plugins/admin.ts）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import fs from 'fs'
import os from 'os'
import path from 'path'

const stateMock = vi.hoisted(() => ({ active: [] as string[] }))

vi.mock('../src/plugins/auth.js', () => ({
  authGuard: async (req: any) => {
    req.user = { id: 'admin-1' }
  },
}))

vi.mock('../src/plugins/admin.js', () => ({
  adminGuard: async () => {},
  adminUserIds: () => ['admin-1'],
}))

vi.mock('../src/core/skill-state.js', () => ({
  readSkillState: () =>
    stateMock.active.length > 0
      ? { active: stateMock.active, updatedAt: '', updatedBy: 'test' }
      : null,
  setActiveSkills: (next: string[], by: string) => {
    stateMock.active = [...new Set(next.map(String))].sort()
    return { active: stateMock.active, updatedAt: '', updatedBy: by }
  },
  applyPersistedSkillState: () => ({ applied: false, active: [] }),
}))

import { skillsRoutes, collectToolConflicts } from '../src/routes/skills.js'
import { getConfig, getRegistry, resetConfig, resetRegistry } from '@pioneering/modu-agent'

let baseDir = ''

function makeSkill(name: string): void {
  const dir = path.join(baseDir, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'skill.js'),
    [
      'export const skill = {',
      `  name: () => ${JSON.stringify(name)},`,
      `  description: () => ${JSON.stringify(`${name} skill`)},`,
      "  version: () => '1.0.0',",
      '  tags: () => [],',
      '  examples: () => [],',
      '  tools: () => [{',
      `    name: () => ${JSON.stringify(`${name}_tool`)},`,
      "    description: () => 'tool',",
      '    parametersSchema: () => ({}),',
      '    requiresApproval: () => false,',
      '    onApprovalRejected: () => ({}),',
      "    invoke: async () => ({ status: 'success' }),",
      '  }],',
      '  isAvailable: () => true,',
      '  setup() {},',
      '  teardown() {},',
      '}',
    ].join('\n'),
    'utf8',
  )
}

async function buildApp() {
  const app = Fastify()
  app.decorateRequest('user', null)
  await app.register(skillsRoutes)
  await app.ready()
  return app
}

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-routes-'))
  stateMock.active = []
  resetConfig()
  resetRegistry()
  getConfig().set('skills.enabled', true)
  getConfig().set('skills.auto_discover_dirs', [baseDir])
  getConfig().set('skills.active', [])
})

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true })
})

describe('GET /skills（L3）', () => {
  it('返回 enabled / active 与目录发现项（active=false）', async () => {
    makeSkill('alpha')
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/skills' })
    const body = res.json()

    expect(res.statusCode).toBe(200)
    expect(body.enabled).toBe(true)
    expect(body.active).toEqual([])
    expect(body.total).toBe(1)
    expect(body.skills[0]).toMatchObject({ name: 'alpha', active: false, toolCount: 1 })
  })

  it('skills.enabled=false 时 enabled=false（前端据此提示）', async () => {
    getConfig().set('skills.enabled', false)
    const app = await buildApp()
    const body = (await app.inject({ method: 'GET', url: '/skills' })).json()
    expect(body.enabled).toBe(false)
  })
})

describe('POST /skills/:name/activate', () => {
  it('启用成功：写入白名单 + 注册技能 + 工具就位', async () => {
    makeSkill('alpha')
    const app = await buildApp()

    const res = await app.inject({ method: 'POST', url: '/skills/alpha/activate' })
    expect(res.json()).toMatchObject({ ok: true, name: 'alpha' })
    expect(res.statusCode).toBe(200)
    expect(stateMock.active).toEqual(['alpha'])
    expect(getRegistry().getSkill('alpha')).toBeDefined()
    expect(getRegistry().getTool('alpha_tool')).toBeDefined()

    const list = (await app.inject({ method: 'GET', url: '/skills' })).json()
    expect(list.skills[0]).toMatchObject({ name: 'alpha', active: true, toolNames: ['alpha_tool'] })
  })

  it('未发现的技能 → 404（不污染白名单）', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/skills/ghost/activate' })
    expect(res.statusCode).toBe(404)
    expect(stateMock.active).toEqual([])
  })

  it('skills.enabled=false → 409', async () => {
    makeSkill('alpha')
    getConfig().set('skills.enabled', false)
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/skills/alpha/activate' })
    expect(res.statusCode).toBe(409)
  })
})

describe('POST /skills/:name/deactivate', () => {
  it('停用成功：反注册并回收工具', async () => {
    makeSkill('alpha')
    const app = await buildApp()
    await app.inject({ method: 'POST', url: '/skills/alpha/activate' })

    const res = await app.inject({ method: 'POST', url: '/skills/alpha/deactivate' })
    expect(res.statusCode).toBe(200)
    expect(stateMock.active).toEqual([])
    expect(getRegistry().getSkill('alpha')).toBeUndefined()
    expect(getRegistry().getTool('alpha_tool')).toBeUndefined()
  })

  it('停用未启用的技能：幂等 200', async () => {
    makeSkill('alpha')
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/skills/alpha/deactivate' })
    expect(res.statusCode).toBe(200)
    expect(stateMock.active).toEqual([])
  })
})

describe('POST /skills/:name/rollback（L3-2）', () => {
  it('缺少版本号 → 400', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/skills/alpha/rollback',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('无版本信息（未经过 manifest 扫描）→ 404', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/skills/ghost/rollback',
      payload: { version: '1.0.0' },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('collectToolConflicts（L3-2）', () => {
  it('同一工具名被两个技能占用 → 报冲突', () => {
    const out = collectToolConflicts(
      [
        { name: 'a', toolNames: ['shared'] },
        { name: 'b', toolNames: ['shared', 'b_only'] },
      ],
      { listTools: () => ({ shared: {}, b_only: {} }) },
    )
    expect(out).toContainEqual({ skill: 'b', tool: 'shared', existing: 'a' })
  })

  it('无冲突时返回空数组', () => {
    expect(
      collectToolConflicts(
        [{ name: 'a', toolNames: ['a_tool'] }],
        { listTools: () => ({ a_tool: {} }) },
      ),
    ).toEqual([])
  })
})

describe('POST /skills/prune（L4-5.2）', () => {
  it('未启用技能子系统 → 409', async () => {
    getConfig().set('skills.enabled', false)
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/skills/prune', payload: {} })
    expect(res.statusCode).toBe(409)
  })

  it('无快照目录 → 200 且 removed 为空（不抛异常）', async () => {
    makeSkill('alpha')
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/skills/prune',
      payload: { keepLast: 2, maxAgeDays: 30, dryRun: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().results[0].removed).toEqual([])
  })
})

describe('POST /skills/reload', () => {
  it('对齐白名单并返回已注册清单', async () => {
    makeSkill('alpha')
    stateMock.active = ['alpha']
    const app = await buildApp()

    const res = await app.inject({ method: 'POST', url: '/skills/reload' })
    expect(res.statusCode).toBe(200)
    expect(res.json().registered).toEqual(['alpha'])
    expect(getRegistry().getTool('alpha_tool')).toBeDefined()
  })
})
