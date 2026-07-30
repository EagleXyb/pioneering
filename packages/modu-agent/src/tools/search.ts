// 对应 Python: components/action/tools/search.py
// SearchTool：搜索引擎工具。
// 优先级(按可达性 + 数据完整性):Tavily(需 key, 境外) -> Bing HTML(免费, 国内可达, 无需 key) -> DuckDuckGo(免费, 境外, 仅索引少量源)
import { BaseTool } from '../core/interfaces/action.js'

// 部分搜索接口对缺失 User-Agent 的请求会拒绝或返回异常，统一带上浏览器 UA
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[search] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[search] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[search] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[search] ${msg}`, ...args),
}

// P1: 模块级日志去重标志,避免每次调用都打印代理缺失/undici 缺失 warning
let _proxyMissingLogged = false
let _undiciMissingLogged = false

/**
 * 搜索引擎工具。
 * 对应 Python SearchTool。
 *
 * 优先级(按可达性 + 数据完整性):
 *   1. Tavily(需 API key,境外,数据质量最高)
 *   2. Bing HTML(免费,国内可达,真正的搜索引擎结果页,默认兜底)
 *   3. DuckDuckGo Instant Answer(免费,境外,仅索引 Wikipedia 等少量源,最后回退)
 *
 * P0-2 修复:原顺序将 DuckDuckGo 置于 Bing 之前,导致中国大陆环境下
 * DuckDuckGo 不可达或仅返回即时答案伪成功时,Bing 兜底永远执行不到。
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

  // P4 Plan-Execute: 声明本工具提供实时/外部数据（对应文档 §4.1 建议7）
  // Planner 节点读取此元方法推断 step.requires_tool=true，step_finalize 据此校验
  providesRealtimeData(): boolean {
    return true
  }

  // v1.2 §4.3 建议9：搜索结果中常含 URL，推荐用 http_request 继续抓取详情
  followUpTools(): string[] {
    return ['http_request']
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

    // 优先级(按可达性 + 数据完整性排序):
    //   1) Tavily(有 key 时,境外,需代理) —— 数据质量最高
    //   2) Bing HTML(无 key,国内可达,真正的搜索引擎) —— 默认兜底
    //   3) DuckDuckGo Instant Answer(无 key,境外,仅索引 Wikipedia 等少量源) —— 最后回退
    //
    // P0-2 修复:原顺序 Tavily → DuckDuckGo → Bing 在中国大陆环境下几乎必然失败
    //   (DuckDuckGo 不可达 + 即使可达也只返回即时答案),Bing 永远执行不到。
    //   现调整为 Bing 优先于 DuckDuckGo,确保国内环境下工具真正可用。

    // 1) 优先使用 Tavily API(如果有 key,境外服务,建议走代理)
    const tavilyKey = process.env.TAVILY_API_KEY ?? ''
    if (tavilyKey) {
      try {
        const results = await this._withRetry(
          () => this._searchTavily(query, maxResults, tavilyKey),
          2,
        )
        return {
          status: 'success',
          error_code: '',
          data: { results, source: 'tavily' },
        }
      } catch (e) {
        logger.warning('Tavily search failed, falling back: %s', String(e))
      }
    }

    // 2) Bing HTML(无 key,国内可达,真正的搜索引擎结果页)
    try {
      const results = await this._withRetry(
        () => this._searchBing(query, maxResults),
        0,
      )
      return {
        status: 'success',
        error_code: '',
        data: { results, source: 'bing' },
      }
    } catch (e) {
      logger.warning('Bing failed, falling back to DuckDuckGo: %s', String(e))
    }

    // 3) 最后回退:DuckDuckGo Instant Answer API(免费,境外,仅索引少量源)
    try {
      const results = await this._withRetry(
        () => this._searchDuckDuckGo(query, maxResults),
        0,
      )
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
   * 带指数退避的重试包装：失败重试 retries 次（默认 2 次），间隔 0.5s/1s...
   */
  private async _withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
    let lastErr: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn()
      } catch (e) {
        lastErr = e
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
        }
      }
    }
    throw lastErr
  }

  /**
   * 读取代理环境变量,返回 undici 的 ProxyAgent(仅当设置了 HTTPS_PROXY/HTTP_PROXY 时)。
   * 注意:Node 全局 fetch 默认不读取系统代理,需要显式传入 dispatcher。
   * 若未安装 undici 或未设置代理,则返回 undefined(直连)。
   *
   * P1 增强:首次调用时检测代理缺失并输出 warning,帮助用户排查境外服务不可达问题。
   *   - 调用 Tavily/DuckDuckGo 前若代理缺失,提示用户配置 HTTPS_PROXY
   *   - Bing 国内可达,无需代理,不触发提示
   */
  private async _proxyDispatcher(options?: { requireProxy?: boolean }): Promise<any | undefined> {
    const proxy =
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy
    if (!proxy) {
      // 仅在明确需要代理的场景(Tavily/DuckDuckGo)提示一次,避免噪声
      if (options?.requireProxy && !_proxyMissingLogged) {
        _proxyMissingLogged = true
        logger.warning(
          '[代理提示] 未检测到 HTTPS_PROXY/HTTP_PROXY 环境变量,境外搜索服务(Tavily/DuckDuckGo)可能不可达。' +
          '请配置代理:export HTTPS_PROXY=http://your-proxy:port,并安装 undici (npm i undici)',
        )
      }
      return undefined
    }
    try {
      const undici = await import('undici')
      return new undici.ProxyAgent(proxy)
    } catch {
      if (!_undiciMissingLogged) {
        _undiciMissingLogged = true
        logger.warning(
          '检测到代理配置 (%s) 但未安装 undici,无法启用代理。请运行: npm i undici',
          proxy,
        )
      }
      return undefined
    }
  }

  /**
   * 使用 DuckDuckGo Instant Answer API 进行搜索（免费，无需 API key，境外）。
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

    const dispatcher = await this._proxyDispatcher({ requireProxy: true })
    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      ...(dispatcher ? { dispatcher } : {}),
    })
    if (!response.ok) {
      throw new Error(`DuckDuckGo API returned ${response.status}`)
    }
    const data: any = await response.json()

    // 提取摘要
    const abstract: string = data.AbstractText ?? ''
    const results: Array<Record<string, string>> = []
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

    // P0-1 修复:空结果时抛错,让降级链路继续到 Bing
    // DuckDuckGo Instant Answer API 仅索引 Wikipedia 等少量源,
    // 对天气/新闻/AI 趋势等绝大多数查询返回空,伪成功会阻断 Bing 兜底
    if (results.length === 0) {
      throw new Error(
        `DuckDuckGo Instant Answer API 返回空结果(查询词: ${query}),降级到 Bing`,
      )
    }

    return results.slice(0, maxResults)
  }

  /**
   * 使用 Tavily API 进行搜索（需要 API key，境外）。
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

    const dispatcher = await this._proxyDispatcher({ requireProxy: true })
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
      ...(dispatcher ? { dispatcher } : {}),
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

  /**
   * 国内可达兜底:直接抓取 Bing 搜索结果页(https://www.bing.com/search)。
   * 无需 API key,bing.com 在中国大陆网络通常可达。
   * 通过解析 HTML 提取标题/链接/摘要;无依赖,仅用正则。
   *
   * P2 加固:
   *   1. 检测反爬验证页(标题含"验证"/"Verifying"),抛错让降级链路继续
   *   2. 超时延长到 15s(Bing HTML 页面较大,10s 偶发超时)
   *   3. 增加 Referer 头,降低被反爬概率
   */
  private async _searchBing(
    query: string,
    maxResults: number,
  ): Promise<Array<Record<string, string>>> {
    const url =
      `https://www.bing.com/search?q=${encodeURIComponent(query)}` +
      `&count=${maxResults}&setlang=zh-CN&ensearch=0`

    const dispatcher = await this._proxyDispatcher()
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
        // P2:增加 Referer,降低被反爬概率
        Referer: 'https://www.bing.com/',
      },
      ...(dispatcher ? { dispatcher } : {}),
    })
    if (!response.ok) {
      throw new Error(`Bing returned ${response.status}`)
    }
    const html = await response.text()

    // P2:反爬验证页检测
    // Bing 验证页通常 <title> 含"验证"/"Verifying"/"Just a moment"
    if (this._isBingCaptchaPage(html)) {
      throw new Error('Bing 返回反爬验证页(可能 IP 被风控),降级到 DuckDuckGo')
    }

    const results = this._parseBingHtml(html, maxResults)

    // P2:解析失败时抛错,让降级链路继续到 DuckDuckGo
    // (原逻辑返回伪成功结果,会阻断降级)
    if (results.length === 0) {
      throw new Error(
        `Bing 解析到 0 条结果(查询词: ${query}),可能页面结构已变更,降级到 DuckDuckGo`,
      )
    }

    return results
  }

  /**
   * P2:检测 Bing 反爬验证页。
   * 特征:<title> 含"验证"/"Verifying"/"Just a moment",或 body 含 captcha 容器。
   */
  private _isBingCaptchaPage(html: string): boolean {
    // 提取 <title> 标签内容(前 2KB 即可,避免扫描整页)
    const head = html.slice(0, 2048)
    const titleM = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    const title = titleM ? titleM[1].toLowerCase() : ''
    if (
      title.includes('verifying') ||
      title.includes('just a moment') ||
      title.includes('验证')
    ) {
      return true
    }
    // 兜底:检测 cf-challenge / bing captcha 容器
    if (html.includes('cf-challenge-running') || html.includes('id="bcaptcha"')) {
      return true
    }
    return false
  }

  /**
   * 从 Bing 搜索结果 HTML 中提取条目。
   * 结果块为 <li class="b_algo">,标题在 <h2><a href> 内,摘要在 <p> 内。
   *
   * P2 加固:
   *   - 兼容 class 属性顺序变化(b_algo 可能不在首位)
   *   - 兼容 <h2> 与 <a> 嵌套关系的两种变体
   *   - 摘要匹配优先级:b_lineclamp4 > b_lineclamp2 > 普通 <p>
   */
  private _parseBingHtml(
    html: string,
    maxResults: number,
  ): Array<Record<string, string>> {
    const results: Array<Record<string, string>> = []
    // P2:兼容 class 属性中 b_algo 不在首位的情况(如 class="b_algo b_no1st")
    const blockRe = /<li[^>]*class="[^"]*\bb_algo\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi
    const blocks = html.match(blockRe) ?? []

    for (const block of blocks) {
      if (results.length >= maxResults) break

      // Bing 结构为 <a href="https://..."> 包裹 <h2>标题</h2>,故先取块内第一个 https 链接
      const linkM = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>/i)
      if (!linkM) continue

      const url = linkM[1]
      let title = ''
      const h2M = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)
      if (h2M) title = this._stripTags(h2M[1])
      // 无 h2 时退回用链接文字作为标题
      if (!title) {
        const aTextM = block.match(
          /<a[^>]*href="https?:\/\/[^"]+"[^>]*>([\s\S]*?)<\/a>/i,
        )
        if (aTextM) title = this._stripTags(aTextM[1])
      }
      if (!title) continue

      // P2:摘要匹配优先级 —— 长摘要 > 短摘要 > 任意 <p>
      const snippetM =
        block.match(/<p[^>]*class="[^"]*b_lineclamp4[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ??
        block.match(/<p[^>]*class="[^"]*b_lineclamp2[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ??
        block.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ??
        block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
      const snippet = snippetM ? this._stripTags(snippetM[1]) : ''

      results.push({ title, url, snippet, source: 'Bing' })
    }

    return results
  }

  private _stripTags(s: string): string {
    return s
      .replace(/<[^>]+>/g, '')
      .replace(/&[a-z#0-9]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
}
