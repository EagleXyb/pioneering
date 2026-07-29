// ============================================================
// MermaidRender — Mermaid 图表渲染器（P2 新增）
// ============================================================
// 渲染策略：
//   - mermaid 为 ~1MB 的大依赖，按需动态 import()，由 Vite 自动代码分包，
//     不进入首屏 bundle；仅在用户打开 mermaid 预览时加载。
//   - securityLevel: 'strict' —— 禁用 htmlLabels / 脚本 / 交互回调，
//     产出纯矢量 SVG，无脚本执行面。
//   - 产出的 SVG 经 innerHTML 注入（strict 模式下 mermaid 官方认可的用法），
//     容器为预览面板内部，不影响对话区布局。
//
// 降级策略（任一环节失败均不阻断）：
//   1. 动态 import 失败（离线 / 包损坏）→ 错误横幅 + 源码视图
//   2. 语法解析失败（非法 mermaid 源码）→ 错误横幅 + 源码视图
//   3. 组件卸载竞态（content 快速切换）→ cancelled 标志阻断迟到的写入
// ============================================================

import { useEffect, useRef, useState } from 'react'

// 模块级递增序号：保证 mermaid.render 的临时容器 id 全局唯一，避免并发冲突
let mermaidIdSeq = 0

interface MermaidRenderProps {
  content: string
}

export function MermaidRender({ content }: MermaidRenderProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({
          startOnLoad: false,
          // 严格模式：禁 html 标签 / 脚本 / click 交互，产出纯矢量 SVG
          securityLevel: 'strict',
          // 预览面板为白色底（与 ArtifactRender iframe 分支一致），用 neutral 主题
          theme: 'neutral'
        })
        const { svg } = await mermaid.render(`mermaid-preview-${++mermaidIdSeq}`, content)
        if (cancelled) return
        if (containerRef.current) {
          containerRef.current.innerHTML = svg
        }
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [content])

  // 降级：解析/加载失败 → 错误提示 + 源码纯文本视图（与 code 产物视图一致）
  if (error) {
    return (
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          图表解析失败，已降级显示源码：{error}
        </div>
        <pre className="m-0 min-h-0 flex-1 overflow-auto bg-muted p-4 font-mono text-xs leading-relaxed text-foreground">
          <code>{content}</code>
        </pre>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full overflow-auto bg-white p-4">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          图表渲染中…
        </div>
      )}
      <div
        ref={containerRef}
        className="flex min-h-full items-center justify-center [&>svg]:h-auto [&>svg]:max-w-full"
      />
    </div>
  )
}
