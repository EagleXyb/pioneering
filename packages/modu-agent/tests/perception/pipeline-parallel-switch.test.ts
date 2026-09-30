// P1-21：并行感知管线需显式开启（默认回落串行，二者语义不等价）。
//
// 本实现的并行模型：首个感知器串行建立基线，第 2..N 个感知器并行消费该基线；
// 串行模型：每个感知器依次消费上一个的输出。差异在 3+ 处理器时显现于 p3 的输入。
import { describe, it, expect, beforeEach } from 'vitest'

import { runPerceptionPipelineAsync } from '@/perception/pipeline.js'
import { ComponentRegistry } from '@/core/registry.js'
import { RuntimeConfig } from '@/config/runtime-config.js'

/** 记录收到的输入文本并追加自身标记的假感知器。 */
function makeSpyProcessor(marker: string, seen: string[]): any {
  return {
    perceive: async (_type: string, content: Uint8Array) => {
      const inText = new TextDecoder().decode(content)
      seen.push(inText)
      return {
        parsed_content: {
          input_type: 'text',
          text: inText ? `${inText}>${marker}` : marker,
        },
        confidence: 1,
        metadata: {},
      }
    },
  }
}

async function runWith(parallel: boolean, seen: Record<string, string[]>) {
  const registry = new ComponentRegistry()
  registry.registerPerception('p1' as any, makeSpyProcessor('P1', seen.p1) as any)
  registry.registerPerception('p2' as any, makeSpyProcessor('P2', seen.p2) as any)
  registry.registerPerception('p3' as any, makeSpyProcessor('P3', seen.p3) as any)
  const config = new RuntimeConfig({
    perception: {
      parallel: { enabled: parallel },
      routing: { text: { pipeline: ['p1', 'p2', 'p3'] } },
    },
  })
  return runPerceptionPipelineAsync(
    { input_type: 'text', prompt: 'RAW' },
    config,
    registry,
  )
}

describe('P1-21 · 感知管线并行显式开关（默认串行语义）', () => {
  beforeEach(() => {
    // 使用局部 registry，无需全局复位
  })

  it('默认/显式关闭：p3 接收 p2 的输出（串行链式语义）', async () => {
    const seen = { p1: [], p2: [], p3: [] } as Record<string, string[]>
    await runWith(false, seen)

    expect(seen.p1).toEqual(['RAW'])
    expect(seen.p2).toEqual(['RAW>P1'])
    expect(seen.p3).toEqual(['RAW>P1>P2'])
  })

  it('显式开启：p2/p3 并行消费 p1 基线（均收到 RAW>P1）', async () => {
    const seen = { p1: [], p2: [], p3: [] } as Record<string, string[]>
    await runWith(true, seen)

    expect(seen.p1).toEqual(['RAW'])
    expect(seen.p2).toEqual(['RAW>P1'])
    expect(seen.p3).toEqual(['RAW>P1'])
  })

  it('缺省配置 perception.parallel.enabled=false（opt-in 开关默认关）', () => {
    const cfg = new RuntimeConfig()
    expect(cfg.get('perception.parallel.enabled', true)).toBe(false)
  })
})
