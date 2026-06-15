import { useState, useCallback, useRef, useMemo } from 'react'
import type { ChatMessage, StreamEvent } from '../types'
import { useChatStreamParser } from './useChatStreamParser'
import { useSessionManager, type SessionApiAdapter } from '../../workspace/shared/hooks/useSessionManager'
import * as chatApi from '../api/chatApi'

let _idCounter = 0
function nextId(prefix: string): string {
  return `${prefix}${Date.now()}_${++_idCounter}`
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [selectedModel, setSelectedModel] = useState('glm-4-flash')
  const [deepThinking, setDeepThinking] = useState(false)
  const [webSearch, setWebSearch] = useState(false)

  const abortRef = useRef<AbortController | null>(null)

  // Inject Chat API adapter
  const chatAdapter = useMemo<SessionApiAdapter>(() => ({
    fetchSessions: chatApi.fetchSessions,
    fetchSessionMessages: chatApi.fetchSessionMessages,
    createSession: chatApi.createSession,
    deleteSession: chatApi.deleteSession,
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
  } = useSessionManager(chatAdapter)

  const { applyStreamEvent } = useChatStreamParser(setMessages)

  const isInChatMode = messages.length > 0

  const generateTitle = useCallback((content: string): string => {
    return content.replace(/[\n\r]/g, ' ').slice(0, 30)
  }, [])

  const loadSession = useCallback(async (sessionId: string) => {
    const msgs = await loadSessionRaw(sessionId)
    if (msgs) {
      setMessages(msgs as ChatMessage[])
    }
  }, [loadSessionRaw])

  const handleSend = useCallback(async (value?: string) => {
    const trimmed = (value ?? inputValue).trim()
    if (!trimmed || isGenerating) return

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

    const abortController = new AbortController()
    abortRef.current = abortController

    try {
      let sessionId = currentSessionId
      if (!sessionId) {
        sessionId = await createNewSession(generateTitle(trimmed), selectedModel)
      }

      const fetchSessionId = sessionId || currentSessionId

      const response = await chatApi.createChatRequest({
        sessionId: fetchSessionId,
        message: trimmed,
        model: selectedModel,
        stream: true,
        deepThinking,
        webSearch,
        signal: abortController.signal,
      })

      if (!response.ok) throw new Error(`Request failed: ${response.status}`)
      if (!response.body) throw new Error('Unable to read response stream')

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
    deepThinking, webSearch, generateTitle, createNewSession, applyStreamEvent,
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
    loadSession,
    fetchSessions,
    isInChatMode,
    removeSession,
    togglePinSession,
    renameSession,
  }
}
