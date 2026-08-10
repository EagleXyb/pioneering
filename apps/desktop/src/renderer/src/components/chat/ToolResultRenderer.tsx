// ============================================================
// ToolResultRenderer — 工具返回结果的共享渲染器
// 被 ObservationResult（timeline 路径）和 EmbeddedToolResultCard
// （正文嵌入路径）共同使用，保证两处渲染行为一致。
//
// 根据结果类型自动选择渲染方式：
//   - search → 浅灰圆角卡片 + 彩色来源图标 + 标题列表（WorkBuddy 风格）
//   - datetime → 内联时间芯片
//   - 其他/未知 → 折叠式 JSON 展示
// ============================================================

import { useState, useMemo, useCallback } from 'react'
import { ChevronRight, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type SearchResultItem,
  type ParsedToolResult,
  classifyRawResult,
  genericResultSummary,
  getFaviconColor,
  getFaviconLetter,
  getDomainFromUrl
} from '@/lib/embedded-tool-results'

// ---- 搜索结果卡片 ----

export function SearchResultsCard({ results, source }: { results: SearchResultItem[]; source?: string }) {
  const [showRaw, setShowRaw] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      const text = results.map((r, i) => `${i + 1}. ${r.title}${r.url ? `\n   ${r.url}` : ''}`).join('\n')
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }, [results])

  return (
    <div className="my-1 rounded-xl bg-muted/70 px-3 py-2">
      <ul className="space-y-1.5">
        {results.map((item, idx) => {
          const key = item.url || item.source || item.title || String(idx)
          const color = getFaviconColor(key)
          const letter = getFaviconLetter(item.title, item.url)
          const titleEl = (
            <span className="text-[13px] leading-snug text-foreground/80 hover:text-foreground transition-colors">
              {item.title}
            </span>
          )
          return (
            <li key={idx} className="flex items-start gap-2 min-w-0">
              <span
                className="mt-0.5 shrink-0 size-4 rounded-[4px] flex items-center justify-center text-[9px] font-bold select-none"
                style={{ backgroundColor: color.bg, color: color.fg }}
                title={item.url ? getDomainFromUrl(item.url) : item.source}
              >
                {letter}
              </span>
              {item.url && /^https?:\/\//i.test(item.url) ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="min-w-0 flex-1 hover:underline underline-offset-2 decoration-foreground/20"
                  onClick={(e) => e.stopPropagation()}
                >
                  {titleEl}
                </a>
              ) : (
                <span className="min-w-0 flex-1">{titleEl}</span>
              )}
            </li>
          )
        })}
      </ul>
      <div className="mt-2 pt-1.5 border-t border-border/40 flex items-center justify-between">
        <span className="text-[11px] text-foreground/40">
          {source ? `来源：${source}` : `共 ${results.length} 条结果`}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-0.5 text-[11px] text-foreground/40 hover:text-foreground/70 transition-colors px-1 py-0.5 rounded"
          >
            {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
            {copied ? '已复制' : '复制'}
          </button>
          <button
            type="button"
            onClick={() => setShowRaw(v => !v)}
            className="flex items-center gap-0.5 text-[11px] text-foreground/40 hover:text-foreground/70 transition-colors px-1 py-0.5 rounded"
          >
            <ChevronRight
              className={cn('size-3 transition-transform duration-200', showRaw && 'rotate-90')}
            />
            原始数据
          </button>
        </div>
      </div>
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          showRaw ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">
          <pre className="mt-1.5 max-h-60 overflow-auto rounded-lg bg-background/60 p-2 font-mono text-[10px] text-foreground/60 leading-relaxed">
{JSON.stringify(results, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  )
}

// ---- 时间芯片 ----

export function DatetimeChip({ datetime }: { datetime: string }) {
  return (
    <div className="my-1 inline-flex items-center gap-1 rounded-lg bg-muted/50 px-2 py-0.5 text-[12px] text-foreground/70">
      <span className="size-1 rounded-full bg-foreground/30" />
      <span>当前时间：</span>
      <span className="font-medium tabular-nums text-foreground/80">{datetime}</span>
    </div>
  )
}

// ---- 通用折叠 JSON ----

export function GenericJsonCard({
  raw,
  parsed,
  defaultSummary,
  variant = 'timeline'
}: {
  raw: string
  parsed: unknown
  defaultSummary: string
  /** timeline: 无边框轻量样式；embedded: 带边框卡片样式 */
  variant?: 'timeline' | 'embedded'
}) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const formatted = useMemo(() => {
    try { return JSON.stringify(parsed, null, 2) } catch { return raw }
  }, [parsed, raw])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formatted)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }, [formatted])

  if (variant === 'embedded') {
    return (
      <div className="my-1.5 rounded-xl border border-border/40 bg-muted/20 overflow-hidden">
        <div className="flex items-center justify-between px-2.5 py-1.5 hover:bg-muted/40 transition-colors">
          <button
            className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors min-w-0 flex-1"
            onClick={() => setExpanded(v => !v)}
          >
            <ChevronRight
              className={cn('size-3 shrink-0 transition-transform duration-200', expanded && 'rotate-90')}
            />
            <span className="truncate">{defaultSummary}</span>
          </button>
          <button
            onClick={handleCopy}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
          >
            {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
          </button>
        </div>
        <div
          className={cn(
            'grid transition-[grid-template-rows] duration-200 ease-out',
            expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <pre className="overflow-x-auto p-2.5 text-[11px] leading-relaxed bg-muted/10 border-t border-border/30">
              <code className="font-mono">{formatted}</code>
            </pre>
          </div>
        </div>
      </div>
    )
  }

  // timeline 轻量样式
  return (
    <div className="my-0.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex flex-1 items-center gap-1 py-0.5 text-left transition-opacity hover:opacity-70 rounded"
        >
          <ChevronRight
            className={cn('size-3 shrink-0 text-foreground/30 transition-transform duration-200', expanded && 'rotate-90')}
          />
          <span className="min-w-0 truncate text-[12px] text-foreground/55">{defaultSummary}</span>
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleCopy() }}
          className="shrink-0 text-foreground/30 hover:text-foreground/60 transition-colors p-0.5 rounded"
        >
          {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
        </button>
      </div>
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words pl-3 font-mono text-[11px] text-foreground/55 leading-relaxed">
{formatted}
          </pre>
        </div>
      </div>
    </div>
  )
}

// ---- 统一入口：自动判别并渲染 ----

export function ToolResultRenderer({
  raw,
  variant = 'timeline'
}: {
  raw: string
  variant?: 'timeline' | 'embedded'
}) {
  if (!raw || raw.trim() === '') {
    return <div className="text-[12px] text-foreground/40 italic">(空结果)</div>
  }

  const { parsed, classified } = classifyRawResult(raw)

  // 非JSON文本：直接展示
  if (parsed === null) {
    return (
      <div className={cn(
        'whitespace-pre-wrap break-words leading-relaxed',
        variant === 'embedded' ? 'my-3 text-[14px] text-foreground/80' : 'my-1.5 text-[13px] text-foreground/70'
      )}>
        {raw}
      </div>
    )
  }

  if (classified?.kind === 'search') {
    return <SearchResultsCard results={classified.results} source={classified.source} />
  }

  if (classified?.kind === 'datetime') {
    return <DatetimeChip datetime={classified.datetime} />
  }

  return (
    <GenericJsonCard
      raw={raw}
      parsed={parsed}
      defaultSummary={genericResultSummary(parsed, raw)}
      variant={variant}
    />
  )
}
