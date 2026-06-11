import { useState, useCallback, useRef } from 'react'
import type { ChatMessage, StreamEvent, AgentStep, ThinkingStep, ToolCallStep, ToolResultStep, TextStreamStep, ErrorStep } from '../types'
import { StepType } from '../types'
import { agentEventBus } from './useAgentEventBus'
import { useSessionManager } from './useSessionManager'
import { useStreamParser } from './useStreamParser'
import { createChatRequest, createAgentRequest } from '../api/agentApi'

// 自增计数器，确保同一毫秒内生成的 ID 不会重复
let _idCounter = 0
function nextId(prefix: string): string {
  return `${prefix}${Date.now()}_${++_idCounter}`
}

/** 聊天模式：普通 / 专业 / 任务 */
export type ChatMode = 'normal' | 'professional' | 'task'

export function useAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [selectedModel, setSelectedModel] = useState('glm-4-flash')
  const [deepThinking, setDeepThinking] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [chatMode, setChatMode] = useState<ChatMode>('normal')

  const abortRef = useRef<AbortController | null>(null)

  const {
    currentSessionId,
    sessions,
    sessionsLoading,
    refreshSessions: fetchSessions,
    loadSession: loadSessionRaw,
    createNewSession,
    resetSession,
    removeSession,
    togglePinSession,
    renameSession,
  } = useSessionManager()

  const { applyStreamEvent } = useStreamParser(setMessages)

  const isInChatMode = messages.length > 0

  const generateTitle = useCallback((content: string): string => {
    return content.replace(/[\n\r]/g, ' ').slice(0, 30)
  }, [])

  const loadSession = useCallback(async (sessionId: string) => {
    const msgs = await loadSessionRaw(sessionId, chatMode)
    if (msgs) {
      setMessages(msgs)
    }
  }, [loadSessionRaw, chatMode])

  const handleSend = useCallback(async (value?: string) => {
    const trimmed = (value ?? inputValue).trim()
    if (!trimmed || isGenerating) return

    // 任务模式占位
    if (chatMode === 'task') {
      setInputValue('')
      const { MessagePlugin } = await import('tdesign-react')
      MessagePlugin.info('任务模式即将上线，敬请期待')
      return
    }

    setInputValue('')

    const userMsg: ChatMessage = {
      id: nextId('user_'),
      role: 'user',
      content: trimmed,
      steps: [],
      status: 'success',
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])

    const assistantMsg: ChatMessage = {
      id: nextId('assistant_'),
      role: 'assistant',
      content: '',
      steps: [],
      status: 'loading',
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, assistantMsg])

    setIsGenerating(true)

    const runId = `run_${Date.now()}`
    agentEventBus.emit('run:started', { runId })

    const abortController = new AbortController()
    abortRef.current = abortController

    try {
      let sessionId = currentSessionId
      if (!sessionId) {
        sessionId = await createNewSession(generateTitle(trimmed), selectedModel, chatMode)
      }

      const fetchSessionId = sessionId || currentSessionId

      if (chatMode === 'professional') {
        // ===== 专业模式：调用 Agent API =====
        const response = await createAgentRequest({
          sessionId: fetchSessionId,
          message: trimmed,
          stream: true,
          signal: abortController.signal,
        })

        if (!response.ok) throw new Error(`Agent请求失败: ${response.status}`)
        if (!response.body) throw new Error('无法读取Agent响应流')

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        // Agent SSE 事件 → steps 的局部解析器
        const applyAgentEvent = (parsed: Record<string, unknown>) => {
          const etype = parsed.type as string | undefined

          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (!last || last.role !== 'assistant' || last.status !== 'loading') return updated

            const steps: AgentStep[] = [...last.steps]
            let fullContent = ''

            switch (etype) {
              case 'thinking': {
                steps.push({
                  id: nextId('thinking_'),
                  type: StepType.THINKING,
                  content: (parsed.summary as string) || '',
                  status: (parsed.status as string) === 'running' ? 'streaming' : 'success',
                  startTime: Date.now(),
                  endTime: (parsed.status as string) !== 'running' ? Date.now() : undefined,
                } as ThinkingStep)
                break
              }
              case 'tool_call': {
                steps.push({
                  id: (parsed.executionId as string) || nextId('tool_'),
                  type: StepType.TOOL_CALL,
                  toolName: (parsed.toolName as string) || 'unknown',
                  arguments: (parsed.summary as string) || '',
                  status: (parsed.status as string) === 'running' ? 'streaming' : 'success',
                  startTime: Date.now(),
                } as ToolCallStep)
                break
              }
              case 'tool_result': {
                // 更新对应 tool_call 的 endTime
                const execId = parsed.executionId as string
                for (let i = steps.length - 1; i >= 0; i--) {
                  if (steps[i].type === StepType.TOOL_CALL && (steps[i] as ToolCallStep).id === execId) {
                    steps[i] = { ...steps[i], status: 'success', endTime: Date.now() } as ToolCallStep
                    break
                  }
                }
                steps.push({
                  id: `${execId || 'result'}_${steps.length}`,
                  type: StepType.TOOL_RESULT,
                  toolCallId: execId || '',
                  toolName: (parsed.toolName as string) || 'unknown',
                  result: (parsed.summary as string) || '',
                  status: 'success',
                  startTime: Date.now(),
                  endTime: Date.now(),
                } as ToolResultStep)
                break
              }
              case 'text_stream': {
                // 后端 Agent API 发送 type: "text_stream" 的增量文本
                const token = (parsed.text as string) || ''
                const existingIdx = steps.findIndex(s => s.type === StepType.TEXT_STREAM && s.status === 'streaming')
                if (existingIdx >= 0) {
                  const ts = steps[existingIdx] as TextStreamStep
                  steps[existingIdx] = { ...ts, content: ts.content + token }
                } else {
                  steps.push({
                    id: nextId('text_'),
                    type: StepType.TEXT_STREAM,
                    content: token,
                    status: 'streaming',
                    startTime: Date.now(),
                  } as TextStreamStep)
                }
                break
              }
              default: {
                // 处理无 type 字段的事件：done(空对象) / error(有 errorCode) / 未知
                if (parsed.errorCode !== undefined || parsed.message !== undefined) {
                  // error 事件: {errorCode: "...", message: "..."}
                  steps.push({
                    id: nextId('error_'),
                    type: StepType.ERROR,
                    errorCode: (parsed.errorCode as string) || 'UNKNOWN',
                    message: (parsed.message as string) || '',
                    status: 'error',
                    startTime: Date.now(),
                    recoverable: false,
                  } as ErrorStep)
                }
                // done 事件: {} 空对象，不做额外处理，后续统一标记 success
                break
              }
            }

            // 判断是否为 done（空对象或 type 为 undefined 且无 errorCode）
            const isDone = etype === undefined && parsed.errorCode === undefined

            if (isDone || etype === 'done') {
              // 标记所有 streaming step 为 success
              for (let i = steps.length - 1; i >= 0; i--) {
                if (steps[i].status === 'streaming') {
                  steps[i] = { ...steps[i], status: 'success', endTime: Date.now() }
                }
              }
            }

            fullContent = steps
              .filter(s => s.type === StepType.TEXT_STREAM)
              .map(s => (s as TextStreamStep).content)
              .join('')

            updated[updated.length - 1] = {
              ...last,
              steps,
              content: fullContent || last.content,
            }
            return updated
          })
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmedLine = line.trim()
            if (!trimmedLine || trimmedLine === ':') continue

            if (trimmedLine.startsWith('data: ')) {
              const data = trimmedLine.slice(6)
              try {
                const parsed = JSON.parse(data)
                // 跳过 metadata 消息
                if (parsed.type === '__agent_metadata__') continue
                applyAgentEvent(parsed)
              } catch {
                // 忽略解析失败的行
              }
            }
          }
        }

        agentEventBus.emit('run:finished', { runId })
      } else {
        // ===== 普通模式：调用 Chat API（现有逻辑） =====
        const response = await createChatRequest({
          sessionId: fetchSessionId,
          message: trimmed,
          model: selectedModel,
          stream: true,
          deepThinking,
          webSearch,
          signal: abortController.signal,
        })

        if (!response.ok) throw new Error(`请求失败: ${response.status}`)
        if (!response.body) throw new Error('无法读取响应流')

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmedLine = line.trim()
            if (!trimmedLine || trimmedLine === ':') continue

            if (trimmedLine.startsWith('data: ')) {
              const data = trimmedLine.slice(6)
              if (data === '[DONE]') continue

              try {
                const parsed: StreamEvent = JSON.parse(data)

                if (parsed.error) throw new Error(parsed.error)

                if (parsed.type === '__metadata__') continue

                if (parsed.type) {
                  applyStreamEvent(parsed)
                } else if (parsed.content) {
                  applyStreamEvent({ type: 'answer_delta', content: parsed.content })
                }
              } catch (parseErr) {
                if ((parseErr as Error).message !== '生成失败' && !data.includes('"type"')) {
                  try {
                    const match = data.match(/"content":\s*"([^"]*)"/)
                    if (match) {
                      const content = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')
                      applyStreamEvent({ type: 'answer_delta', content })
                    }
                  } catch {
                    // ignore
                  }
                } else {
                  throw parseErr
                }
              }
            }
          }
        }
      }

      // 标记完成
      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last && last.role === 'assistant' && last.status === 'loading') {
          updated[updated.length - 1] = {
            ...last,
            currentPhase: 'done',
            status: 'success',
          }
        }
        return updated
      })
      if (chatMode !== 'professional') {
        agentEventBus.emit('run:finished', { runId })
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return

      const errorMsg = (err as Error).message
      agentEventBus.emit('run:error', { runId, message: errorMsg })

      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last && last.role === 'assistant' && last.status === 'loading') {
          updated[updated.length - 1] = {
            ...last,
            status: 'error',
            error: (err as Error).message,
            currentPhase: 'done',
          }
        }
        return updated
      })
    } finally {
      setIsGenerating(false)
      abortRef.current = null
    }
  }, [
    inputValue, isGenerating, currentSessionId, selectedModel,
    deepThinking, webSearch, chatMode,
    generateTitle, createNewSession, applyStreamEvent,
  ])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setIsGenerating(false)
    setMessages((prev) => {
      const updated = [...prev]
      const last = updated[updated.length - 1]
      if (last && last.status === 'loading') {
        updated[updated.length - 1] = { ...last, status: 'success', currentPhase: 'done' }
      }
      return updated
    })
  }, [])

  const handleNewChat = useCallback(() => {
    setMessages([])
    resetSession()
    setInputValue('')
  }, [resetSession])

  const handleRegenerate = useCallback(() => {
    if (isGenerating) return
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUserMsg) return
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === lastUserMsg.id)
      return prev.slice(0, idx + 1)
    })
    setTimeout(() => handleSend(lastUserMsg.content), 50)
  }, [isGenerating, messages, handleSend])

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value)
  }, [])

  return {
    messages,
    isGenerating,
    inputValue,
    setInputValue,
    handleSend,
    handleStop,
    handleNewChat,
    handleRegenerate,
    handleInputChange,
    currentSessionId,
    sessions,
    sessionsLoading,
    selectedModel,
    setSelectedModel,
    deepThinking,
    setDeepThinking,
    webSearch,
    setWebSearch,
    chatMode,
    setChatMode,
    loadSession,
    fetchSessions,
    isInChatMode,
    removeSession,
    togglePinSession,
    renameSession,
  }
}
