import { describe, it, expect } from 'vitest'
import { estimateTokens, estimateMessagesTokens } from '../src/core/token-estimator.js'

describe('estimateTokens（统一口径）', () => {
  it('中文不再按 4 字符 1 token 低估', () => {
    const text = '这是一段中文测试文本'
    expect(estimateTokens(text)).toBeGreaterThanOrEqual(text.length)
    // 旧口径会得到 2 左右，新口径必须显著更高
    expect(estimateTokens(text)).toBeGreaterThan(Math.ceil(text.length / 4))
  })

  it('英文按 4 字符约 1 token 估算', () => {
    const text = 'the quick brown fox jumps over the lazy dog'
    const estimated = estimateTokens(text)
    expect(estimated).toBeGreaterThan(5)
    expect(estimated).toBeLessThanOrEqual(text.length)
  })

  it('空文本为 0，单字符至少有 1 token', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('a')).toBe(1)
  })

  it('逐条累加与单条结果口径一致（无截断）', () => {
    const messages = [{ content: '你好' }, { content: 'hello world' }]
    expect(estimateMessagesTokens(messages)).toBe(
      estimateTokens('你好') + estimateTokens('hello world'),
    )
  })
})
