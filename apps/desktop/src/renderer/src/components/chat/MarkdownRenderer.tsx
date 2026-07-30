// ============================================================
// MarkdownRenderer — 对话区统一 Markdown 渲染器（P0 修复）
// ============================================================
// 背景：此前 MessageBubble（非 trace 路径）与 TraceNodeView（trace 路径）
// 各自维护一份 ReactMarkdown 配置，trace 路径缺失 rehype-highlight /
// rehype-sanitize / SafeLink / CodeBlock，导致语法高亮丢失，并存在
// 原始 HTML 注入（XSS）与危险链接（javascript: 等）缺口。
//
// 本组件把两份配置归一，两条路径共享同一渲染器：
//   - sanitizeSchema / SafeLink 从 MessageBubble 原样迁移（H7 安全策略不变）
//   - CodeBlock 重新设计：折叠/复制/全屏预览，优化布局与可读性
//
// 行为保证：非 trace 路径渲染产物与迁移前完全一致；trace 路径在相同内容下
// 获得与非 trace 路径一致的安全与渲染能力。不改变任何布局外壳与样式类名。
// ============================================================

import { memo, useMemo, useState, useCallback, Fragment } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize from 'rehype-sanitize'
import { defaultSchema, type Schema as SanitizeSchema } from 'hast-util-sanitize'
import { useSetAtom } from 'jotai'
import { Copy, Check, Maximize2, ChevronUp, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { openArtifactAtom } from '@/stores/artifactStore'
import { openLightboxAtom } from '@/stores/lightboxStore'
import { getHastText, previewableLanguage, getCodeLanguage } from '@/lib/extractCodeBlocks'
import { extractEmbeddedToolResults } from '@/lib/embedded-tool-results'
import { ToolResultRenderer } from './ToolResultRenderer'
import { cn } from '@/lib/utils'
import type { ArtifactType } from '@shared/types'

// H7: 自定义 sanitize schema —— 在默认安全白名单基础上保留
// GFM 表格与 rehype-highlight 高亮所需的 className（语言/ token 着色），
// 同时限制 href 仅允许 http(s):// / mailto 协议，剥离 on* 事件与危险协议。
// （与 MessageBubble 迁移前的内联定义逐行一致）
const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [
      ...((defaultSchema.attributes as Record<string, unknown> | undefined)?.[
        '*'
      ] as string[] | undefined) ?? [],
      'className'
    ],
    code: [
      ...((defaultSchema.attributes as Record<string, unknown> | undefined)?.[
        'code'
      ] as string[] | undefined) ?? [],
      'className'
    ],
    span: [
      ...((defaultSchema.attributes as Record<string, unknown> | undefined)?.[
        'span'
      ] as string[] | undefined) ?? [],
      'className'
    ],
    a: [
      ...((defaultSchema.attributes as Record<string, unknown> | undefined)?.[
        'a'
      ] as string[] | undefined) ?? [],
      'href',
      'target',
      'rel'
    ]
  },
  protocols: {
    // 限制所有 href 属性仅允许安全协议（默认含 irc/ircs/xmpp，这里收紧为 http(s)/mailto）
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto']
  }
}

// H7: 渲染阶段对链接 href 再做一次白名单，仅放行 http(s)://；
// 其它（如 javascript: / 相对危险链接）降级为纯文本，阻断 XSS 跳转/脚本执行。
// （与 MessageBubble 迁移前的内联实现逐行一致）
function SafeLink({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const safe = typeof href === 'string' && /^https?:\/\//i.test(href)
  if (!safe) {
    // 非安全链接降级为纯文本（剥离锚点）；将剩余属性断言为 span 属性后再展开，
    // 避免 JSX 内联 as 转换的解析歧义。
    const spanProps = props as React.HTMLAttributes<HTMLSpanElement>
    return <span {...spanProps}>{children}</span>
  }
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
      {children}
    </a>
  )
}

// P1: AI 回复内嵌图片的安全渲染。
// - 协议白名单：rehype-sanitize 默认 schema 已将 img src 限制为 http/https，
//   这里再显式拦截其它协议（含被剥离 src 后的空值），三重防御；
// - 布局保护：此前远程 <img> 无任何尺寸约束，可能撑破气泡；补 max-w-full；
// - 交互：点击经 Lightbox 应用内放大（替代浏览器新窗口，避免离开应用上下文）。
function SafeImage({ node: _node, src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { node?: unknown }) {
  const openLightbox = useSetAtom(openLightboxAtom)
  const url = typeof src === 'string' ? src : ''
  if (!/^https?:\/\//i.test(url)) {
    // 非安全/缺失 src：不渲染破损图片，降级为占位文本（保持文档流不断裂）
    return alt ? <span className="text-muted-foreground">[{alt}]</span> : null
  }
  return (
    <img
      src={url}
      alt={alt ?? ''}
      loading="lazy"
      {...props}
      className="my-2 max-w-full cursor-zoom-in rounded-lg border border-border/60"
      onClick={() => openLightbox(url)}
    />
  )
}

interface MarkdownRendererProps {
  /** Markdown 源文 */
  content: string
  /**
   * 来源消息 id：代码块「预览」→ openArtifact → 「跳转源消息」反向联动用。
   * 非 trace 路径传 message.id；trace 路径由 text 节点 id（`${msgId}::text`）推导。
   * 缺省时预览功能仍可用，仅跳转源消息退化为无操作。
   */
  messageId?: string
  /**
   * 是否跳过正文中嵌入的工具结果JSON（直接删除不渲染）。
   * 当上方已有 AgentTimeline / TraceNodeView 折叠框展示了相同结果时置 true，避免重复。
   */
  skipEmbeddedResults?: boolean
}

/**
 * 单个代码块组件 —— 支持折叠、复制、全屏预览
 */
function CodeBlockComponent({
  raw,
  language,
  previewLang,
  children,
  className,
  messageId,
  codeProps
}: {
  raw: string
  language: string
  previewLang: 'html' | 'svg' | 'mermaid' | null
  children: React.ReactNode
  className?: string
  messageId?: string
  codeProps: Record<string, unknown>
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [copied, setCopied] = useState(false)
  const openArtifact = useSetAtom(openArtifactAtom)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(raw)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* 复制失败静默处理 */
    }
  }, [raw])

  const handleFullscreen = useCallback(() => {
    // 确定预览类型：html/svg/mermaid 保持原类型，其他统一用 code
    const artifactType: ArtifactType = previewLang ?? 'code'
    openArtifact({
      messageId: messageId ?? '',
      type: artifactType,
      content: raw,
      language: language || 'code'
    })
  }, [raw, language, previewLang, messageId, openArtifact])

  const toggleCollapse = useCallback(() => {
    setCollapsed(prev => !prev)
  }, [])

  return (
    <div className="group/code w-full min-w-0 max-w-none my-3 rounded-xl border border-border/50 bg-white dark:bg-zinc-900">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between bg-gray-100 dark:bg-zinc-700/90 h-[38px] px-3 border-b border-border/60">
        {/* 左侧：语言标识 + 折叠按钮 */}
        <div className="flex items-center gap-1">
          <span className="font-mono text-[11px] font-medium text-muted-foreground select-none">
            {language}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-[5px] text-muted-foreground hover:text-foreground hover:bg-gray-200/60 dark:hover:bg-zinc-700/60"
                onClick={toggleCollapse}
                aria-label={collapsed ? '展开代码' : '收起代码'}
              >
                {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{collapsed ? '展开' : '收起'}</TooltipContent>
          </Tooltip>
        </div>

        {/* 右侧操作按钮：复制 + 全屏 */}
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-[5px] text-muted-foreground hover:text-foreground hover:bg-gray-200/60 dark:hover:bg-zinc-700/60"
                onClick={handleCopy}
                aria-label={copied ? '已复制' : '复制代码'}
              >
                {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{copied ? '已复制' : '复制'}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-[5px] text-muted-foreground hover:text-foreground hover:bg-gray-200/60 dark:hover:bg-zinc-700/60"
                onClick={handleFullscreen}
                aria-label="全屏预览"
              >
                <Maximize2 className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">全屏预览</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* 代码区域：使用 grid-template-rows 0fr/1fr 精确折叠过渡（避免 max-h 数值钳制导致大代码块溢出到后续内容） */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: collapsed ? '0fr' : '1fr' }}
      >
        <div className="min-h-0 overflow-hidden">
          <pre className="code-block-pre overflow-x-auto p-4 bg-white dark:bg-zinc-900">
            <code className={className} {...codeProps}>{children}</code>
          </pre>
        </div>
      </div>
    </div>
  )
}

/**
 * 嵌入在正文中的工具返回结果 —— 委托给 ToolResultRenderer（embedded 变体）。
 * 搜索结果直接显示为灰色卡片列表，时间结果显示为芯片，其他结果折叠展示。
 */
function EmbeddedToolResult({ raw }: { raw: string }) {
  return <ToolResultRenderer raw={raw} variant="embedded" />
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  messageId,
  skipEmbeddedResults = false
}: MarkdownRendererProps) {
  /**
   * 自定义代码块渲染：
   * - pre 由调用方透传，避免默认 <pre> 再次包裹自定义卡片结构（div 不能嵌在 pre 内）。
   * - 行内代码（无 language、无换行）→ 原样渲染；围栏代码块 → 带标题栏的卡片，
   *   支持复制、折叠、全屏预览（所有代码类型均可在 ArtifactPanel 中预览）。
   */
  const CodeBlock = useMemo(
    () =>
      function CodeBlock({ node, className, children, ...rest }: any) {
        const raw = getHastText(node)
        const previewLang = previewableLanguage(className)
        const hasLang = Boolean(className && /language-/.test(className))
        const isBlock = hasLang || raw.includes('\n')
        if (!isBlock) {
          return <code className={className} {...rest}>{children}</code>
        }
        const displayLang = hasLang ? getCodeLanguage(className) : 'code'
        return (
          <CodeBlockComponent
            raw={raw}
            language={displayLang}
            previewLang={previewLang}
            className={className}
            messageId={messageId}
            codeProps={rest}
          >
            {children}
          </CodeBlockComponent>
        )
      },
    [messageId]
  )

  // 将文本切分为「纯文本段」和「嵌入工具结果段」。若没有任何嵌入JSON，
  // 直接走原始 ReactMarkdown 渲染路径（零开销，零行为变化）。
  const segments = useMemo(() => extractEmbeddedToolResults(content), [content])
  const hasEmbedded = segments.some(s => s.type === 'toolResult')

  if (!hasEmbedded) {
    return (
      <div className="chat-markdown max-w-none break-words">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight, [rehypeSanitize, sanitizeSchema]]}
          components={{ a: SafeLink, img: SafeImage, pre: ({ children }) => <>{children}</>, code: CodeBlock }}
        >
          {content}
        </ReactMarkdown>
      </div>
    )
  }

  // skipEmbeddedResults=true：直接剔除工具结果JSON，只把文本段拼接后交给 ReactMarkdown 一次渲染
  if (skipEmbeddedResults) {
    const cleanText = segments
      .filter((s): s is Extract<typeof s, { type: 'text' }> => s.type === 'text')
      .map(s => s.content)
      .join('')
    return (
      <div className="chat-markdown max-w-none break-words">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight, [rehypeSanitize, sanitizeSchema]]}
          components={{ a: SafeLink, img: SafeImage, pre: ({ children }) => <>{children}</>, code: CodeBlock }}
        >
          {cleanText}
        </ReactMarkdown>
      </div>
    )
  }

  // 默认：有嵌入JSON时，逐段渲染——文本段交给 ReactMarkdown，工具结果段智能展示。
  return (
    <div className="chat-markdown max-w-none break-words">
      {segments.map((seg, idx) => {
        if (seg.type === 'toolResult') {
          return <EmbeddedToolResult key={idx} raw={seg.raw} />
        }
        return (
          <Fragment key={idx}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight, [rehypeSanitize, sanitizeSchema]]}
              components={{ a: SafeLink, img: SafeImage, pre: ({ children }) => <>{children}</>, code: CodeBlock }}
            >
              {seg.content}
            </ReactMarkdown>
          </Fragment>
        )
      })}
    </div>
  )
})
