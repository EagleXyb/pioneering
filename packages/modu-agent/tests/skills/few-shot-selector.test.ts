// P2-2 单元测试：Few-shot 动态示例选择
// 对应文档 §5.3 P2-2 + 风险 R-11：空库静默跳过 + MMR + token 预算 + 质量门槛
import { describe, it, expect, beforeEach } from 'vitest'
import {
  DynamicFewShotSelector,
  InMemoryExampleStore,
  formatExample,
  formatExamplesAsPrompt,
  mmrSelect,
  type FewShotExample,
  type ExampleStore,
} from '@/skills/few-shot-selector.js'

// 构造测试用示例
function makeExample(id: string, input: string, output: string, quality = 0.9): FewShotExample {
  return { id, input, output, quality_score: quality }
}

describe('P2-2 Few-shot 动态示例选择', () => {
  // ============================================================
  // InMemoryExampleStore
  // ============================================================
  describe('InMemoryExampleStore', () => {
    it('空库 search 返回空数组', async () => {
      const store = new InMemoryExampleStore()
      expect(await store.search('query', 5)).toEqual([])
    })

    it('add 后可 search 到', async () => {
      const store = new InMemoryExampleStore()
      await store.add(makeExample('e1', '如何计算圆面积', 'π * r²'))
      const results = await store.search('计算圆面积', 5)
      expect(results.length).toBe(1)
      expect(results[0].id).toBe('e1')
    })

    it('count 返回示例总数', async () => {
      const store = new InMemoryExampleStore([
        makeExample('e1', 'a', 'b'),
        makeExample('e2', 'c', 'd'),
      ])
      expect(await store.count()).toBe(2)
    })

    it('search 按相关性降序排列', async () => {
      const store = new InMemoryExampleStore([
        makeExample('e1', '完全不相关的示例', 'x'),
        makeExample('e2', '计算圆面积的公式', 'π * r²'),
        makeExample('e3', '圆面积计算方法', 'π * r²'),
      ])
      const results = await store.search('计算圆面积', 3)
      expect(results.length).toBe(3)
      // e2 和 e3 应排在 e1 前面（含更多匹配词）
      const ids = results.map((r) => r.id)
      expect(ids.indexOf('e1')).toBeGreaterThan(ids.indexOf('e2'))
    })
  })

  // ============================================================
  // formatExample / formatExamplesAsPrompt
  // ============================================================
  describe('formatExample / formatExamplesAsPrompt', () => {
    it('formatExample 格式化单个示例', () => {
      const ex = makeExample('e1', '什么是 π', '圆周率，约 3.14159')
      const r = formatExample(ex)
      expect(r).toContain('输入：什么是 π')
      expect(r).toContain('输出：圆周率，约 3.14159')
    })

    it('formatExamplesAsPrompt 空数组返回空字符串', () => {
      expect(formatExamplesAsPrompt([])).toBe('')
    })

    it('formatExamplesAsPrompt 多个示例以 --- 分隔', () => {
      const examples = [
        makeExample('e1', '问题1', '答案1'),
        makeExample('e2', '问题2', '答案2'),
      ]
      const r = formatExamplesAsPrompt(examples)
      expect(r).toContain('参考示例')
      expect(r).toContain('### 示例 1')
      expect(r).toContain('### 示例 2')
      expect(r).toContain('---')
    })
  })

  // ============================================================
  // mmrSelect
  // ============================================================
  describe('mmrSelect', () => {
    it('候选数 <= maxExamples 时全部返回', () => {
      const candidates = [makeExample('e1', 'a', 'b'), makeExample('e2', 'c', 'd')]
      const r = mmrSelect('query', candidates, 5)
      expect(r.length).toBe(2)
    })

    it('候选数 > maxExamples 时按 MMR 选择', () => {
      const candidates = [
        makeExample('e1', '计算圆面积', 'π r²'),
        makeExample('e2', '计算圆面积公式', 'π r²'),
        makeExample('e3', '计算三角形面积', '底*高/2'),
        makeExample('e4', '天气查询', 'use search tool'),
        makeExample('e5', '计算圆周长', '2π r'),
      ]
      const r = mmrSelect('计算圆面积', candidates, 3, 0.7)
      expect(r.length).toBe(3)
      // 应优先选择与 query 相关的
      const ids = r.map((e) => e.id)
      expect(ids).toContain('e1')
    })

    it('lambda=1.0 时退化为纯相关性 top-k', () => {
      const candidates = [
        makeExample('e1', '计算圆面积', 'π r²'),
        makeExample('e2', '计算圆面积公式', 'π r²'),
        makeExample('e3', '天气查询', 'search'),
      ]
      const r = mmrSelect('计算圆面积', candidates, 2, 1.0)
      // 纯相关性：e1 和 e2 最相关
      expect(r.map((e) => e.id).sort()).toEqual(['e1', 'e2'])
    })

    it('lambda=0.0 时偏重多样性', () => {
      // 使用空格分词确保词重叠可计算
      const candidates = [
        makeExample('e1', 'calculate circle area', 'π r²'),
        makeExample('e2', 'calculate circle area formula', 'π r²'), // 与 e1 高度相似
        makeExample('e3', 'weather query', 'search'),
      ]
      // lambda=0.0: 第一轮所有候选 MMR=0（selected 为空，maxSim=0），选第一个
      // 第二轮选与 e1 相似度最低的（即 e3，weather 与 calculate 无重叠）
      const r = mmrSelect('calculate circle area', candidates, 2, 0.0)
      expect(r.length).toBe(2)
      // 第二个选中的应是与 e1 最不相似的
      expect(r[1].id).toBe('e3')
    })

    it('空候选返回空数组', () => {
      expect(mmrSelect('query', [], 3)).toEqual([])
    })
  })

  // ============================================================
  // DynamicFewShotSelector
  // ============================================================
  describe('DynamicFewShotSelector', () => {
    let store: InMemoryExampleStore

    beforeEach(() => {
      store = new InMemoryExampleStore([
        makeExample('e1', '计算圆面积', 'π * r²', 0.95),
        makeExample('e2', '圆面积公式推导', '积分推导', 0.85),
        makeExample('e3', '天气查询方法', '使用 search 工具', 0.8),
        makeExample('e4', '低质量示例', 'bad', 0.3), // 低于质量门槛
      ])
    })

    it('select 返回与 query 相关的示例', async () => {
      const selector = new DynamicFewShotSelector(store, { maxExamples: 2 })
      const results = await selector.select('计算圆面积')
      expect(results.length).toBe(2)
      // 应包含圆面积相关示例
      const ids = results.map((r) => r.id)
      expect(ids).toContain('e1')
    })

    it('select 过滤低于 quality_score 门槛的示例', async () => {
      const selector = new DynamicFewShotSelector(store, {
        maxExamples: 5,
        minQualityScore: 0.7,
      })
      const results = await selector.select('低质量示例')
      // e4 的 quality_score=0.3 < 0.7，应被过滤
      const ids = results.map((r) => r.id)
      expect(ids).not.toContain('e4')
    })

    it('select 空库返回空数组（R-11 策略①）', async () => {
      const emptyStore = new InMemoryExampleStore()
      const selector = new DynamicFewShotSelector(emptyStore)
      const results = await selector.select('any query')
      expect(results).toEqual([])
    })

    it('selectAndFormat 空库返回空字符串', async () => {
      const emptyStore = new InMemoryExampleStore()
      const selector = new DynamicFewShotSelector(emptyStore)
      const prompt = await selector.selectAndFormat('any query')
      expect(prompt).toBe('')
    })

    it('selectAndFormat 有示例时返回格式化 prompt', async () => {
      const selector = new DynamicFewShotSelector(store, { maxExamples: 1 })
      const prompt = await selector.selectAndFormat('计算圆面积')
      expect(prompt).toContain('参考示例')
      expect(prompt).toContain('### 示例 1')
    })

    it('token 预算截断（R-11 策略②）', async () => {
      // 设置极小的 token 预算，强制截断（1 token ≈ 4 字符）
      const selector = new DynamicFewShotSelector(store, {
        maxExamples: 5,
        maxTokensBudget: 3, // 约 12 字符，不够任何完整示例
      })
      const results = await selector.select('计算圆面积')
      // token 预算极小，应返回 0 个示例
      expect(results.length).toBe(0)
    })

    it('addExample 拒绝低于质量门槛的示例', async () => {
      const selector = new DynamicFewShotSelector(store, { minQualityScore: 0.7 })
      const ok = await selector.addExample(makeExample('e5', 'new', 'example', 0.5))
      expect(ok).toBe(false)
    })

    it('addExample 接受符合质量门槛的示例', async () => {
      const selector = new DynamicFewShotSelector(store, { minQualityScore: 0.7 })
      const ok = await selector.addExample(makeExample('e5', 'new', 'example', 0.9))
      expect(ok).toBe(true)
    })

    it('fromConfig 配置未启用时返回 null', () => {
      // 默认配置 few_shot.enabled=false
      const selector = DynamicFewShotSelector.fromConfig(store)
      expect(selector).toBeNull()
    })
  })

  // ============================================================
  // 向后兼容
  // ============================================================
  describe('向后兼容', () => {
    it('few_shot 未启用时 agentNode 不注入示例（等价现状）', async () => {
      // 空库 + 未启用 → selectAndFormat 返回空字符串
      const emptyStore = new InMemoryExampleStore()
      const selector = new DynamicFewShotSelector(emptyStore)
      const prompt = await selector.selectAndFormat('any query')
      expect(prompt).toBe('')
    })
  })
})
