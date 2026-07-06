import { useState, useRef, useCallback, useEffect } from 'react'
import { Send, Square, Paperclip, AtSign, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ChatInputProps {
  onSend: (content: string) => void
  onStop: () => void
  isStreaming: boolean
  disabled: boolean
}

const quickHints = ['分析代码', '生成文档', '修复 Bug', '写测试', '解释错误']

export function ChatInput({ onSend, onStop, isStreaming, disabled }: ChatInputProps): JSX.Element {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState('')
  const [isFocused, setIsFocused] = useState(false)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const charCount = value.length
  const charLimit = 10000
  const isNearLimit = charCount > charLimit * 0.9
  const isOverLimit = charCount > charLimit

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || isStreaming || isOverLimit) return
    onSend(trimmed)
    setValue('')
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
  }, [value, isStreaming, isOverLimit, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const autoResize = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [])

  return (
    <div className="shrink-0 border-t border-border/60 bg-gradient-to-t from-background via-background to-transparent pt-2 pb-3 px-4">
      <div className="max-w-full mx-auto">
        {/* Quick action hints */}
        <div className="flex items-center gap-2 px-1 pb-2 overflow-x-auto scrollbar-none">
          {quickHints.map((hint) => (
            <button
              key={hint}
              onClick={() => setValue(hint)}
              disabled={isStreaming}
              className="shrink-0 px-2.5 py-1 text-[11px] rounded-full bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50"
            >
              {hint}
            </button>
          ))}
        </div>

        {/* Input container */}
        <div
          className={cn(
            'relative flex items-end gap-2 rounded-2xl border bg-card px-3 py-2.5 transition-all duration-200',
            isFocused
              ? 'border-primary/40 shadow-[0_0_0_1px_rgba(0,0,0,0.02)]'
              : 'border-input hover:border-muted-foreground/30'
          )}
        >
          {/* Tool buttons */}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              disabled={isStreaming}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground/50 transition-colors hover:text-muted-foreground hover:bg-accent/50 disabled:opacity-30"
              title="附加文件"
            >
              <Paperclip className="size-4" />
            </button>
            <button
              type="button"
              disabled={isStreaming}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground/50 transition-colors hover:text-muted-foreground hover:bg-accent/50 disabled:opacity-30"
              title="@提及工具/Skill"
            >
              <AtSign className="size-4" />
            </button>
            <button
              type="button"
              disabled={isStreaming}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground/50 transition-colors hover:text-muted-foreground hover:bg-accent/50 disabled:opacity-30"
              title="Agent 模式"
            >
              <Zap className="size-4" />
            </button>
          </div>

          {/* Textarea */}
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              autoResize()
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="描述你的需求，AI 将自动拆解任务并执行..."
            rows={1}
            disabled={disabled}
            className="flex-1 resize-none bg-transparent px-1 py-1 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/40 focus:outline-none disabled:opacity-50 max-h-[160px] scrollbar-thin"
          />

          {/* Send/Stop button */}
          <div className="flex items-center gap-1">
            {charCount > 0 && (
              <span
                className={cn(
                  'text-[11px] tabular-nums transition-colors',
                  isOverLimit
                    ? 'text-destructive font-medium'
                    : isNearLimit
                      ? 'text-amber-500'
                      : 'text-muted-foreground/40'
                )}
              >
                {charCount}
              </span>
            )}
            {isStreaming ? (
              <button
                onClick={onStop}
                className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-sm transition-all hover:bg-destructive/90 active:scale-95"
                title="停止生成"
              >
                <Square className="size-3.5" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!value.trim() || disabled || isOverLimit}
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-xl shadow-sm transition-all active:scale-95',
                  value.trim() && !disabled && !isOverLimit
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-muted text-muted-foreground/50 cursor-not-allowed'
                )}
                title="发送 (Enter)"
              >
                <Send className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
