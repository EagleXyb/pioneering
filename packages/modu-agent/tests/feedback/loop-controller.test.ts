import { describe, it, expect } from 'vitest'
import { FeedbackLoop } from '@/feedback/loop-controller.js'

describe('FeedbackLoop', () => {
  it('evaluates a response into an evaluation dict', async () => {
    const loop = new FeedbackLoop(undefined, undefined, undefined, 3)
    const ev = await loop.evaluate({ response: '这是一个完整且切题的回答内容。' }, { prompt: '这是一个完整且切题的回答内容。' })
    expect(ev).toHaveProperty('quality_score')
    expect(loop.getSampleCount()).toBe(1)
  })

  it('does not trigger evolution below minimum sample size', async () => {
    // minSampleSize = 4, but only 3 low-quality samples are collected.
    const loop = new FeedbackLoop(undefined, undefined, undefined, 4)
    let ev: Record<string, any> = {}
    for (let i = 0; i < 3; i++) {
      ev = await loop.evaluate({ response: '' }, { prompt: 'x' })
    }
    expect(loop.getSampleCount()).toBe(3)
    expect(loop.shouldEvolve(ev as Record<string, number>, 0.6)).toBe(false)
  })

  it('triggers evolution when >=60% of recent samples are below threshold', async () => {
    const loop = new FeedbackLoop(undefined, undefined, undefined, 3)
    for (let i = 0; i < 3; i++) {
      await loop.evaluate({ response: '' }, { prompt: 'x' })
    }
    const ev = await loop.evaluate({ response: '' }, { prompt: 'x' })
    expect(loop.shouldEvolve(ev as Record<string, number>, 0.6)).toBe(true)
  })

  it('does not trigger when quality is high', async () => {
    const loop = new FeedbackLoop(undefined, undefined, undefined, 3)
    const good = '这是一个完整且切题的回答内容。'
    for (let i = 0; i < 3; i++) {
      await loop.evaluate({ response: good }, { prompt: good })
    }
    const ev = await loop.evaluate({ response: good }, { prompt: good })
    expect(loop.shouldEvolve(ev as Record<string, number>, 0.6)).toBe(false)
  })

  it('accumulates and resets metrics', async () => {
    const loop = new FeedbackLoop(undefined, undefined, undefined, 3)
    await loop.evaluate({ response: '' }, { prompt: 'x' })
    expect(Object.keys(loop.getCumulativeMetrics()).length).toBeGreaterThan(0)
    loop.reset()
    expect(loop.getSampleCount()).toBe(0)
  })
})
