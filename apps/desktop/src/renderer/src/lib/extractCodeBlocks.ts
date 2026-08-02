/**
 * 代码块提取与可预览判定。
 * 逻辑对齐 web 端 apps/web/src/components/ArtifactPreview/extractCodeBlocks.ts。
 *
 * 桌面端要点：MessageBubble 直接基于 ReactMarkdown（rehype-highlight 已应用）渲染，
 * 无法像 web 端那样事先切分文本/代码段，因此这里额外提供 getHastText：
 * 从已高亮的 hast 节点递归提取纯文本，用于「预览」按钮读取原始代码内容。
 */

/**
 * 可进入预览的语言：html / svg（iframe 沙箱），mermaid（矢量图渲染）。
 * 其余语言一律按纯文本 code 渲染。
 */
export function isPreviewable(language: string): boolean {
  return language === 'html' || language === 'svg' || language === 'mermaid'
}

/** 从 className="language-xxx" 解析语言并转小写 */
export function getCodeLanguage(className?: string): string {
  const raw = className?.match(/language-(\w[\w+-]*)/)?.[1] ?? ''
  return raw.toLowerCase()
}

/**
 * 取出可预览语言（html/svg/mermaid），否则返回 null —— 供 ReactMarkdown code 组件判定。
 * mermaid 预览默认开启（降级路径安全：动态导入/解析失败均回退源码视图）。
 */
export function previewableLanguage(className?: string): 'html' | 'svg' | 'mermaid' | null {
  const lang = getCodeLanguage(className)
  return isPreviewable(lang) ? (lang as 'html' | 'svg' | 'mermaid') : null
}

/**
 * 从 hast 节点递归提取纯文本。
 * rehype-highlight 会把代码包进 span.hljs-*，但文本节点（node.type==='text'）
 * 仍保留原始字符，故逐层拼接即可还原代码内容，与是否高亮无关。
 */
export function getHastText(node: unknown): string {
  if (!node) return ''
  const n = node as { type?: string; value?: string; children?: unknown[] }
  if (n.type === 'text' || n.type === 'raw') return n.value ?? ''
  if (Array.isArray(n.children)) {
    return n.children.map((c) => getHastText(c)).join('')
  }
  return ''
}
