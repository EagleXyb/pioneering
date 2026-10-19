// 联网搜索服务 —— 对应 Python ModuAgent/components/action/tools/search.py
// 流程：DeepSeek 官方 Search（自研搜索引擎）-> 失败/空结果时懒提炼关键词 -> Bing HTML
//       任意一级失败自动降级；全部失败返回 null，由调用方决定是否回退为普通对话
import { env } from '../config/env.js'
import { resolveLlmSecrets } from './secrets.js'

export interface SearchResult {
  title: string
  url: string
  snippet: string
  source: string
  /** 长摘要（DeepSeek 提供 600~800 字），优先用于喂模型；其它来源可能缺省 */
  summary?: string
  /** 站点名（DeepSeek 返回 site_name），用于前端来源卡片展示 */
  siteName?: string
}

export interface SearchOutcome {
  source: string
  results: SearchResult[]
}

/** 下发给前端的结构化来源（对应前端 types/chat.ts ReferenceItem） */
export interface WebSourceItem {
  title: string
  url: string
  content: string
  site: string
}

/** 从 URL 提取域名（失败返回空串） */
export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** 将搜索结果映射为前端来源卡片数据 */
export function toSourceItems(outcome: SearchOutcome): WebSourceItem[] {
  return outcome.results
    .filter((r) => r.title || r.snippet)
    .map((r) => ({
      title: r.title,
      url: r.url,
      content: r.snippet,
      // DeepSeek 自带 site_name，优先于从 URL 反解域名
      site: r.siteName || safeHostname(r.url) || r.source,
    }))
}

// 部分搜索接口对缺失 User-Agent 的请求会拒绝或返回异常，统一带上浏览器 UA
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  })
}

/** LLM 密钥/端点：与网关同源（file Secret 优先，失败回退 env），进程内解析一次 */
let _llmSecrets: ReturnType<typeof resolveLlmSecrets> | null = null
function getLlmSecrets(): ReturnType<typeof resolveLlmSecrets> {
  if (!_llmSecrets) {
    _llmSecrets = resolveLlmSecrets({
      provider: env.SECRET_PROVIDER,
      filePath: env.LLM_SECRET_FILE,
      envFallback: { apiKey: env.LLM_API_KEY, baseUrl: env.LLM_BASE_URL },
    })
  }
  return _llmSecrets
}

/** DeepSeek Search 重试策略：官方建议 408 / 429 / 5xx 退避重试 */
const SEARCH_MAX_ATTEMPTS = 3
const SEARCH_RETRY_BASE_MS = 500

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Search 专用：可重试状态/网络错误按 500ms、1000ms 退避重试，其余直接返回 */
async function fetchSearchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  let lastError: unknown

  for (let attempt = 1; attempt <= SEARCH_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(url, init, timeoutMs)
      if (!isRetryableStatus(response.status) || attempt === SEARCH_MAX_ATTEMPTS) {
        return response
      }
      console.warn(
        `[web-search] DeepSeek Search HTTP ${response.status}, `
          + `retry ${attempt}/${SEARCH_MAX_ATTEMPTS - 1}`,
      )
    } catch (e) {
      lastError = e
      if (attempt === SEARCH_MAX_ATTEMPTS) throw e
      console.warn(
        `[web-search] DeepSeek Search request failed, `
          + `retry ${attempt}/${SEARCH_MAX_ATTEMPTS - 1}: ${String(e)}`,
      )
    }
    await sleep(SEARCH_RETRY_BASE_MS * 2 ** (attempt - 1))
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** DeepSeek Search 的 query / ori_question 上限（Unicode 字符） */
const DEEPSEEK_QUERY_MAX = 128

/** 按 Unicode 字符截断（避免超长问题被 API 判 400） */
function clampQuery(input: string, max = DEEPSEEK_QUERY_MAX): string {
  const chars = Array.from(input.trim())
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

/**
 * DeepSeek 官方 Search API（自研搜索引擎，按成功请求次数计费）。
 *
 * 端点：POST {LLM_BASE_URL}/tools/search，Bearer 复用 DeepSeek API Key。
 * 响应 results[] 含 title/url/snippet/summary/site_name 等字段，直接映射到 SearchResult。
 * 仅 HTTP 200 且 results 非空时计费；调用方据此决定是否降级。
 */
export async function searchDeepSeek(
  query: string,
  maxResults: number,
  oriQuestion: string,
): Promise<SearchResult[]> {
  const { apiKey, baseUrl } = getLlmSecrets()
  const base = baseUrl.replace(/\/+$/, '')
  const response = await fetchSearchWithRetry(
    `${base}/tools/search`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({
        query: clampQuery(query),
        // 文档取值范围 1~50
        count: Math.min(50, Math.max(1, maxResults)),
        ori_question: clampQuery(oriQuestion),
        // 只要标题/摘要：正文（content）体积大且本次用不到
        need_content: false,
      }),
    },
    10_000,
  )
  if (!response.ok) throw new Error(`DeepSeek Search HTTP ${response.status}`)

  const data = (await response.json()) as {
    results?: Array<{
      title?: string
      url?: string
      snippet?: string
      summary?: string
      site_name?: string | null
    }>
  }

  return (data.results ?? [])
    .filter((r) => r.title || r.snippet || r.summary)
    .slice(0, maxResults)
    .map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      // snippet 面向 UI；缺失时用 summary 兜底
      snippet: r.snippet || r.summary || '',
      summary: r.summary || undefined,
      siteName: r.site_name ?? undefined,
      source: 'DeepSeek',
    }))
}

/** Tavily API 搜索（需要 TAVILY_API_KEY，境外服务） */
async function searchTavily(query: string, maxResults: number, apiKey: string): Promise<SearchResult[]> {
  const response = await fetchWithTimeout(
    'https://api.tavily.com/search',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        include_answer: true,
      }),
    },
    8000,
  )
  if (!response.ok) throw new Error(`Tavily HTTP ${response.status}`)
  const data = (await response.json()) as {
    answer?: string
    results?: Array<{ title?: string; url?: string; content?: string }>
  }

  const results: SearchResult[] = []
  if (data.answer) {
    results.push({ title: 'AI Answer', url: '', snippet: data.answer, source: 'Tavily AI' })
  }
  for (const item of data.results ?? []) {
    results.push({
      title: item.title ?? '',
      url: item.url ?? '',
      snippet: item.content ?? '',
      source: 'Tavily',
    })
  }
  return results.slice(0, maxResults)
}

/** DuckDuckGo Instant Answer API（免费，无需 key，境外） */
async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    no_html: '1',
    skip_disambig: '1',
  })
  const response = await fetchWithTimeout(
    `https://api.duckduckgo.com/?${params.toString()}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    },
    6000,
  )
  if (!response.ok) throw new Error(`DuckDuckGo HTTP ${response.status}`)
  const data = (await response.json()) as {
    AbstractText?: string
    Heading?: string
    AbstractURL?: string
    AbstractSource?: string
    RelatedTopics?: Array<Record<string, unknown>>
  }

  const results: SearchResult[] = []
  if (data.AbstractText) {
    results.push({
      title: data.Heading ?? query,
      url: data.AbstractURL ?? '',
      snippet: data.AbstractText,
      source: data.AbstractSource ?? 'DuckDuckGo',
    })
  }

  interface RelatedTopic {
    Text?: string
    FirstURL?: string
    Topics?: RelatedTopic[]
  }

  const pushTopic = (topic: RelatedTopic): void => {
    if (results.length >= maxResults) return
    if (topic.Text && topic.FirstURL) {
      const text = topic.Text
      results.push({
        title: text.length > 80 ? `${text.slice(0, 80)}...` : text,
        url: topic.FirstURL,
        snippet: text,
        source: 'DuckDuckGo',
      })
    } else if (topic.Topics) {
      for (const sub of topic.Topics) pushTopic(sub)
    }
  }

  for (const rawTopic of data.RelatedTopics ?? []) {
    if (results.length >= maxResults) break
    pushTopic(rawTopic as RelatedTopic)
  }

  if (results.length === 0) {
    results.push({
      title: query,
      url: '',
      snippet: `未找到关于 '${query}' 的即时答案，建议尝试更具体的关键词。`,
      source: 'DuckDuckGo',
    })
  }

  return results.slice(0, maxResults)
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 从 Bing 搜索结果 HTML 中提取条目（结果块 <li class="b_algo">） */
export function parseBingHtml(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = []
  const blockRe = /<li class="b_algo"[\s\S]*?<\/li>/gi
  const blocks = html.match(blockRe) ?? []

  for (const block of blocks) {
    if (results.length >= maxResults) break

    const linkM = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/i)
    if (!linkM) continue
    const url = linkM[1]

    let title = ''
    const h2M = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)
    if (h2M) title = stripTags(h2M[1])
    if (!title) {
      const aTextM = block.match(
        /<a[^>]*href="https?:\/\/[^"]+"[^>]*>([\s\S]*?)<\/a>/i,
      )
      if (aTextM) title = stripTags(aTextM[1])
    }
    if (!title) continue

    const snippetM
      = block.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
      || block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    const snippet = snippetM ? stripTags(snippetM[1]) : ''

    results.push({ title, url, snippet, source: 'Bing' })
  }

  return results.slice(0, maxResults)
}

/** Bing 搜索结果页抓取（无需 key，bing.com 国内通常可达） */
async function searchBing(query: string, maxResults: number): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    count: String(maxResults),
    setlang: 'zh-CN',
    ensearch: '0',
  })
  const response = await fetchWithTimeout(
    `https://www.bing.com/search?${params.toString()}`,
    {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    },
    10_000,
  )
  if (!response.ok) throw new Error(`Bing HTTP ${response.status}`)
  const html = await response.text()
  return parseBingHtml(html, maxResults)
}

/**
 * 用快速模型把口语化问题提炼为精简搜索关键词，提升搜索引擎命中率。
 * 失败或结果异常时返回 null（调用方回退为原始问题）。
 */
export async function refineSearchQuery(rawQuery: string): Promise<string | null> {
  const trimmed = rawQuery.trim()
  if (!trimmed) return null

  try {
    const { apiKey, baseUrl } = getLlmSecrets()
    const base = baseUrl.replace(/\/+$/, '')
    const response = await fetchWithTimeout(
      `${base}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // 始终用默认（快速、低成本）模型做提炼，与当前对话选用的模型解耦
          model: env.LLM_DEFAULT_MODEL,
          messages: [
            {
              role: 'system',
              content: [
                '你是搜索关键词提取器。把用户的问题改写为适合搜索引擎检索的精简关键词：',
                '1. 以核心实体或主题开头（如产品名、公司名、人物、领域），时间、地点等限定词放后面，',
                '不要以“最近、最新、今年、现在”等时间副词开头；',
                '2. 去掉“请问、告诉我、有哪些、吗、呢、简单说说”等口语成分；',
                '3. 输出 1-2 组关键词，用空格分隔。',
                '只输出关键词本身，不要输出引号、句号、序号或任何解释。',
                '示例：',
                '用户：最近有什么科技新闻？ → 科技新闻 本周',
                '用户：2026年10月有哪些手机发布会 → 2026年10月 手机发布会',
              ].join(''),
            },
            { role: 'user', content: trimmed.slice(0, 500) },
          ],
          stream: false,
          temperature: 0.2,
          // flash 模型会先产出 reasoning，max_tokens 过小会被思考耗尽导致正文为空
          max_tokens: 400,
        }),
      },
      30_000,
    )
    if (!response.ok) return null
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const raw = data.choices?.[0]?.message?.content ?? ''
    // 多行输出时取最后一行非空文本，并剥除"关键词："类前缀/引号/句末标点
    const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    let refined = lines[lines.length - 1] ?? ''
    // 兼容模型模仿示例输出 "用户：xxx → 关键词"
    if (refined.includes('→')) refined = refined.slice(refined.lastIndexOf('→') + 1)
    refined = refined
      .replace(/^(搜索关键词|搜索词|关键词)[:：]\s*/, '')
      .replace(/^[""'「「]+|[""'」」]+$/g, '')
      .replace(/[。.；;]+$/g, '')
      .trim()
    // 提炼结果为空或异常过长（模型输出了解释性长句）时回退原句
    if (!refined || refined.length > 100) return null
    return refined
  } catch (e) {
    console.warn(`[web-search] query refine failed, use raw query: ${String(e)}`)
    return null
  }
}

/**
 * 联网搜索入口：DeepSeek 官方搜索优先，失败/空结果降级 Bing。
 * 仅在降级 Bing 前才做关键词提炼（懒提炼）；全部失败返回 null（不抛错，避免阻断对话主流程）。
 *
 * 注：Tavily / DuckDuckGo 实现保留但已不在降级链上，便于将来按需启用。
 */
export async function webSearch(
  query: string,
  maxResults = 6,
): Promise<SearchOutcome | null> {
  if (!query || query.trim().length < 2) return null

  // 首选 DeepSeek 官方搜索：直接用原问题（配合 ori_question）检索，
  // 省去关键词提炼的额外 LLM 调用。AI 原生搜索对自然语言问句容忍度高。
  try {
    const results = await searchDeepSeek(query, maxResults, query)
    if (results.length > 0) return { source: 'deepseek', results }
    console.info('[web-search] DeepSeek returned no results, falling back to Bing')
  } catch (e) {
    console.warn(`[web-search] DeepSeek failed, falling back to Bing: ${String(e)}`)
  }

  // 降级 Bing：传统关键词引擎对长问句/口语命中率差，
  // 此时才做关键词提炼（懒提炼），失败则回退原问题。
  const refined = await refineSearchQuery(query)
  const searchQuery = refined ?? query
  if (refined && refined !== query.trim()) {
    console.info(`[web-search] query refined: "${query.trim()}" -> "${searchQuery}"`)
  }

  try {
    const results = await searchBing(searchQuery, maxResults)
    if (results.length > 0) return { source: 'bing', results }
  } catch (e) {
    console.error(`[web-search] Bing search error: ${String(e)}`)
  }

  return null
}

/** 将搜索结果格式化为注入 LLM 的系统上下文（中文） */
export function formatSearchContext(query: string, outcome: SearchOutcome): string {
  const lines = outcome.results.map((r, i) => {
    const parts = [`【${i + 1}】${r.title}`]
    if (r.url) parts.push(`链接：${r.url}`)
    // DeepSeek 的 summary（600~800 字）信息量大于 snippet，优先喂给模型
    const digest = r.summary?.trim() || r.snippet
    if (digest) parts.push(`摘要：${digest}`)
    return parts.join('\n')
  })

  return [
    `用户已开启联网搜索。以下是关于用户问题的实时搜索结果（来源：${outcome.source}，搜索关键词：${query}）：`,
    '',
    ...lines,
    '',
    '要求：',
    '1. 优先综合以上搜索结果回答，确保信息准确、时效；搜索结果不足以回答时可结合你的知识补充，但需明确说明；',
    '2. 不要在回答中罗列"参考来源/参考链接"列表或重复粘贴链接——来源由系统在回答外独立展示；',
    '3. 不要虚构搜索结果中不存在的数据或链接。',
  ].join('\n')
}
