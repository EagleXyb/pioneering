// P1-20：max_confidence / voting 融合结果为深拷贝，修改不污染入参。
import { describe, it, expect } from 'vitest'
import { PerceptionFusion } from '@/perception/fusion.js'

function makeResult(over: Record<string, any> = {}): Record<string, any> {
  return {
    parsed_content: { input_type: 'text', text: 'hello', nested: { mark: 'orig' } },
    detected_language: 'zh',
    confidence: 0.8,
    metadata: { sensitivity_level: 1, source: 'a' },
    quality_score: 0.7,
    security_score: 1,
    entities: [{ e: 'x' }],
    ...over,
  }
}

describe('P1-20 · fusion 深拷贝隔离', () => {
  it('max_confidence：融合结果 metadata/嵌套字段改动不回写入参', () => {
    const low = makeResult({ confidence: 0.3 })
    const high = makeResult({ confidence: 0.9, metadata: { sensitivity_level: 2, source: 'b' } })
    const fusion = new PerceptionFusion('max_confidence')

    const fused = fusion.fuse([low, high])
    expect(fused.metadata.fusion_strategy).toBe('max_confidence')

    fused.metadata.sensitivity_level = 5
    fused.parsed_content.nested.mark = 'mutated'
    fused.entities.push({ e: 'injected' })

    // 入参（高置信结果）保持原样
    expect(high.metadata.sensitivity_level).toBe(2)
    expect(high.parsed_content.nested.mark).toBe('orig')
    expect(high.entities).toEqual([{ e: 'x' }])
  })

  it('voting：融合写 sensitivity_level 不回写入参，且嵌套对象隔离', () => {
    const a = makeResult({ confidence: 0.9, metadata: { sensitivity_level: 0 } })
    const b = makeResult({ confidence: 0.3, metadata: { sensitivity_level: 0 } })
    const fusion = new PerceptionFusion('voting')

    const fused = fusion.fuse([a, b])
    expect(fused.metadata.fusion_strategy).toBe('voting')
    fused.metadata.sensitivity_level = 9
    fused.parsed_content.text = 'changed'

    expect(a.metadata.sensitivity_level).toBe(0)
    expect(b.metadata.sensitivity_level).toBe(0)
    expect(a.parsed_content.text).toBe('hello')
  })

  it('单结果直通语义不回归（fuse 单入参即该对象）', () => {
    const fusion = new PerceptionFusion('max_confidence')
    const only = makeResult()
    expect(fusion.fuse([only])).toBe(only)
  })
})
