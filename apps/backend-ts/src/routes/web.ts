// 网页代理阅读路由 —— 供"联网搜索"右侧来源面板内嵌预览
//
// 背景：掘金/CSDN/微软等大量站点通过 X-Frame-Options / CSP frame-ancestors
// 禁止被第三方 iframe 内嵌，直连 iframe 会白屏。主流产品（秘塔等）的做法是
// 服务端抓取网页、净化后同源返回，在 sandbox iframe 中渲染。
//
// 安全：
//   1. 必须携带有效 JWT（Authorization 头或 ?token=，iframe 无法自定义请求头）；
//   2. SSRF 防护：仅允许 http/https，主机解析后的 IP 不得为内网/回环/链路本地地址，
//      且每一跳重定向都重新校验；
//   3. 净化：移除脚本/事件属性/插件元素，注入 <base> 与 target=_blank，
//      前端再以无 allow-scripts 的 sandbox 渲染（双重保险）。
import { FastifyPluginAsync } from 'fastify'
import { lookup } from 'node:dns/promises'
import net from 'node:net'
import { z } from 'zod'
import { decodeAccessToken } from '../core/security.js'

export const webRoutes: FastifyPluginAsync = async (fastify) => {
  // 对应前端 getAuthHeader 的 token 获取；iframe 场景走 query
  const tokenFromReq = (req: {
    headers: { authorization?: string }
    query: { token?: string }
  }): string | null => {
    const auth = req.headers.authorization
    if (auth?.startsWith('Bearer ')) return auth.slice(7)
    return typeof req.query.token === 'string' && req.query.token ? req.query.token : null
  }

  const isBlockedIp = (ip: string): boolean => {
    // IPv4/IPv6 内网、回环、链路本地、唯一本地地址、多播等一律拒绝
    if (net.isIPv4(ip)) {
      const [a, b] = ip.split('.').map(Number)
      if (a === 10) return true
      if (a === 127) return true
      if (a === 0) return true
      if (a === 169 && b === 254) return true
      if (a === 172 && b >= 16 && b <= 31) return true
      if (a === 192 && b === 168) return true
      if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
      if (a >= 224) return true // 多播/保留
    } else if (net.isIPv6(ip)) {
      const lower = ip.toLowerCase()
      if (lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd')) return true
      if (lower.startsWith('fe80')) return true
      if (lower.startsWith('::ffff:')) return isBlockedIp(lower.slice(7))
    }
    return false
  }

  /** 解析主机 IP 并做 SSRF 校验 */
  const assertPublicHost = async (hostname: string): Promise<void> => {
    // 主机名本身是 IP 字面量时直接校验
    if (net.isIP(hostname) && isBlockedIp(hostname)) {
      throw new Error('目标地址为内网地址，禁止访问')
    }
    const records = await lookup(hostname, { all: true })
    if (records.length === 0) throw new Error('域名解析失败')
    for (const r of records) {
      if (isBlockedIp(r.address)) {
        throw new Error('目标域名解析到内网地址，禁止访问')
      }
    }
  }

  /** 手动跟随重定向（每跳重新做 SSRF 校验），返回最终 HTML */
  const fetchHtml = async (startUrl: string): Promise<{ html: string; finalUrl: string }> => {
    let current = startUrl
    for (let hop = 0; hop <= 3; hop++) {
      const u = new URL(current)
      await assertPublicHost(u.hostname)

      const resp = await fetch(current, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
            + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(12_000),
      })

      if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location')) {
        current = new URL(resp.headers.get('location')!, current).toString()
        continue
      }

      if (!resp.ok) throw new Error(`目标网页返回 ${resp.status}`)

      const contentType = resp.headers.get('content-type') ?? ''
      if (contentType && !contentType.includes('text/html') && !contentType.includes('xml')) {
        throw new Error('目标不是网页（非 HTML 内容），请在新标签页中打开')
      }

      const buf = await resp.arrayBuffer()
      // 限制 3MB，避免超大页面拖垮服务
      if (buf.byteLength > 3 * 1024 * 1024) throw new Error('网页内容过大（超过 3MB）')
      return { html: new TextDecoder().decode(buf), finalUrl: current }
    }
    throw new Error('重定向次数过多')
  }

  /**
   * 净化 HTML：
   *  - 移除 script/iframe/object/embed/form/已有 base，剥离 on* 事件与 javascript: 协议
   *  - 注入 <base>（相对资源可加载、链接相对地址可解析）
   *  - 注入阅读样式与 target=_blank
   * 配合前端 sandbox（无 allow-scripts）做双重保险
   */
  const sanitizeHtml = (html: string, baseUrl: string): string => {
    let out = html
    // 去掉危险标签及其内容
    out = out.replace(/<script[\s\S]*?<\/script>/gi, '')
    out = out.replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    out = out.replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    out = out.replace(/<(object|embed|form|link)\b[^>]*>/gi, (m, tag: string) =>
      tag === 'link' ? m : '',
    )
    // 事件属性
    out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    // javascript: 协议
    out = out.replace(/(href|src)\s*=\s*("|')\s*javascript:[\s\S]*?\2/gi, '$1="#"')

    const inject = [
      `<base href="${baseUrl.replace(/"/g, '&quot;')}" target="_blank">`,
      '<meta charset="utf-8">',
      '<style>',
      'body{margin:0;padding:20px 24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      'line-height:1.7;color:#1f2329;background:#fff;max-width:760px;margin:0 auto;word-break:break-word;}',
      'a{color:#2563eb;} img{max-width:100%;height:auto;} pre{white-space:pre-wrap;}',
      'header,footer,nav,aside{max-width:760px;}',
      '</style>',
    ].join('')

    if (/<head[^>]*>/i.test(out)) {
      out = out.replace(/<head[^>]*>/i, (m) => `${m}${inject}`)
    } else {
      out = `${inject}${out}`
    }
    return out
  }

  fastify.get('/web/preview', async (req, reply) => {
    const query = z
      .object({ url: z.string().min(1).max(2000), token: z.string().optional() })
      .safeParse(req.query)
    if (!query.success) {
      return reply.code(400).send({ code: 400, message: '缺少 url 参数' })
    }

    // 鉴权（iframe 通过 query token，直连测试通过 Authorization 头）
    const token = tokenFromReq({
      headers: { authorization: req.headers.authorization },
      query: { token: query.data.token },
    })
    const payload = token ? decodeAccessToken(token) : null
    if (!payload?.sub) {
      return reply.code(401).send({ code: 401, message: '认证令牌无效或已过期' })
    }

    let target: URL
    try {
      target = new URL(query.data.url)
    } catch {
      return reply.code(400).send({ code: 400, message: 'URL 格式不合法' })
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return reply.code(400).send({ code: 400, message: '仅支持 http/https 链接' })
    }

    try {
      const { html, finalUrl } = await fetchHtml(target.toString())
      const safeHtml = sanitizeHtml(html, finalUrl)
      reply.header('Content-Type', 'text/html; charset=utf-8')
      reply.header('Cache-Control', 'private, no-store')
      // 代理页由我们自己的前端 iframe 加载，禁止再被任意第三方嵌套
      reply.header('Content-Security-Policy', "frame-ancestors 'self' http://localhost:5173")
      return reply.send(safeHtml)
    } catch (e) {
      fastify.log.warn({ err: String(e), url: query.data.url }, 'web preview failed')
      return reply.code(502).send({
        code: 502,
        message: `网页预览失败：${(e as Error).message}，可尝试在新标签页中打开原文`,
      })
    }
  })
}
