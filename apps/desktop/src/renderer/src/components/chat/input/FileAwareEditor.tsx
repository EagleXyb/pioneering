// ============================================================
// FileAwareEditor — 富文本（文件感知）编辑器（对应文档 §3）
// 采用「textarea + 高亮遮罩层」方案：textarea 负责输入与光标，
// 遮罩层在背后渲染 @{} / <select-file> / <select-plugin> 为彩色 Chip，
// 既获得 contentEditable 的视觉表现，又保持 textarea 的可靠性。
// 通过 ref 暴露与文档一致的编辑器接口（focus / 选区 / 文档快照 / 插入）。
// ============================================================

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ClipboardEvent as ReactClipboardEvent
} from 'react'
import { FileText, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { parseSelectFileText } from '@/lib/input/select-file-tags'
import { deserializeEditorState, type EditorDocumentNode } from '@/lib/input/select-file-editor'

export interface FileAwareEditorHandle {
  focus: () => void
  focusAtEnd: () => void
  getSelectionOffsets: () => { start: number; end: number }
  setSelectionOffsets: (start: number, end: number) => void
  getDocumentSnapshot: () => EditorDocumentNode[]
  getPlainText: () => string
  insertText: (text: string) => void
  insertFileReference: (filePath: string, label?: string) => void
  insertPluginReference: (pluginId: string, label: string, prompt: string) => void
  /** 替换 [start,end) 区间文本并把光标置于替换后末尾 */
  replaceRange: (start: number, end: number, replacement: string) => void
  getSuggestion: () => string | null
  scrollToReference: (fileId: string) => void
}

export interface FileAwareEditorProps {
  value: string
  onChange: (value: string) => void
  onDocumentChange?: (document: EditorDocumentNode[]) => void
  onKeyDown?: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  onKeyUp?: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  onSelect?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onPaste?: (e: ReactClipboardEvent<HTMLTextAreaElement>) => void
  onFocus?: () => void
  onBlur?: () => void
  placeholder?: string
  disabled?: boolean
  suggestionText?: string | null
  autoFocus?: boolean
  maxHeight?: number
  className?: string
}

const EDITOR_TEXT_CLASS =
  'text-sm leading-relaxed font-sans whitespace-pre-wrap break-words'

export const FileAwareEditor = forwardRef<FileAwareEditorHandle, FileAwareEditorProps>(
  function FileAwareEditor(
    {
      value,
      onChange,
      onDocumentChange,
      onKeyDown,
      onKeyUp,
      onSelect,
      onPaste,
      onFocus,
      onBlur,
      placeholder,
      disabled,
      suggestionText,
      autoFocus,
      maxHeight = 240,
      className
    },
    ref
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const backdropRef = useRef<HTMLDivElement>(null)
    const pendingCaret = useRef<number | null>(null)
    const [focused, setFocused] = useState(false)

    // ---- 文档快照（供 onDocumentChange）----
    const documentNodes = useMemo(() => deserializeEditorState(value).document, [value])

    useLayoutEffect(() => {
      onDocumentChange?.(documentNodes)
    }, [documentNodes, onDocumentChange])

    // ---- 插入后恢复光标 ----
    useLayoutEffect(() => {
      if (pendingCaret.current !== null && textareaRef.current) {
        const pos = pendingCaret.current
        pendingCaret.current = null
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(pos, pos)
      }
    }, [value])

    // ---- 自动聚焦 ----
    useLayoutEffect(() => {
      if (autoFocus && textareaRef.current) {
        textareaRef.current.focus()
      }
    }, [autoFocus])

    // ---- 滚动同步（遮罩跟随 textarea）----
    const syncScroll = useCallback(() => {
      const ta = textareaRef.current
      const bd = backdropRef.current
      if (ta && bd) {
        bd.scrollTop = ta.scrollTop
        bd.scrollLeft = ta.scrollLeft
      }
    }, [])

    // ---- 选区 ----
    const getSelectionOffsets = useCallback(() => {
      const ta = textareaRef.current
      if (!ta) return { start: 0, end: 0 }
      return { start: ta.selectionStart ?? 0, end: ta.selectionEnd ?? 0 }
    }, [])

    const setSelectionOffsets = useCallback((start: number, end: number) => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(start, end)
    }, [])

    // ---- 插入辅助 ----
    const insertAt = useCallback(
      (text: string, atOffset: number | null) => {
        const ta = textareaRef.current
        const base = value
        const start = atOffset ?? ta?.selectionStart ?? base.length
        const end = atOffset ?? ta?.selectionEnd ?? base.length
        const next = base.slice(0, start) + text + base.slice(end)
        pendingCaret.current = start + text.length
        onChange(next)
      },
      [value, onChange]
    )

    useImperativeHandle(
      ref,
      (): FileAwareEditorHandle => ({
        focus: () => textareaRef.current?.focus(),
        focusAtEnd: () => {
          const ta = textareaRef.current
          if (!ta) return
          ta.focus()
          const pos = ta.value.length
          ta.setSelectionRange(pos, pos)
        },
        getSelectionOffsets,
        setSelectionOffsets,
        getDocumentSnapshot: () => deserializeEditorState(value).document,
        getPlainText: () => value,
        insertText: (text: string) => insertAt(text, null),
        insertFileReference: (filePath: string, label?: string) => {
          const token = `@{${filePath}}`
          insertAt(token, null)
          void label
        },
        insertPluginReference: (pluginId: string, label: string, prompt: string) => {
          const payload = JSON.stringify({ pluginId, label, prompt })
          insertAt(`<select-plugin>${payload}</select-plugin>`, null)
        },
        replaceRange: (start: number, end: number, replacement: string) => {
          const base = value
          const next = base.slice(0, start) + replacement + base.slice(end)
          pendingCaret.current = start + replacement.length
          onChange(next)
        },
        getSuggestion: () => suggestionText ?? null,
        scrollToReference: () => {
          /* 高亮遮罩模式下引用即文本，无需滚动定位 */
        }
      }),
      [value, getSelectionOffsets, setSelectionOffsets, insertAt, suggestionText]
    )

    // ---- 渲染高亮片段 ----
    const segments = useMemo(() => parseSelectFileText(value), [value])

    return (
      <div className={cn('relative w-full', className)}>
        {/* 高亮遮罩层（背后） */}
        <div
          ref={backdropRef}
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 overflow-hidden px-1 py-1',
            EDITOR_TEXT_CLASS,
            'text-foreground'
          )}
        >
          {segments.map((seg, i) => {
            if (seg.type === 'file') {
              return (
                <span
                  key={i}
                  className="mx-0.5 inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 align-baseline text-[0.85em] text-primary"
                >
                  <FileText className="size-3" />
                  <span className="max-w-[14rem] truncate">{seg.filePath}</span>
                </span>
              )
            }
            if (seg.type === 'plugin') {
              return (
                <span
                  key={i}
                  className="mx-0.5 inline-flex items-center gap-1 rounded bg-violet-500/10 px-1.5 py-0.5 align-baseline text-[0.85em] text-violet-500"
                >
                  <Sparkles className="size-3" />
                  <span>{seg.plugin?.label ?? seg.content}</span>
                </span>
              )
            }
            return <span key={i}>{seg.content}</span>
          })}
          {/* 占位符 */}
          {value.length === 0 && (
            <span className="text-muted-foreground/40">{placeholder}</span>
          )}
          {/* Prompt 推荐（灰色幽灵文本） */}
          {suggestionText && value.length > 0 && (
            <span className="text-muted-foreground/40">{suggestionText}</span>
          )}
          {/* 末尾补一个零宽字符，避免最后一行高度塌陷 */}
          {value.endsWith('\n') && <span>{'​'}</span>}
        </div>

        {/* 实际输入层（透明文字，保留光标） */}
        <textarea
          ref={textareaRef}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onSelect={onSelect}
          onPaste={onPaste}
          onScroll={syncScroll}
          onFocus={() => {
            setFocused(true)
            onFocus?.()
          }}
          onBlur={() => {
            setFocused(false)
            onBlur?.()
          }}
          placeholder={value.length === 0 ? placeholder : undefined}
          spellCheck={false}
          rows={1}
          className={cn(
            'relative block w-full resize-none bg-transparent px-1 py-1 outline-none',
            'text-transparent caret-foreground placeholder:text-muted-foreground/40',
            'scrollbar-thin disabled:opacity-50',
            EDITOR_TEXT_CLASS
          )}
          style={{ maxHeight }}
        />
        {/* 暴露聚焦态给父组件（用于草稿保存判断等） */}
        <span data-focused={focused} className="hidden" />
      </div>
    )
  }
)
