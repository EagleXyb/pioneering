/**
 * SearchTool：DeepSeek Search 优先 + 原有 Tavily/Bing/DuckDuckGo 兜底
 *
 * 覆盖：
 *   - DeepSeek 请求/响应映射（Bearer、count、need_content、字段归一化）
 *   - 128 字 Unicode 截断
 *   - 429 退避重试
 *   - 不可重试错误 / 空结果 / 无 key 时降级 Bing
 *   - 结果条数封顶 5（模型传更大值也被压回 5；非法值回退默认）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SearchTool } from '../../src/tools/search.js'
import { _resetLLMConnectionResolverForTest } from '../../src/graph/adapters/llm-connection.js'

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const BING_HTML =
  '<li class="b_algo"><h2><a href="https://b.com/page">B 标题</a></h2>'
  + '<p class="b_lineclamp">B 摘要</p></li>'

const ENV_KEYS = [
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'MODU_DEEPSEEK_API_KEY',
  'MODU_DEEPSEEK_BASE_URL',
  'TAVILY_API_KEY',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'https_proxy',
  'http_proxy',
]

describe('SearchTool DeepSeek 优先', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    // 避免其他用例注册的 resolver 串扰；本组统一走 env
    _resetLLMConnectionResolverForTest()
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
    process.env.LLM_API_KEY = 'test-key'
    process.env.LLM_BASE_URL = 'https://api.deepseek.com/v1'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('DeepSeek 有结果时直接返回，不触发兜底', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        results: [
          {
            title: 'T',
            url: 'https://a.com',
            snippet: 'S',
            summary: '长摘要',
            site_name: 'A站点',
          },
        ],
      }),
    )

    const out = await new SearchTool().invoke({ query: '测试', max_results: 5 }, {})

    expect(out).toMatchObject({ status: 'success', data: { source: 'deepseek' } })
    expect((out as any).data.results[0]).toMatchObject({
      title: 'T',
      url: 'https://a.com',
      snippet: 'S',
      source: 'DeepSeek',
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/v1/tools/search')
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer test-key',
    })
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      query: '测试',
      count: 5,
      need_content: false,
    })
  })

  it('query 超过 128 字时按 Unicode 截断', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        results: [{ title: 'T', url: 'https://a.com', snippet: 'S' }],
      }),
    )

    await new SearchTool().invoke({ query: '长'.repeat(200), max_results: 5 }, {})

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as { query: string }
    expect(Array.from(body.query)).toHaveLength(128)
  })

  it('429 时退避重试，成功后返回 DeepSeek 结果', async () => {
    let calls = 0
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1
      if (calls === 1) return new Response('', { status: 429 })
      return jsonResponse({
        results: [{ title: 'T', url: 'https://a.com', snippet: 'S' }],
      })
    })

    const out = await new SearchTool().invoke({ query: '测试', max_results: 5 }, {})

    expect((out as any).data.source).toBe('deepseek')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  }, 10_000)

  it('DeepSeek 不可重试错误时降级 Bing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/tools/search')) return new Response('bad', { status: 400 })
      if (url.includes('bing.com/search')) return new Response(BING_HTML, { status: 200 })
      throw new Error(`unexpected url: ${url}`)
    })

    const out = await new SearchTool().invoke({ query: '测试', max_results: 5 }, {})

    expect((out as any).data.source).toBe('bing')
    expect((out as any).data.results[0]).toMatchObject({
      title: 'B 标题',
      url: 'https://b.com/page',
    })
  })

  it('DeepSeek 返回空结果时降级 Bing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/tools/search')) return jsonResponse({ results: [] })
      if (url.includes('bing.com/search')) return new Response(BING_HTML, { status: 200 })
      throw new Error(`unexpected url: ${url}`)
    })

    const out = await new SearchTool().invoke({ query: '测试', max_results: 5 }, {})

    expect((out as any).data.source).toBe('bing')
  })

  it('无 DeepSeek key 时跳过，直接走兜底', async () => {
    delete process.env.LLM_API_KEY

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('bing.com/search')) return new Response(BING_HTML, { status: 200 })
      throw new Error(`unexpected url: ${url}`)
    })

    const out = await new SearchTool().invoke({ query: '测试', max_results: 5 }, {})

    expect((out as any).data.source).toBe('bing')
    expect(String(fetchSpy.mock.calls[0][0])).not.toContain('/tools/search')
  })

  it('结果条数封顶 5：模型传更大值也只请求并返回 5 条', async () => {
    const results = Array.from({ length: 10 }, (_, i) => ({
      title: `T${i + 1}`,
      url: `https://a.com/${i + 1}`,
      snippet: 'S',
    }))
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ results }))

    const out = await new SearchTool().invoke({ query: '测试', max_results: 20 }, {})

    expect(
      JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string),
    ).toMatchObject({ count: 5 })
    expect((out as any).data.results).toHaveLength(5)
  })

  it('max_results 非法（0 / 负数 / 非数字 / 缺省）时回退默认 5', async () => {
    // 每次调用返回全新 Response（Response  body 只能读一次）
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({ results: [{ title: 'T', url: 'https://a.com' }] }),
    )

    await new SearchTool().invoke({ query: '测试', max_results: 0 }, {})
    await new SearchTool().invoke({ query: '测试', max_results: -3 }, {})
    await new SearchTool().invoke({ query: '测试', max_results: 'abc' as any }, {})
    await new SearchTool().invoke({ query: '测试' }, {})

    const counts = fetchSpy.mock.calls.map(
      ([, init]) => JSON.parse((init as RequestInit).body as string).count,
    )
    expect(counts).toEqual([5, 5, 5, 5])
  })
})
