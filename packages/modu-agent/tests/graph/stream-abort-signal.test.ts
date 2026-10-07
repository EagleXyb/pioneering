// stream_response AbortSignal 透传测试（T2.3）
//
// 验证：传入的 AbortSignal 会进入 LangGraph stream 配置，
// 信号中止后流（含尚未完成的 LLM 请求）被真正取消。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemorySaver } from '@langchain/langgraph'

import { buildModuGraph } from '@/graph/graph.js'
import { overrideConfig, RuntimeConfig, resetConfig } from '@/config/runtime-config.js'
import { stream_response } from '@/graph/runner.js'

/** LLM invoke 永不返回（模拟挂起的上游请求） */
class BlockedMockLlm {
  async invoke(): Promise<never> {
    return await new Promise<never>(() => {})
  }
  bindTools(): this {
    return this
  }
  bind(): this {
    return this
  }
}

function buildGraph() {
  return buildModuGraph(
    [], // 无工具
    new BlockedMockLlm(),
    new MemorySaver(),
    null,
    'You are a helpful AI assistant.',
    null,
    null,
    false, // HITL 关
    false,
    null,
    false,
    null,
    null,
    null,
  )
}

/** stream_response 的 inputData 参数（直接承载 prompt） */
function makeInputData() {
  return { input_type: 'text', prompt: '测试取消' }
}

describe('stream_response — AbortSignal 透传', () => {
  let restoreHandle: { restore: () => void } | null = null

  beforeEach(() => {
    resetConfig()
    restoreHandle = overrideConfig(new RuntimeConfig({}))
  })

  afterEach(() => {
    restoreHandle?.restore()
    restoreHandle = null
    resetConfig()
  })

  it('signal 中止后挂起的流被取消（抛出 AbortError）', async () => {
    const compiled = buildGraph()
    const controller = new AbortController()

    const generator = stream_response(
      compiled,
      'test-user',
      'thread-abort',
      makeInputData(),
      'trace-abort',
      null,
      null,
      controller.signal,
    )

    const consume = (async () => {
      // eslint-disable-next-line no-empty
      for await (const _event of generator) {
        // 排空事件
      }
    })()

    // 让流启动并挂在 LLM 请求上，再发中止
    await new Promise((r) => setTimeout(r, 10))
    controller.abort()

    await expect(consume).rejects.toThrow(/abort/i)
  })
})
