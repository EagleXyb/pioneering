import { useState, useCallback, useRef, useMemo } from 'react'
import type { AgentMessage } from '../types'
import { agentEventBus } from './useAgentEventBus'
import { useAgentStreamParser } from './useAgentStreamParser'
import { useSessionManager, type SessionApiAdapter } from '../../workspace/shared/hooks/useSessionManager'
import * as agentApi from '../api/agentApi'

let _idCounter = 0
function nextId(prefix: string): string {
  return `${prefix}${Date.now()}_${++_idCounter}`
}

export function useAgentChat() {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [selectedModel, setSelectedModel] = useState('glm-4-flash')

  const abortRef = useRef<AbortController | null>(null)

  // 注入 Agent API 适配器
  const agentAdapter = useMemo<SessionApiAdapter>(() => ({
    fetchSessions: agentApi.fetchAgentSessions,
    fetchSessionMessages: agentApi.fetchAgentSessionMessages,
    createSession: agentApi.createAgentSession,
    deleteSession: agentApi.deleteAgentSession,
  }), [])

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
  } = useSessionManager(agentAdapter)

  const { applyAgentEvent } = useAgentStreamParser(setMessages)

  const isInChatMode = messages.length > 0

  const generateTitle = useCallback((content: string): string => {
    return content.replace(/[\n\r]/g, ' ').slice(0, 30)
  }, [])

  const loadSession = useCallback(async (sessionId: string) => {
    const msgs = await loadSessionRaw(sessionId)
    if (msgs) {
      setMessages(msgs as AgentMessage[])
    }
  }, [loadSessionRaw])

  const handleSend = useCallback(async (value?: string) => {
    const trimmed = (value ?? inputValue).trim()
    if (!trimmed || isGenerating) return

    setInputValue('')

    const userMsg: AgentMessage = {
      id: nextId('user_'),
      role: 'user',
      content: trimmed,
      steps: [],
      status: 'success',
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])

    const assistantMsg: AgentMessage = {
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
        sessionId = await createNewSession(generateTitle(trimmed), selectedModel)
      }

      const fetchSessionId = sessionId || currentSessionId

      const response = await agentApi.createAgentRequest({
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
              if (parsed.type === '__agent_metadata__') continue
              applyAgentEvent(parsed)
            } catch {
              // 忽略解析失败的行
            }
          }
        }
      }

      agentEventBus.emit('run:finished', { runId })

      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last && last.role === 'assistant' && last.status === 'loading') {
          updated[updated.length - 1] = { ...last, currentPhase: 'done', status: 'success' }
        }
        return updated
      })
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
    generateTitle, createNewSession, applyAgentEvent,
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
    loadSession,
    fetchSessions,
    isInChatMode,
    removeSession,
    togglePinSession,
    renameSession,
  }
}
