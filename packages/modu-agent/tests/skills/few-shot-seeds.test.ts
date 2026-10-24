// P0/P1（FS-2 / FS-5 / FS-6 / FS-8）单元测试：
// 种子示例、CJK 分词与估算、轨迹格式化、去重/TTL、选择器端到端。
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DynamicFewShotSelector,
  InMemoryExampleStore,
  estimateTokensCjk,
  formatExample,
  tokenizeForMatch,
  type FewShotExample,
} from '@/skills/few-shot-selector.js'
import { FEW_SHOT_SEEDS, getFewShotSeeds } from '@/skills/few-shot-seeds.js'
import {
  getSharedFewShotStore,
  isFewShotStoreSeeded,
  recordFewShotExample,
  resetFewShotStore,
} from '@/skills/few-shot-store.js'

describe('Few-shot 种子示例', () => {
  it('种子非空、id 唯一、质量分达到默认门槛', () => {
    expect(FEW_SHOT_SEEDS.length).toBeGreaterThanOrEqual(8)
    const ids = new Set(FEW_SHOT_SEEDS.map((e) => e.id))
    expect(ids.size).toBe(FEW_SHOT_SEEDS.length)
    for (const ex of FEW_SHOT_SEEDS) {
      expect(ex.input.trim()).not.toBe('')
      expect(ex.output.trim()).not.toBe('')
      expect(ex.quality_score).toBeGreaterThanOrEqual(0.8)
    }
  })

  it('按 domain 过滤可用', () => {
    const coding = getFewShotSeeds('coding')
    expect(coding.length).toBeGreaterThan(0)
    expect(coding.every((e) => e.domain === 'coding')).toBe(true)
  })
})

describe('CJK 分词与 token 估算（FS-5）', () => {
  it('中文按 1 字 1 token 估算，显著高于旧的 len/4', () => {
    const text = '对比两个方案的优缺点'
    expect(estimateTokensCjk(text)).toBe(text.length)
    expect(estimateTokensCjk(text)).toBeGreaterThan(Math.ceil(text.length / 4))
  })

  it('中文 bigram 能命中查询词', () => {
    const tokens = tokenizeForMatch('对比两个方案')
    expect(tokens).toContain('对比')
    expect(tokens).toContain('方案')
  })

  it('中文查询可召回相关种子（旧实现 split 空白会失败）', async () => {
    const store = new InMemoryExampleStore(FEW_SHOT_SEEDS)
    const hits = await store.search('帮我对比两个方案', 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].id).toBe('seed.research.compare')
  })
})

describe('示例格式化与轨迹（FS-6）', () => {
  it('有 trajectory 时按对话轨迹输出，并包含工具调用', () => {
    const ex = FEW_SHOT_SEEDS.find((e) => e.id === 'seed.research.realtime')!
    const text = formatExample(ex)
    expect(text).toContain('轨迹')
    expect(text).toContain('调工具 datetime')
    expect(text).toContain('[工具]')
  })

  it('无 trajectory 时回退输入/输出格式', () => {
    const text = formatExample(FEW_SHOT_SEEDS.find((e) => e.id === 'seed.doc.daily')!)
    expect(text).toContain('输入：')
    expect(text).toContain('输出：')
  })
})

describe('示例库治理（FS-8）', () => {
  const base: FewShotExample = {
    id: 'x1',
    input: '同一个问题',
    output: '答案 A',
    quality_score: 0.9,
    created_at: Date.now(),
  }

  it('同输入去重，保留质量分更高者', async () => {
    const store = new InMemoryExampleStore()
    expect(await store.add(base)).toBe(true)
    // 低分重复 → 拒绝
    expect(await store.add({ ...base, id: 'x2', quality_score: 0.8 })).toBe(false)
    // 高分重复 → 替换
    expect(await store.add({ ...base, id: 'x3', quality_score: 0.95 })).toBe(true)
    expect(await store.count()).toBe(1)
  })

  it('过期示例不参与检索与计数', async () => {
    const store = new InMemoryExampleStore([], { maxAgeDays: 1 })
    await store.add({
      ...base,
      created_at: Date.now() - 3 * 24 * 60 * 60 * 1000,
    })
    expect(await store.count()).toBe(0)
    expect(await store.search('同一个问题', 3)).toEqual([])
  })
})

describe('选择器端到端（FS-2/FS-4）', () => {
  it('种子库 + 选择器：中文查询返回格式化片段，且受 token 预算约束', async () => {
    const store = new InMemoryExampleStore(FEW_SHOT_SEEDS)
    const selector = new DynamicFewShotSelector(store, {
      maxExamples: 3,
      maxTokensBudget: 400,
      minQualityScore: 0.8,
      mmrLambda: 0.7,
    })
    const fragment = await selector.selectAndFormat('帮我调研竞品并对比')
    expect(fragment).toContain('参考示例')
    expect(estimateTokensCjk(fragment)).toBeLessThanOrEqual(450)
  })

  it('共享库默认已装载种子，且可接收反馈候选', async () => {
    resetFewShotStore()
    expect(isFewShotStoreSeeded()).toBe(false)
    const store = getSharedFewShotStore()
    expect(isFewShotStoreSeeded()).toBe(true)
    expect(await store.count()).toBeGreaterThan(0)

    const ok = await recordFewShotExample({
      id: 'fb.test.1',
      input: '只属于测试的问题',
      output: '测试答案',
      quality_score: 0.9,
    })
    expect(ok).toBe(true)
    expect(await store.count()).toBe(FEW_SHOT_SEEDS.length + 1)
    resetFewShotStore()
  })

  it('低于质量门槛的示例不入库', async () => {
    const store = new InMemoryExampleStore()
    const selector = new DynamicFewShotSelector(store, { minQualityScore: 0.8 })
    expect(await selector.addExample({
      id: 'low',
      input: '低质量示例',
      output: '不应入库',
      quality_score: 0.5,
    })).toBe(false)
    expect(await store.count()).toBe(0)
  })
})
