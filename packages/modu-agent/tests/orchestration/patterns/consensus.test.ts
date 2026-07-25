// 对应文档 §4.4 建议10/12：共识策略单元测试
import { describe, expect, it } from 'vitest'

import {
  LLMJudgeStrategy,
  MajorityVoteStrategy,
  WeightedAggregateStrategy,
} from '../../../src/orchestration/patterns/consensus.js'
import type { LLMMessage, ModuLLM, LLMResult } from '../../../src/core/interfaces/llm.js'

describe('MajorityVoteStrategy', () => {
  const strategy = new MajorityVoteStrategy()

  it('空结果返回 null consensus', async () => {
    const r = await strategy.aggregate([], 1)
    expect(r.consensus).toBeNull()
    expect(r.strategy).toBe('majority_vote')
  })

  it('完全相同输出归为一组', async () => {
    const results = [
      { task_id: 't1', status: 'success', output: 'answer is 42' },
      { task_id: 't2', status: 'success', output: 'answer is 42' },
      { task_id: 't3', status: 'success', output: 'different' },
    ]
    const r = await strategy.aggregate(results, 2)
    expect(r.agreement_count).toBe(2)
    expect(r.group_count).toBe(2)
  })

  it('v1.4 §4.4 建议12：Jaccard 相似度归组（语义等价但字面不同）', async () => {
    // v1.3 前 SHA-256 严格匹配：三者各成一组，agreement_count=1
    // v1.4 Jaccard 相似度：前两者相似度 >= 0.6 归为一组，agreement_count=2
    const results = [
      { task_id: 't1', status: 'success', output: 'The answer is 42' },
      { task_id: 't2', status: 'success', output: 'answer is 42' },
      { task_id: 't3', status: 'success', output: 'Completely different content about weather' },
    ]
    const r = await strategy.aggregate(results, 2)
    expect(r.agreement_count).toBeGreaterThanOrEqual(2)
    expect(r.group_count).toBe(2)
  })

  it('完全不同的输出各成一组', async () => {
    const results = [
      { task_id: 't1', status: 'success', output: 'apple' },
      { task_id: 't2', status: 'success', output: 'banana' },
      { task_id: 't3', status: 'success', output: 'cherry' },
    ]
    const r = await strategy.aggregate(results, 1)
    expect(r.group_count).toBe(3)
    expect(r.agreement_count).toBe(1)
  })
})

describe('MajorityVoteStrategy._textSimilarity', () => {
  it('完全相同文本相似度为 1.0', () => {
    const a = { output: 'hello world' }
    const b = { output: 'hello world' }
    expect(MajorityVoteStrategy._textSimilarity(a, b)).toBe(1.0)
  })

  it('无共同词元相似度为 0.0', () => {
    const a = { output: 'apple' }
    const b = { output: 'banana' }
    expect(MajorityVoteStrategy._textSimilarity(a, b)).toBe(0)
  })

  it('部分重叠相似度在 (0, 1) 之间', () => {
    const a = { output: 'the quick brown fox' }
    const b = { output: 'the quick red fox' }
    const sim = MajorityVoteStrategy._textSimilarity(a, b)
    expect(sim).toBeGreaterThan(0)
    expect(sim).toBeLessThan(1)
  })

  it('空文本相似度为 1.0（两者都空）', () => {
    const a = { output: '' }
    const b = { output: '' }
    expect(MajorityVoteStrategy._textSimilarity(a, b)).toBe(1.0)
  })

  it('一空一非空相似度为 0.0', () => {
    const a = { output: '' }
    const b = { output: 'hello' }
    expect(MajorityVoteStrategy._textSimilarity(a, b)).toBe(0)
  })
})

describe('WeightedAggregateStrategy', () => {
  it('按权重选择最高分结果', async () => {
    const strategy = new WeightedAggregateStrategy({ research: 0.5, coding: 0.9 })
    const results = [
      { task_id: 't1', task_type: 'research', status: 'success', output: 'research result' },
      { task_id: 't2', task_type: 'coding', status: 'success', output: 'code result' },
    ]
    const r = await strategy.aggregate(results, 1)
    expect(r.strategy).toBe('weighted')
    expect(r.best_weight).toBe(0.9)
  })
})

describe('LLMJudgeStrategy', () => {
  it('无 judge LLM 时 fallback 到 majority vote', async () => {
    const strategy = new LLMJudgeStrategy(null, 'test task')
    const results = [
      { task_id: 't1', status: 'success', output: 'same answer' },
      { task_id: 't2', status: 'success', output: 'same answer' },
    ]
    const r = await strategy.aggregate(results, 1)
    // fallback 到 majority_vote 后策略名应为 'majority_vote'
    expect(r.strategy).toBe('majority_vote')
  })

  it('v1.4 §4.4 建议10：judge LLM 失败时重试 1 次', async () => {
    // 模拟 LLM：首次抛错，重试成功
    let callCount = 0
    const mockLlm: ModuLLM = {
      invoke: async (_messages: LLMMessage[]): Promise<LLMResult> => {
        callCount++
        if (callCount === 1) {
          throw new Error('network error')
        }
        return {
          content: JSON.stringify({ winner: 0, reason: 'second attempt ok' }),
          model: 'mock',
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }
      },
    }
    const strategy = new LLMJudgeStrategy(mockLlm, 'test task')
    const results = [
      { task_id: 't1', status: 'success', output: 'result 1' },
      { task_id: 't2', status: 'success', output: 'result 2' },
    ]
    const r = await strategy.aggregate(results, 1)
    expect(r.strategy).toBe('llm_judge')
    expect(r.judge_attempts).toBe(2)
    expect(r.winner_index).toBe(0)
  })

  it('v1.4 §4.4 建议10：judge LLM 连续失败后 fallback 到首个候选', async () => {
    const mockLlm: ModuLLM = {
      invoke: async (_messages: LLMMessage[]): Promise<LLMResult> => {
        throw new Error('persistent error')
      },
    }
    const strategy = new LLMJudgeStrategy(mockLlm, 'test task')
    const results = [
      { task_id: 't1', status: 'success', output: 'result 1' },
      { task_id: 't2', status: 'success', output: 'result 2' },
    ]
    const r = await strategy.aggregate(results, 1)
    expect(r.strategy).toBe('llm_judge_fallback')
    expect(r.judge_error).toContain('persistent error')
  })
})
