import { describe, it, expect } from 'vitest'
import { PerceptionFusion } from '@/perception/fusion.js'

function result(inputType: string, confidence: number, extra: Record<string, any> = {}): Record<string, any> {
  return {
    parsed_content: { input_type: inputType, text: `text_${inputType}` },
    detected_language: 'zh',
    confidence,
    quality_score: confidence,
    security_score: 1.0,
    metadata: { sensitivity_level: 0 },
    ...extra,
  }
}

describe('PerceptionFusion', () => {
  it('returns empty result for no inputs', () => {
    const f = new PerceptionFusion('weighted_average')
    expect(f.fuse([]).parsed_content.input_type).toBe('empty')
  })

  it('returns the single result unchanged', () => {
    const f = new PerceptionFusion()
    const r = result('text', 0.9)
    expect(f.fuse([r])).toBe(r)
  })

  it('weighted_average blends confidence and merges text', () => {
    const f = new PerceptionFusion('weighted_average', { text: 0.5, image: 0.5 })
    const out = f.fuse([result('text', 1.0), result('image', 0.0)])
    // text weight 0.5, image weight 0.5 -> (1.0*0.5 + 0.0*0.5)/1.0 = 0.5
    expect(out.confidence).toBeCloseTo(0.5)
    expect(out.parsed_content.text).toContain('text_text')
    expect(out.parsed_content.text).toContain('text_image')
    expect(out.metadata.fusion_strategy).toBe('weighted_average')
  })

  it('max_confidence picks the highest-confidence result', () => {
    const f = new PerceptionFusion('max_confidence')
    const out = f.fuse([result('text', 0.2), result('image', 0.8)])
    expect(out.confidence).toBe(0.8)
    expect(out.parsed_content.input_type).toBe('image')
  })

  it('voting picks the most-voted sensitivity level', () => {
    const f = new PerceptionFusion('voting')
    const a = result('text', 0.5, { metadata: { sensitivity_level: 2 } })
    const b = result('image', 0.5, { metadata: { sensitivity_level: 2 } })
    const c = result('audio', 0.5, { metadata: { sensitivity_level: 1 } })
    const out = f.fuse([a, b, c])
    expect(out.metadata.sensitivity_level).toBe(2)
  })
})
