/**
 * P1 回归：LLM Gateway / 适配器 / 能力清单
 *
 * 覆盖：
 *   - 别名解析与未知模型拒绝（TC-05 / TC-06）
 *   - 适配器 SSE 解析：reasoning_content、content、usage、finish_reason（TC-38）
 *   - 网关流式收尾：usage + 成本 + done
 *   - 未产出内容时的重试，以及已产出时不重试
 *   - 熔断打开后直接失败（不触达适配器）
 *   - GET /capabilities 契约（TC-09）
 */
import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import {
  LLMError,
  type ChatRequest,
  type ChatResult,
  type ChatStreamEvent,
  type ModelDescriptor,
} from '@pioneering/llm-contracts'
import { createLLMGateway, type ChatAdapter } from '@pioneering/llm-gateway'
import { createOpenAICompatibleAdapter, parseSSEDataLine } from '@pioneering/llm-adapters'
import { CircuitBreaker } from '@pioneering/llm-core'
import { systemRoutes } from '../src/routes/system.ts'

const MODELS: ModelDescriptor[] = [
  {
    alias: 'fast',
    model_id: 'deepseek-v4-flash',
    provider: 'deepseek',
    display_name: 'DeepSeek-V4-Flash',
    capabilities: ['tools', 'json_mode'],
    context_window: 128000,
    pricing: { input_price: 0.14, output_price: 0.28 },
    status: 'active',
  },
  {
    alias: 'reasoning',
    model_id: 'deepseek-v4-pro',
    provider: 'deepseek',
    display_name: 'DeepSeek-V4-Pro',
    capabilities: ['tools', 'reasoning'],
    pricing: { input_price: 0.28, output_price: 0.56 },
    status: 'active',
  },
]

const ALIASES = { fast: 'deepseek-v4-flash', reasoning: 'deepseek-v4-pro' }

function makeGateway(opts: {
  adapter: ChatAdapter
  maxAttempts?: number
  breaker?: CircuitBreaker
}) {
  return createLLMGateway({
    models: MODELS,
    aliases: ALIASES,
    defaultAlias: 'fast',
    resolveProvider: () => ({ apiKey: 'test-key', baseUrl: 'http://127.0.0.1:0' }),
    createAdapter: () => opts.adapter,
    policy: { maxAttempts: opts.maxAttempts ?? 1, baseDelayMs: 1 },
    breaker: opts.breaker,
  })
}

function staticAdapter(overrides: Partial<ChatAdapter> = {}): ChatAdapter {
  return {
    async complete(): Promise<ChatResult> {
      return { content: 'ok' }
    },
    async *stream(): AsyncGenerator<ChatStreamEvent, ChatResult, void> {
      yield { type: 'content', delta: 'ok' }
      return { content: 'ok' }
    },
    ...overrides,
  }
}

async function collect<T>(gen: AsyncGenerator<T, unknown, void>): Promise<{ events: T[]; result: unknown }> {
  const events: T[] = []
  for (;;) {
    const step = await gen.next()
    if (step.done) return { events, result: step.value }
    events.push(step.value)
  }
}

describe('ModelCatalog —— 别名与未知模型', () => {
  it('别名解析为真实模型 ID，未知输入报 INVALID_MODEL', () => {
    const gateway = makeGateway({ adapter: staticAdapter() })
    expect(gateway.catalog.resolve('fast').model_id).toBe('deepseek-v4-flash')
    expect(gateway.catalog.resolve('reasoning').model_id).toBe('deepseek-v4-pro')
    expect(gateway.catalog.resolve('deepseek-v4-pro').alias).toBe('reasoning')
    expect(gateway.catalog.resolve(undefined).alias).toBe('fast')

    try {
      gateway.catalog.resolve('gpt-4o')
      throw new Error('应当抛错')
    } catch (e) {
      expect(LLMError.is(e) && e.code).toBe('INVALID_MODEL')
    }
  })
})

describe('OpenAI 兼容适配器 —— SSE 解析', () => {
  it('parseSSEDataLine 只接受 data: 行', () => {
    expect(parseSSEDataLine('data: {"a":1}')).toBe('{"a":1}')
    expect(parseSSEDataLine('data:{"a":1}')).toBe('{"a":1}')
    expect(parseSSEDataLine(': ping')).toBeNull()
    expect(parseSSEDataLine('event: message')).toBeNull()
    expect(parseSSEDataLine('')).toBeNull()
  })

  it('解析 reasoning / content / usage / finish_reason', async () => {
    const body = [
      'data: {"choices":[{"delta":{"reasoning_content":"先想"}}]}',
      'data: {"choices":[{"delta":{"content":"你好"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
      'data: [DONE]',
      '',
    ].join('\n')

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body))
        controller.close()
      },
    })
    const fetchImpl = vi.fn(async () => new Response(stream, { status: 200 }))
    const adapter = createOpenAICompatibleAdapter({
      apiKey: 'k',
      baseUrl: 'http://upstream.test/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const { events, result } = await collect(
      adapter.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'deepseek-v4-flash' }),
    )

    expect(events).toEqual([
      { type: 'reasoning', delta: '先想' },
      { type: 'content', delta: '你好' },
    ])
    expect(result).toMatchObject({
      content: '你好',
      reasoning: '先想',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('LLMGateway —— 流式收尾与重试', () => {
  it('收尾补发 usage（含成本）与 done', async () => {
    const adapter = staticAdapter({
      async *stream(): AsyncGenerator<ChatStreamEvent, ChatResult, void> {
        yield { type: 'content', delta: 'hi' }
        return {
          content: 'hi',
          finishReason: 'stop',
          usage: { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 },
        }
      },
    })
    const gateway = makeGateway({ adapter })

    const { events } = await collect(
      gateway.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'fast' }),
    )

    expect(events[0]).toEqual({ type: 'content', delta: 'hi' })
    const usageEvent = events[1] as { type: string; costUsd?: number }
    expect(usageEvent.type).toBe('usage')
    expect(usageEvent.costUsd).toBeCloseTo(0.42, 6)
    expect(events[2]).toEqual({ type: 'done', finishReason: 'stop' })
  })

  it('未产出内容时重试，第二次成功', async () => {
    let calls = 0
    const adapter = staticAdapter({
      async *stream(): AsyncGenerator<ChatStreamEvent, ChatResult, void> {
        calls += 1
        if (calls === 1) {
          throw new LLMError('UPSTREAM_ERROR', 'boom', { status: 500 })
        }
        yield { type: 'content', delta: 'ok' }
        return { content: 'ok' }
      },
    })
    const gateway = makeGateway({ adapter, maxAttempts: 2 })

    const { events } = await collect(
      gateway.stream({ messages: [{ role: 'user', content: 'hi' }] }),
    )
    expect(calls).toBe(2)
    expect(events[0]).toEqual({ type: 'content', delta: 'ok' })
  })

  it('已产出内容后不再重试', async () => {
    let calls = 0
    const adapter = staticAdapter({
      async *stream(): AsyncGenerator<ChatStreamEvent, ChatResult, void> {
        calls += 1
        yield { type: 'content', delta: 'partial' }
        throw new LLMError('UPSTREAM_ERROR', 'mid-stream', { status: 500 })
      },
    })
    const gateway = makeGateway({ adapter, maxAttempts: 3 })

    await expect(
      collect(gateway.stream({ messages: [{ role: 'user', content: 'hi' }] })),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' })
    expect(calls).toBe(1)
  })

  it('用户主动中止不计入熔断失败', async () => {
    const controller = new AbortController()
    controller.abort()
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 })
    const adapter = staticAdapter({
      async *stream(): AsyncGenerator<ChatStreamEvent, ChatResult, void> {
        throw new LLMError('ABORTED', 'aborted')
      },
    })
    const gateway = makeGateway({ adapter, breaker })

    await expect(
      collect(gateway.stream({ messages: [{ role: 'user', content: 'hi' }], signal: controller.signal })),
    ).rejects.toMatchObject({ code: 'ABORTED' })

    expect(breaker.state('deepseek')).toBe('closed')
  })

  it('熔断打开后直接返回 CIRCUIT_OPEN，不再触达适配器', async () => {
    let calls = 0
    const adapter = staticAdapter({
      async *stream(): AsyncGenerator<ChatStreamEvent, ChatResult, void> {
        calls += 1
        throw new LLMError('UPSTREAM_ERROR', 'always', { status: 503 })
      },
    })
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 })
    const gateway = makeGateway({ adapter, breaker })

    await expect(
      collect(gateway.stream({ messages: [{ role: 'user', content: 'hi' }] })),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' })

    await expect(
      collect(gateway.stream({ messages: [{ role: 'user', content: 'hi' }] })),
    ).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' })

    expect(calls).toBe(1)
  })
})

describe('网关 + 真实适配器（生产路径）', () => {
  it('别名解析为真实 model_id 后请求上游，并聚合 usage', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const sse = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}',
      'data: [DONE]',
      '',
    ].join('\n')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse))
        controller.close()
      },
    })

    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      })
      return new Response(stream, { status: 200 })
    })

    const gateway = createLLMGateway({
      models: MODELS,
      aliases: ALIASES,
      defaultAlias: 'fast',
      resolveProvider: () => ({ apiKey: 'k', baseUrl: 'https://upstream.test/v1/' }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      policy: { maxAttempts: 1 },
    })

    const { events } = await collect(
      gateway.stream({
        messages: [{ role: 'user', content: 'hi' }],
        model: 'reasoning',
        temperature: 0.2,
      }),
    )

    expect(requests[0]?.url).toBe('https://upstream.test/v1/chat/completions')
    expect(requests[0]?.body.model).toBe('deepseek-v4-pro')
    expect(requests[0]?.body.temperature).toBe(0.2)
    expect(events[0]).toEqual({ type: 'content', delta: 'hi' })
    expect(events[1]).toMatchObject({
      type: 'usage',
      usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
    })
    expect(events[2]).toEqual({ type: 'done', finishReason: 'stop' })
  })
})

describe('GET /capabilities', () => {
  it('返回别名 / 能力 / 状态，且不含密钥与端点', async () => {
    const app = Fastify()
    await app.register(systemRoutes)
    const res = await app.inject({ method: 'GET', url: '/capabilities' })

    expect(res.statusCode).toBe(200)
    const body = res.json() as { version: number; models: Array<Record<string, unknown>> }
    expect(body.version).toBe(1)
    expect(body.models.map((m) => m.alias)).toEqual(['fast', 'reasoning'])
    expect(body.models[0]).toMatchObject({
      model_id: 'deepseek-flash',
      provider: 'deepseek',
      status: 'active',
    })
    expect(JSON.stringify(body)).not.toContain('apiKey')
    expect(JSON.stringify(body)).not.toContain('baseUrl')

    await app.close()
  })
})

// 避免未使用告警（保留类型以便后续扩展）
export type _ChatRequest = ChatRequest
