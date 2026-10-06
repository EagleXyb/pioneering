// 联网搜索服务 —— 对应 Python ModuAgent/components/action/tools/search.py
// 流程：LLM 提炼搜索关键词 -> Tavily(需 key, 境外) -> DuckDuckGo(免费, 境外)
//       -> Bing HTML(免费, 国内可达, 无需 key)
// 任意一级失败自动降级；全部失败返回 null，由调用方决定是否回退为普通对话
import { env } from '../config/env.js'

export interface SearchResult {
  title: string
  url: string
  snippet: string
  source: string
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
      site: safeHostname(r.url) || r.source,
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
    const response = await fetchWithTimeout(
      `${env.LLM_BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.LLM_API_KEY}`,
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
 * 联网搜索入口：先提炼关键词，再 Tavily -> DuckDuckGo -> Bing 依次降级。
 * 全部失败返回 null（不抛错，避免阻断对话主流程）。
 */
export async function webSearch(
  query: string,
  maxResults = 6,
): Promise<SearchOutcome | null> {
  if (!query || query.trim().length < 2) return null

  const refined = await refineSearchQuery(query)
  const searchQuery = refined ?? query
  if (refined && refined !== query.trim()) {
    console.info(`[web-search] query refined: "${query.trim()}" -> "${searchQuery}"`)
  }

  const tavilyKey = process.env.TAVILY_API_KEY ?? ''
  if (tavilyKey) {
    try {
      const results = await searchTavily(searchQuery, maxResults, tavilyKey)
      if (results.length > 0) return { source: 'tavily', results }
    } catch (e) {
      console.warn(`[web-search] Tavily failed, falling back: ${String(e)}`)
    }
  }

  try {
    const results = await searchDuckDuckGo(searchQuery, maxResults)
    if (results.length > 0) return { source: 'duckduckgo', results }
  } catch (e) {
    console.warn(`[web-search] DuckDuckGo failed, falling back to Bing: ${String(e)}`)
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
    if (r.snippet) parts.push(`摘要：${r.snippet}`)
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
