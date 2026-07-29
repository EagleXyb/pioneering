/**
 * 预览内容渲染器。逻辑对齐 web 端 apps/web/src/components/ArtifactPreview/ArtifactRender.tsx。
 *
 * 渲染策略：
 *  - html / svg：包成完整文档后塞进 <iframe srcDoc>，
 *    通过 sandbox="allow-scripts"（不给 allow-same-origin）+ 严格 CSP 做安全隔离，
 *    阻断产物访问父页面 DOM / cookie / localStorage（Electron 下同样生效）。
 *  - code：纯文本 <pre><code>，不引入额外高亮依赖（与 web 一致）。
 */
import { useMemo } from 'react'
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
}

export function ArtifactRender({ type, content }: ArtifactRenderProps) {
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

  return (
    <pre className="m-0 h-full w-full overflow-auto bg-muted p-4 font-mono text-xs leading-relaxed text-foreground">
      <code>{content}</code>
    </pre>
  )
}
