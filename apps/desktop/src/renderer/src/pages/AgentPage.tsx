// ---- AgentPage ----

import { useState, useRef } from 'react'
import { Bot, Play, Square, Terminal, Loader2 } from 'lucide-react'
import { Button } from '../components/ui/button'
import apiClient from '../services/api/client'
import { cn } from '../lib/utils'

interface AgentLogEntry {
  id: string
  type: 'system' | 'user' | 'agent' | 'tool' | 'error'
  content: string
  timestamp: string
}

export function AgentPage(): JSX.Element {
  const [instruction, setInstruction] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [logs, setLogs] = useState<AgentLogEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const executeAgent = async () => {
    if (!instruction.trim() || isRunning) return

    setIsRunning(true)
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller

    const userEntry: AgentLogEntry = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: instruction,
      timestamp: new Date().toISOString()
    }
    setLogs((prev) => [...prev, userEntry])

    const url = `${apiClient.getBaseURL()}/agent/execute`
    const token = apiClient.getAccessToken()

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          instruction: instruction.trim(),
          stream: true
        }),
        signal: controller.signal
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data:')) continue
          const jsonStr = trimmed.slice(5).trim()
          if (jsonStr === '[DONE]') continue

          try {
            const parsed = JSON.parse(jsonStr)
            const entry: AgentLogEntry = {
              id: `log-${Date.now()}-${Math.random()}`,
              type: parsed.type || 'agent',
              content: parsed.content || parsed.message || JSON.stringify(parsed),
              timestamp: new Date().toISOString()
            }
            setLogs((prev) => [...prev, entry])
          } catch {
            // skip
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const msg = (err as Error).message
        setError(msg)
        setLogs((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            type: 'error',
            content: msg,
            timestamp: new Date().toISOString()
          }
        ])
      }
    } finally {
      setIsRunning(false)
      abortRef.current = null
      setInstruction('')
    }
  }

  const stopAgent = () => {
    abortRef.current?.abort()
    setIsRunning(false)
  }

  const logTypeStyles: Record<AgentLogEntry['type'], string> = {
    system: 'text-muted-foreground',
    user: 'text-blue-500 font-medium',
    agent: 'text-foreground',
    tool: 'text-emerald-500',
    error: 'text-red-500'
  }

  const logTypeIcons: Record<AgentLogEntry['type'], React.ReactNode> = {
    system: <Terminal className="size-3" />,
    user: <span className="text-xs">▶</span>,
    agent: <Bot className="size-3" />,
    tool: <span className="text-xs">🔧</span>,
    error: <span className="text-xs">✕</span>
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <Bot className="size-5 text-primary" />
        <h2 className="font-semibold">AI Agent 执行引擎</h2>
        <div className="flex-1" />
        {error && (
          <span className="text-xs text-red-500 max-w-[300px] truncate" title={error}>
            {error}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-sm">
        {logs.length === 0 && (
          <div className="text-center text-muted-foreground py-20">
            <Bot className="size-12 mx-auto mb-3 opacity-30" />
            <p>输入指令启动 AI Agent</p>
            <p className="text-xs mt-1">Agent 将自动分解任务、调用工具并返回结果</p>
          </div>
        )}
        {logs.map((entry) => (
          <div key={entry.id} className="flex gap-2 items-start">
            <span className={cn('mt-0.5 shrink-0', logTypeStyles[entry.type])}>
              {logTypeIcons[entry.type]}
            </span>
            <span className={cn('whitespace-pre-wrap break-words', logTypeStyles[entry.type])}>
              {entry.content}
            </span>
          </div>
        ))}
        {isRunning && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            <span>Agent 执行中...</span>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-border shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                executeAgent()
              }
            }}
            placeholder="输入任务指令，例如：'帮我分析最近一周的销售数据'..."
            disabled={isRunning}
            className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
          {isRunning ? (
            <Button onClick={stopAgent} variant="destructive" size="sm">
              <Square className="size-4 mr-1" />
              Stop
            </Button>
          ) : (
            <Button onClick={executeAgent} size="sm" disabled={!instruction.trim()}>
              <Play className="size-4 mr-1" />
              Execute
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
