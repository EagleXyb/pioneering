// ============================================================
// ObservationResult — 工具返回结果的智能展示
// P0：替代原本直接裸露 <pre> 原始 JSON 的渲染方式。
// - 自动检测 JSON 并提取摘要（status / summary / 截断）
// - 默认折叠，展开后展示格式化内容
// - 支持 JSON 高亮格式化与纯文本预览
// ============================================================

import { useState, useMemo } from 'react'
import { ChevronRight, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ObservationResultProps {
  /** 工具返回的原始字符串 */
  raw: string
}

/** 尝试解析 JSON，失败返回 null */
function tryParseJson(s: string): unknown | null {
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/** 从解析后的 JSON 对象中提取摘要文字 */
function extractSummary(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>

  // 优先级 1：顶层 status 字段
  const status = obj.status
  if (typeof status === 'string') {
    if (status === 'success' || status === 'completed') {
      const data = obj.data
      if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>
        // 搜索类结果：返回 N 条结果
        if (Array.isArray(d.results)) {
          return `返回 ${d.results.length} 条结果`
        }
        // datetime 类
        if (typeof d.datetime === 'string') {
          return d.datetime
        }
      }
      return '调用成功'
    }
    if (status === 'error' || status === 'failed') {
      const msg = typeof obj.message === 'string' ? obj.message : typeof obj.error === 'string' ? obj.error : ''
      return msg ? `调用失败: ${msg}` : '调用失败'
    }
  }

  // 优先级 2：summary 字段
  if (typeof obj.summary === 'string') {
    return obj.summary.slice(0, 120)
  }

  // 优先级 3：data 是数组
  if (Array.isArray(obj.data)) {
    return `返回 ${obj.data.length} 条结果`
  }

  // 优先级 4：data 含 results 数组
  if (obj.data && typeof obj.data === 'object') {
    const d = obj.data as Record<string, unknown>
    if (Array.isArray(d.results)) {
      return `返回 ${d.results.length} 条结果`
    }
  }

  return null
}

export function ObservationResult({ raw }: ObservationResultProps) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const { parsed, isJson, summary } = useMemo(() => {
    const p = tryParseJson(raw)
    if (p !== null) {
      return {
        parsed: p,
        isJson: true,
        summary: extractSummary(p) ?? raw.slice(0, 100)
      }
    }
    return { parsed: null, isJson: false, summary: raw.slice(0, 100) }
  }, [raw])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(raw)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* 静默处理 */
    }
  }

  // 空结果
  if (!raw || raw.trim() === '') {
    return (
      <div className="text-[12px] text-foreground/40 italic">(空结果)</div>
    )
  }

  return (
    <div className="rounded-md bg-muted/30 border border-border/40">
      {/* 摘要行：点击展开/收起 */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/40 rounded-md"
      >
        <ChevronRight
          className={cn(
            'size-3 shrink-0 text-foreground/40 transition-transform duration-200',
            expanded && 'rotate-90'
          )}
        />
        <span className="flex-1 min-w-0 truncate text-[12px] text-foreground/60">
          {summary}
        </span>
        <span className="shrink-0 text-[10px] text-foreground/30">
          {isJson ? 'JSON' : 'TEXT'}
        </span>
      </button>

      {/* 展开后的详情 */}
      {expanded && (
        <div className="border-t border-border/30 px-2.5 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-foreground/30">返回数据</span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 text-[10px] text-foreground/40 hover:text-foreground/70 transition-colors"
            >
              {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-[11px] text-foreground/70 leading-relaxed">
{isJson && parsed !== null ? JSON.stringify(parsed, null, 2) : raw}
          </pre>
        </div>
      )}
    </div>
  )
}
