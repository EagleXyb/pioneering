/**
 * 预览内容渲染器。逻辑对齐 web 端 apps/web/src/components/ArtifactPreview/ArtifactRender.tsx。
 *
 * 渲染策略：
 *  - html / svg：包成完整文档后塞进 <iframe srcDoc>，
 *    通过 sandbox="allow-scripts"（不给 allow-same-origin）+ 严格 CSP 做安全隔离，
 *    阻断产物访问父页面 DOM / cookie / localStorage（Electron 下同样生效）。
 *  - code：带语法高亮的代码视图 —— 基于 lowlight（rehype-highlight 的同源实现）生成
 *    hljs-* 着色，复用 index.css 中 GitHub Light/Dark 风格配色；未识别语言自动降级纯文本。
 */
import { useMemo, type ReactNode } from 'react'
import { createLowlight, common } from 'lowlight'
import type { ArtifactType } from '@shared/types'
import { MermaidRender } from './MermaidRender'

// 严格 CSP：默认禁止任何外部资源，仅放行内联脚本/样式 + data:/blob: 的媒体资源
const CSP_META =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:;\">"

function wrapHtml(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${CSP_META}</head><body>${content}</body></html>`
}

function wrapSvg(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${CSP_META}<style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#fff}</style></head><body>${content}</body></html>`
}

interface ArtifactRenderProps {
  type: ArtifactType
  content: string
  /** 代码语言（仅 type === 'code' 时用于高亮与标题展示；缺省则按纯文本渲染） */
  language?: string
}

/** lowlight.highlight 产出的 hast 节点最小结构 */
interface HastNode {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
  value?: string
}

/** 常见语言别名 → lowlight.common 注册名（含注册失败时的常见落点） */
const LANGUAGE_ALIASES: Record<string, string> = {
  py: 'python',
  py3: 'python',
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  sh: 'bash',
  zsh: 'bash',
  html: 'xml',
  html5: 'xml',
  hbs: 'markdown'
}

/** 将 lowlight 生成的 hast 树递归转换为 React 节点 */
function hastToReact(node: HastNode, keyPrefix: string): ReactNode {
  if (node.type === 'text') return node.value ?? ''
  if (node.type === 'element' && node.tagName) {
    const children = (node.children ?? []).map((c, i) => hastToReact(c, `${keyPrefix}-${i}`))
    const raw = node.properties?.className as string | string[] | undefined
    const className = Array.isArray(raw) ? raw.join(' ') : raw
    return (
      <span key={`${keyPrefix}-${node.tagName}`} className={className}>
        {children}
      </span>
    )
  }
  return null
}

// 模块级单例：避免每次渲染重建 lowlight 实例
const lowlight = createLowlight(common)

/**
 * 代码视图 —— 带语法高亮：
 *  - 代码区使用 GitHub Light/Dark 风格的 hljs-* 配色（见 index.css .artifact-view）；
 *  - 语言未识别 / 高亮失败时降级为纯文本，保证任何内容都能展示。
 */
function CodeView({ content, language }: { content: string; language?: string }) {
  const lang = LANGUAGE_ALIASES[(language ?? '').toLowerCase()] ?? (language && language !== 'code' ? language.toLowerCase() : '')

  const highlighted = useMemo<ReactNode>(() => {
    if (!lang || !lowlight.registered(lang)) return null
    try {
      const tree = lowlight.highlight(lang, content)
      return (tree.children ?? []).map((c, i) => hastToReact(c, `hl-${i}`))
    } catch {
      return null
    }
  }, [lang, content])

  return (
    <pre className="artifact-view m-0 h-full min-h-0 w-full overflow-auto p-4 font-mono text-[13px] leading-[1.65] tab-size-4 bg-gray-50 text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
      <code>{highlighted ?? content}</code>
    </pre>
  )
}

export function ArtifactRender({ type, content, language }: ArtifactRenderProps) {
  const srcDoc = useMemo(() => {
    if (type === 'html') return wrapHtml(content)
    if (type === 'svg') return wrapSvg(content)
    return ''
  }, [type, content])

  // P2：mermaid 分支 —— 动态导入渲染矢量图，失败自动降级源码视图
  if (type === 'mermaid') {
    return <MermaidRender content={content} />
  }

  // iframe key 绑内容：内容变化即重建 iframe，避免上一产物的 DOM 状态残留
  if (type === 'html' || type === 'svg') {
    return (
      <iframe
        key={content}
        title={type === 'svg' ? 'SVG 预览' : 'HTML 预览'}
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        className="h-full w-full border-0 bg-white"
      />
    )
  }

  return <CodeView content={content} language={language} />
}
