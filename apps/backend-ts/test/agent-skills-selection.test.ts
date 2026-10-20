/**
 * Skills 选择链路（P0 选择→执行）—— 后端单元测试
 *
 * 覆盖三件事：
 *   1. normalizeSkills 的语义（undefined 与 [] 必须可区分）
 *   2. graphCacheKey 必须纳入 skills（否则不同选择会命中同一张图）
 *   3. 请求 schema 的边界（数量上限 / nullable）
 */
import { describe, it, expect } from 'vitest'

import { normalizeSkills, _graphCacheKeyForTest } from '../src/core/agent-bridge.js'
import { resolveResumeSkills } from '../src/routes/agent.js'
import {
  AgentChatRequestSchema,
  AgentResumeRequestSchema,
} from '../src/schemas/agent.js'

describe('normalizeSkills', () => {
  it('undefined / null → undefined（不声明选择，保持服务端默认）', () => {
    expect(normalizeSkills(undefined)).toBeUndefined()
    expect(normalizeSkills(null)).toBeUndefined()
  })

  it('空数组 → 空数组（明确不使用技能，与 undefined 语义不同）', () => {
    expect(normalizeSkills([])).toEqual([])
  })

  it('去重 + 去空白 + 排序（顺序无关，命中同一张缓存图）', () => {
    expect(normalizeSkills(['writer', 'math', 'math', ' math '])).toEqual([
      'math',
      'writer',
    ])
  })

  it('全空白项归一为空数组', () => {
    expect(normalizeSkills(['', '   '])).toEqual([])
  })

  it('非数组输入按 undefined 处理（防御性）', () => {
    expect(normalizeSkills('math' as any)).toBeUndefined()
  })
})

describe('graphCacheKey（P0：skills 参与分片）', () => {
  const base = { plan_execute_enabled: false, domain: null, model: null }

  it('不同技能选择 → 不同 key', () => {
    const a = _graphCacheKeyForTest({ ...base, skills: normalizeSkills(['math']) })
    const b = _graphCacheKeyForTest({ ...base, skills: normalizeSkills(['writer']) })
    expect(a).not.toBe(b)
  })

  it('同一组技能的不同顺序 → 同一 key（依赖 normalize 的排序）', () => {
    const a = _graphCacheKeyForTest({
      ...base,
      skills: normalizeSkills(['math', 'writer']),
    })
    const b = _graphCacheKeyForTest({
      ...base,
      skills: normalizeSkills(['writer', 'math']),
    })
    expect(a).toBe(b)
  })

  it('未声明 skills 与空选择 → key 不同', () => {
    const none = _graphCacheKeyForTest({ ...base })
    const empty = _graphCacheKeyForTest({ ...base, skills: [] })
    expect(none).not.toBe(empty)
  })
})

describe('AgentChatRequestSchema.skills', () => {
  const base = { message: 'hi' }

  it('省略时解析为 undefined', () => {
    const dto = AgentChatRequestSchema.parse(base)
    expect(dto.skills).toBeUndefined()
  })

  it('正常解析字符串数组', () => {
    const dto = AgentChatRequestSchema.parse({ ...base, skills: ['math', 'writer'] })
    expect(dto.skills).toEqual(['math', 'writer'])
  })

  it('允许 null（等价于省略）', () => {
    const dto = AgentChatRequestSchema.parse({ ...base, skills: null })
    expect(dto.skills).toBeNull()
  })

  it('超过 20 项被拒绝（防止恶意长列表撑爆图缓存）', () => {
    const many = Array.from({ length: 21 }, (_, i) => `s${i}`)
    expect(AgentChatRequestSchema.safeParse({ ...base, skills: many }).success).toBe(
      false,
    )
  })

  it('空字符串技能名被拒绝', () => {
    expect(
      AgentChatRequestSchema.safeParse({ ...base, skills: [''] }).success,
    ).toBe(false)
  })
})

describe('resolveResumeSkills（resume 选择解析）', () => {
  const prisma = (row: any, throwErr = false) =>
    ({
      chatMessage: {
        findFirst: async () => {
          if (throwErr) throw new Error('db down')
          return row
        },
      },
    }) as any

  it('请求体显式给出 → 原样采用（不查库）', async () => {
    let called = 0
    const p = {
      chatMessage: {
        findFirst: async () => {
          called += 1
          return null
        },
      },
    } as any
    expect(
      await resolveResumeSkills(p, { sessionId: 's1', userId: 'u1', requested: ['math'] }),
    ).toEqual(['math'])
    expect(called).toBe(0)
  })

  it('请求体给空数组 → 保持空数组（明确不使用，不回读）', async () => {
    expect(
      await resolveResumeSkills(prisma(null), { sessionId: 's1', userId: 'u1', requested: [] }),
    ).toEqual([])
  })

  it('请求体缺失 → 回读用户消息 metadata.skills', async () => {
    const row = { extraMetadata: { skills: ['math', 'writer'] } }
    expect(
      await resolveResumeSkills(prisma(row), { sessionId: 's1', userId: 'u1', requested: null }),
    ).toEqual(['math', 'writer'])
  })

  it('回读无记录 / metadata 无 skills → undefined（服务端默认）', async () => {
    expect(
      await resolveResumeSkills(prisma(null), { sessionId: 's1', userId: 'u1' }),
    ).toBeUndefined()
    expect(
      await resolveResumeSkills(prisma({ extraMetadata: { paused: true } }), {
        sessionId: 's1',
        userId: 'u1',
      }),
    ).toBeUndefined()
  })

  it('回读异常 → undefined（不阻断恢复）', async () => {
    expect(
      await resolveResumeSkills(prisma(null, true), { sessionId: 's1', userId: 'u1' }),
    ).toBeUndefined()
  })
})

describe('AgentResumeRequestSchema.skills', () => {
  it('恢复请求同样支持 skills（保持暂停/恢复工具集一致）', () => {
    const dto = AgentResumeRequestSchema.parse({
      sessionId: 's1',
      approved: true,
      skills: ['math'],
    })
    expect(dto.skills).toEqual(['math'])
  })

  it('省略时 undefined（回退服务端默认）', () => {
    const dto = AgentResumeRequestSchema.parse({ sessionId: 's1', approved: false })
    expect(dto.skills).toBeUndefined()
  })
})
