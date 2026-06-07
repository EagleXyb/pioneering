import { useState, useCallback, useRef, useEffect } from 'react'
import type {
  ChatMessage,
  ChatSession,
  StreamEvent,
  AgentStep,
  ThinkingStep,
  ToolCallStep,
  ToolResultStep,
  TextStreamStep,
  ReasoningIterationStep,
  ErrorStep,
} from '../types'
import { StepType, type StepTypeValue } from '../types'
import { agentEventBus } from './useAgentEventBus'
import { API_ENDPOINTS } from '@shared/api/endpoints'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token') || ''
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' }
}

function rebuildAnswerContent(steps: AgentStep[]): string {
  return steps
    .filter(s => s.type === StepType.TEXT_STREAM)
    .map(s => (s as TextStreamStep).content)
    .join('')
}

export function useAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState('deepseek-v4-flash')
  const [deepThinking, setDeepThinking] = useState(false)
  const [webSearch, setWebSearch] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  const isInChatMode = messages.length > 0

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom()
    }
  }, [messages, scrollToBottom])

  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.SESSIONS}`, {
        headers: authHeaders(),
      })
      if (res.ok) {
        const data = await res.json()
        const raw = Array.isArray(data) ? data : (data.sessions || [])
        const mapped: ChatSession[] = raw.map((s: Record<string, unknown>) => ({
          id: s.id as string,
          title: s.title as string,
          model: s.model as string,
          messageCount: (s.message_count ?? s.messageCount ?? 0) as number,
          createdAt: (s.created_at ?? s.createdAt ?? '') as string,
          updatedAt: (s.updated_at ?? s.updatedAt ?? '') as string,
        }))
        setSessions(mapped)
      }
    } catch {
      console.error('获取会话列表失败')
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  const loadSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(
        `${API_BASE_URL}${API_ENDPOINTS.CHAT.MESSAGES(sessionId)}`,
        { headers: authHeaders() },
      )
      if (res.ok) {
        const rawData: Array<Record<string, unknown>> = await res.json()

        const data = rawData.map((m: Record<string, unknown>) => ({
          id: m.id as string,
          sessionId: m.session_id as string,
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content as string,
          thinkingContent: (m.thinking_content ?? m.thinkingContent ?? '') as string,
          answerContent: (m.answer_content ?? m.answerContent ?? '') as string,
          toolCalls: (m.tool_calls ?? m.toolCalls ?? []) as Array<{
            id: string
            name: string
            arguments: string
            result?: string
            status: 'pending' | 'running' | 'success' | 'error'
          }>,
          createdAt: (m.created_at ?? m.createdAt ?? '') as string,
        }))

        const msgs: ChatMessage[] = data.map(m => {
          const steps: AgentStep[] = []

          if (m.thinkingContent) {
            steps.push({
              id: `thinking_${m.id}`,
              type: StepType.THINKING,
              content: m.thinkingContent,
              status: 'success',
              startTime: new Date(m.createdAt).getTime(),
              endTime: new Date(m.createdAt).getTime(),
            } as ThinkingStep)
          }

          if (m.toolCalls && m.toolCalls.length > 0) {
            for (const tc of m.toolCalls) {
              steps.push({
                id: tc.id,
                type: StepType.TOOL_CALL,
                toolName: tc.name,
                arguments: tc.arguments,
                status: tc.status === 'pending' || tc.status === 'running' ? 'streaming' : tc.status === 'error' ? 'error' : 'success',
                startTime: new Date(m.createdAt).getTime(),
                endTime: tc.result ? new Date(m.createdAt).getTime() : undefined,
              } as ToolCallStep)

              if (tc.result) {
                steps.push({
                  id: `${tc.id}_result`,
                  type: StepType.TOOL_RESULT,
                  toolCallId: tc.id,
                  toolName: tc.name,
                  result: tc.result,
                  status: 'success',
                  startTime: new Date(m.createdAt).getTime(),
                  endTime: new Date(m.createdAt).getTime(),
                } as ToolResultStep)
              }
            }
          }

          if (m.answerContent) {
            steps.push({
              id: `text_${m.id}`,
              type: StepType.TEXT_STREAM,
              content: m.answerContent,
              status: 'success',
              startTime: new Date(m.createdAt).getTime(),
              endTime: new Date(m.createdAt).getTime(),
            } as TextStreamStep)
          }

          return {
            id: `db_${m.id}`,
            role: m.role,
            content: m.content,
            steps,
            status: 'success',
            timestamp: new Date(m.createdAt).getTime(),
            thinkingContent: m.thinkingContent,
            answerContent: m.answerContent,
            toolCalls: m.toolCalls,
          }
        })
        setMessages(msgs)
        setCurrentSessionId(sessionId)
      }
    } catch {
      console.error('加载会话消息失败')
    }
  }, [])

  const generateTitle = useCallback((content: string): string => {
    return content.replace(/[\n\r]/g, ' ').slice(0, 30)
  }, [])

  function emitEventBusEvent(event: StreamEvent) {
    const runId = (event as unknown as Record<string, unknown>).trace_id as string || ''
    switch (event.type) {
      case 'status':
        if (event.status) {
          const phaseMap: Record<string, string> = {
            perception: 'phase:perception',
            memory: 'phase:memory',
            thinking: 'phase:thinking',
            tool_calling: 'phase:tool_calling',
            generating: 'phase:generating',
            done: 'phase:done',
          }
          const phaseEvent = phaseMap[event.status]
          if (phaseEvent) {
            agentEventBus.emit(phaseEvent as import('./useAgentEventBus').AgentRunEventType, { runId })
          }
        }
        break
      case 'thinking_delta':
        agentEventBus.emit('thinking:delta', { delta: event.content || '', runId })
        break
      case 'thinking_done':
        agentEventBus.emit('thinking:completed', { runId })
        break
      case 'tool_call_start':
        agentEventBus.emit('tool_call:started', {
          toolName: event.name || 'unknown',
          toolId: event.id || '',
          runId,
        })
        break
      case 'tool_call_end':
        agentEventBus.emit('tool_call:completed', {
          toolName: event.name || 'unknown',
          toolId: event.id || '',
          runId,
        })
        break
      case 'tool_result_end':
        agentEventBus.emit('tool_result:received', {
          toolName: event.name || 'unknown',
          toolId: event.id || '',
          status: event.errorCode ? 'error' : 'success',
          runId,
        })
        break
      case 'answer_delta':
        agentEventBus.emit('answer:delta', { delta: event.content || '', runId })
        break
      case 'answer_done':
        agentEventBus.emit('answer:completed', { runId })
        break
      case 'reasoning_iteration':
        agentEventBus.emit('reasoning:iteration', {
          iteration: event.iterationIndex || 1,
          maxIterations: event.maxIterations || 3,
          runId,
        })
        break
      case 'error':
        agentEventBus.emit('error:occurred', {
          errorCode: event.errorCode || 'UNKNOWN',
          message: event.message || event.error || '未知错误',
          runId,
        })
        break
    }
  }

  const applyStreamEvent = useCallback((event: StreamEvent) => {
    setMessages((prev) => {
      const updated = [...prev]
      const last = updated[updated.length - 1]
      if (!last || last.role !== 'assistant' || last.status !== 'loading') return updated

      const steps: AgentStep[] = [...last.steps]
      const stepId = event.stepId

      switch (event.type) {
        case 'status': {
          if (event.status) {
            const statusToPhase: Record<string, StepTypeValue> = {
              perception: StepType.THINKING,
              memory: StepType.THINKING,
              reasoning: StepType.THINKING,
              tool_calling: StepType.TOOL_CALL,
              generating: StepType.TEXT_STREAM,
              done: StepType.TEXT_STREAM,
            }
            const phase = statusToPhase[event.status]
            if (phase) {
              const id = `phase_${phase}_${Date.now()}`
              if (!steps.some(s => s.id === id && s.status === 'streaming')) {
                steps.push({
                  id,
                  type: phase,
                  content: '',
                  status: 'pending',
                  startTime: Date.now(),
                  toolName: phase === StepType.TOOL_CALL ? '' : undefined,
                  arguments: phase === StepType.TOOL_CALL ? '' : undefined,
                } as unknown as AgentStep)
              }
            }
          }
          break
        }

        case 'thinking_delta': {
          if (stepId) {
            const idx = steps.findIndex(s => s.id === stepId)
            if (idx >= 0 && steps[idx].type === StepType.THINKING) {
              const t = steps[idx] as ThinkingStep
              steps[idx] = { ...t, content: t.content + (event.content || ''), status: 'streaming' }
            } else {
              steps.push({
                id: stepId,
                type: StepType.THINKING,
                content: event.content || '',
                status: 'streaming',
                startTime: Date.now(),
              } as ThinkingStep)
            }
          } else {
            const idx = steps.findIndex(
              s => s.type === StepType.THINKING && s.status === 'streaming',
            )
            if (idx >= 0) {
              const t = steps[idx] as ThinkingStep
              steps[idx] = { ...t, content: t.content + (event.content || '') }
            } else {
              steps.push({
                id: `thinking_${Date.now()}`,
                type: StepType.THINKING,
                content: event.content || '',
                status: 'streaming',
                startTime: Date.now(),
              } as ThinkingStep)
            }
          }
          break
        }

        case 'thinking_done': {
          if (stepId) {
            const idx = steps.findIndex(s => s.id === stepId)
            if (idx >= 0) {
              steps[idx] = { ...steps[idx], status: 'success', endTime: Date.now() } as ThinkingStep
            }
          } else {
            for (let i = steps.length - 1; i >= 0; i--) {
              if (steps[i].type === StepType.THINKING && steps[i].status === 'streaming') {
                steps[i] = { ...steps[i], status: 'success', endTime: Date.now() } as ThinkingStep
                break
              }
            }
          }
          break
        }

        case 'tool_call_start': {
          steps.push({
            id: event.id || `tool_${Date.now()}`,
            type: StepType.TOOL_CALL,
            toolName: event.name || 'unknown',
            arguments: event.arguments || '',
            status: 'streaming',
            startTime: Date.now(),
          } as ToolCallStep)
          break
        }

        case 'tool_call_delta': {
          if (event.id) {
            const idx = steps.findIndex(
              s => s.type === StepType.TOOL_CALL && (s as ToolCallStep).id === event.id,
            )
            if (idx >= 0) {
              const tc = steps[idx] as ToolCallStep
              steps[idx] = { ...tc, arguments: tc.arguments + (event.content || '') }
            }
          }
          break
        }

        case 'tool_call_end': {
          if (event.id) {
            const idx = steps.findIndex(
              s => s.type === StepType.TOOL_CALL && (s as ToolCallStep).id === event.id,
            )
            if (idx >= 0) {
              const tc = steps[idx] as ToolCallStep
              steps[idx] = {
                ...tc,
                arguments: event.arguments || tc.arguments,
                status: 'success',
                endTime: Date.now(),
                errorCode: event.errorCode,
              } as ToolCallStep
            }
          }
          break
        }

        case 'tool_result_start': {
          const resultId = event.id || `tool_result_${Date.now()}`
          steps.push({
            id: `result_${resultId}`,
            type: StepType.TOOL_RESULT,
            toolCallId: resultId,
            toolName: event.name || 'unknown',
            result: '',
            status: 'streaming',
            startTime: Date.now(),
          } as ToolResultStep)
          break
        }

        case 'tool_result_delta': {
          if (event.id) {
            const idx = steps.findIndex(
              s => s.type === StepType.TOOL_RESULT && (s as ToolResultStep).toolCallId === event.id,
            )
            if (idx >= 0) {
              const tr = steps[idx] as ToolResultStep
              steps[idx] = { ...tr, result: tr.result + (event.content || '') }
            }
          }
          break
        }

        case 'tool_result_end': {
          if (event.id) {
            const idx = steps.findIndex(
              s => s.type === StepType.TOOL_RESULT && (s as ToolResultStep).toolCallId === event.id,
            )
            if (idx >= 0) {
              const tr = steps[idx] as ToolResultStep
              steps[idx] = {
                ...tr,
                result: event.result || tr.result,
                status: event.errorCode ? 'error' : 'success',
                endTime: Date.now(),
                duration: Date.now() - tr.startTime,
              } as ToolResultStep
            } else {
              steps.push({
                id: `result_${event.id}`,
                type: StepType.TOOL_RESULT,
                toolCallId: event.id,
                toolName: event.name || 'unknown',
                result: event.result || '',
                status: event.errorCode ? 'error' : 'success',
                startTime: Date.now(),
                endTime: Date.now(),
                duration: 0,
              } as ToolResultStep)
            }
          }
          break
        }

        case 'answer_delta': {
          if (stepId) {
            const idx = steps.findIndex(s => s.id === stepId)
            if (idx >= 0 && steps[idx].type === StepType.TEXT_STREAM) {
              const ts = steps[idx] as TextStreamStep
              steps[idx] = { ...ts, content: ts.content + (event.content || ''), status: 'streaming' }
            } else {
              steps.push({
                id: stepId,
                type: StepType.TEXT_STREAM,
                content: event.content || '',
                status: 'streaming',
                startTime: Date.now(),
              } as TextStreamStep)
            }
          } else {
            const idx = steps.findIndex(
              s => s.type === StepType.TEXT_STREAM && s.status === 'streaming',
            )
            if (idx >= 0) {
              const ts = steps[idx] as TextStreamStep
              steps[idx] = { ...ts, content: ts.content + (event.content || '') }
            } else {
              steps.push({
                id: `text_${Date.now()}`,
                type: StepType.TEXT_STREAM,
                content: event.content || '',
                status: 'streaming',
                startTime: Date.now(),
              } as TextStreamStep)
            }
          }
          break
        }

        case 'answer_done': {
          if (stepId) {
            const idx = steps.findIndex(s => s.id === stepId)
            if (idx >= 0) {
              steps[idx] = { ...steps[idx], status: 'success', endTime: Date.now() } as TextStreamStep
            }
          } else {
            for (let i = steps.length - 1; i >= 0; i--) {
              if (steps[i].type === StepType.TEXT_STREAM && steps[i].status === 'streaming') {
                steps[i] = { ...steps[i], status: 'success', endTime: Date.now() } as TextStreamStep
                break
              }
            }
          }
          break
        }

        case 'reasoning_iteration': {
          steps.push({
            id: `iteration_${event.iterationIndex || 1}_${Date.now()}`,
            type: StepType.REASONING_ITERATION,
            iterationIndex: event.iterationIndex || 1,
            maxIterations: event.maxIterations || 3,
            status: 'success',
            startTime: Date.now(),
            endTime: Date.now(),
          } as ReasoningIterationStep)
          break
        }

        case 'error': {
          steps.push({
            id: `error_${Date.now()}`,
            type: StepType.ERROR,
            errorCode: event.errorCode || 'UNKNOWN',
            message: event.message || event.error || '未知错误',
            status: 'error',
            startTime: Date.now(),
            recoverable: event.recoverable ?? false,
            suggestedAction: event.suggestedAction,
          } as ErrorStep)
          break
        }
      }

      const fullContent = rebuildAnswerContent(steps)

      updated[updated.length - 1] = {
        ...last,
        steps,
        content: fullContent,
        answerContent: fullContent,
        currentPhase:
          event.type === 'thinking_delta' || event.type === 'thinking_done'
            ? 'thinking'
            : event.type.startsWith('tool_')
            ? 'tool_calling'
            : event.type.startsWith('answer_')
            ? 'generating'
            : last.currentPhase,
      }
      return updated
    })

    emitEventBusEvent(event)
  }, [])

  const handleSend = useCallback(async (value?: string) => {
    const trimmed = (value ?? inputValue).trim()
    if (!trimmed || isGenerating) return

    setInputValue('')

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: trimmed,
      steps: [],
      status: 'success',
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])

    const assistantMsg: ChatMessage = {
      id: `assistant_${Date.now()}`,
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
        const createRes = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.SESSIONS}`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            title: generateTitle(trimmed),
            model: selectedModel,
          }),
        })
        if (createRes.ok) {
          const session = await createRes.json()
          sessionId = session.id
          setCurrentSessionId(sessionId)
          fetchSessions()
        }
      }

      const fetchSessionId = sessionId || currentSessionId

      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.COMPLETIONS}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          sessionId: fetchSessionId,
          message: trimmed,
          model: selectedModel,
          stream: true,
          deepThinking,
          webSearch,
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`)
      }

      if (!response.body) {
        throw new Error('无法读取响应流')
      }

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

              if (parsed.error) {
                throw new Error(parsed.error)
              }

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
      agentEventBus.emit('run:finished', { runId })
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
  }, [inputValue, isGenerating, currentSessionId, selectedModel, deepThinking, webSearch, generateTitle, fetchSessions, applyStreamEvent])

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
    setCurrentSessionId(null)
    setInputValue('')
  }, [])

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
    loadSession,
    fetchSessions,
    messagesEndRef,
    isInChatMode,
  }
}
