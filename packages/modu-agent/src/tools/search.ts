// 对应 Python: components/action/tools/search.py
// SearchTool：搜索引擎工具，默认 DuckDuckGo（免费无需 key），可选 Tavily（需 API key）
import { BaseTool } from '../core/interfaces/action.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[search] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[search] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[search] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[search] ${msg}`, ...args),
}

/**
 * 搜索引擎工具。
 * 对应 Python SearchTool。
 *
 * 默认使用 DuckDuckGo（免费无需 key），可选 Tavily（需 API key）。
 */
export class SearchTool extends BaseTool {
  name(): string {
    return 'search_engine'
  }

  description(): string {
    return '通过搜索引擎获取实时信息，适用于天气、新闻、知识查询等时效性或事实性查询'
  }

  parametersSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词',
        },
        max_results: {
          type: 'integer',
          description: '最大返回结果数',
          default: 5,
        },
      },
      required: ['query'],
    }
  }

  async invoke(
    params: Record<string, any>,
    _context: Record<string, any>,
  ): Promise<Record<string, any>> {
    const query = params.query ?? ''
    let maxResults = params.max_results ?? 5

    if (typeof query !== 'string' || query.length < 2) {
      return {
        status: 'error',
        error_code: 'TOOL_001',
        data: { message: '查询词过短，至少需要2个字符' },
      }
    }

    if (typeof maxResults !== 'number' || maxResults < 1) {
      maxResults = 5
    }

    // 优先使用 Tavily API（如果有 key）
    const tavilyKey = process.env.TAVILY_API_KEY ?? ''
    if (tavilyKey) {
      try {
        const results = await this._searchTavily(query, maxResults, tavilyKey)
        return {
          status: 'success',
          error_code: '',
          data: { results, source: 'tavily' },
        }
      } catch (e) {
        logger.warning('Tavily search failed, falling back to DuckDuckGo: %s', e)
      }
    }

    // 降级使用 DuckDuckGo Instant Answer API
    try {
      const results = await this._searchDuckDuckGo(query, maxResults)
      return {
        status: 'success',
        error_code: '',
        data: { results, source: 'duckduckgo' },
      }
    } catch (e) {
      logger.error('SearchTool error: %s', String(e))
      return {
        status: 'error',
        error_code: 'TOOL_002',
        data: { message: `搜索服务异常: ${e}` },
      }
    }
  }

  /**
   * 使用 DuckDuckGo Instant Answer API 进行搜索（免费，无需 API key）。
   * 对应 Python _search_duckduckgo。
   */
  private async _searchDuckDuckGo(
    query: string,
    maxResults: number,
  ): Promise<Array<Record<string, string>>> {
    const url = new URL('https://api.duckduckgo.com/')
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('no_html', '1')
    url.searchParams.set('skip_disambig', '1')

    const results: Array<Record<string, string>> = []

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) {
      throw new Error(`DuckDuckGo API returned ${response.status}`)
    }
    const data: any = await response.json()

    // 提取摘要
    const abstract: string = data.AbstractText ?? ''
    if (abstract) {
      results.push({
        title: data.Heading ?? query,
        url: data.AbstractURL ?? '',
        snippet: abstract,
        source: data.AbstractSource ?? 'DuckDuckGo',
      })
    }

    // 提取相关主题
    const related: any[] = data.RelatedTopics ?? []
    for (const topic of related) {
      if (results.length >= maxResults) break
      if (typeof topic === 'object' && topic !== null) {
        const text: string = topic.Text ?? ''
        const firstUrl: string = topic.FirstURL ?? ''
        if (text && firstUrl) {
          results.push({
            title: text.length > 80 ? text.slice(0, 80) + '...' : text,
            url: firstUrl,
            snippet: text,
            source: 'DuckDuckGo',
          })
        } else if (Array.isArray(topic.Topics)) {
          // 嵌套主题
          for (const subTopic of topic.Topics) {
            if (results.length >= maxResults) break
            if (typeof subTopic === 'object' && subTopic !== null) {
              const subText: string = subTopic.Text ?? ''
              const subUrl: string = subTopic.FirstURL ?? ''
              if (subText && subUrl) {
                results.push({
                  title: subText.length > 80 ? subText.slice(0, 80) + '...' : subText,
                  url: subUrl,
                  snippet: subText,
                  source: 'DuckDuckGo',
                })
              }
            }
          }
        }
      }
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

  /**
   * 使用 Tavily API 进行搜索（需要 API key）。
   * 对应 Python _search_tavily。
   */
  private async _searchTavily(
    query: string,
    maxResults: number,
    apiKey: string,
  ): Promise<Array<Record<string, string>>> {
    const url = 'https://api.tavily.com/search'
    const payload = {
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: true,
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) {
      throw new Error(`Tavily API returned ${response.status}`)
    }
    const data: any = await response.json()

    const results: Array<Record<string, string>> = []

    // Tavily 可能返回直接答案
    const answer: string = data.answer ?? ''
    if (answer) {
      results.push({
        title: 'AI Answer',
        url: '',
        snippet: answer,
        source: 'Tavily AI',
      })
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
}
