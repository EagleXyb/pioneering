import { useState, useCallback, useRef, useEffect } from 'react'
import type { ChatMessage, ChatSession } from '../types'
import { API_ENDPOINTS } from '@shared/api/endpoints'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token') || ''
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' }
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
        const list = Array.isArray(data) ? data : (data.sessions || [])
        setSessions(list)
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
        const data: Array<{
          id: string
          sessionId: string
          role: 'user' | 'assistant' | 'system'
          content: string
          createdAt: string
        }> = await res.json()

        const msgs: ChatMessage[] = data.map((m) => ({
          id: `db_${m.id}`,
          role: m.role,
          content: m.content,
          status: 'success',
          timestamp: new Date(m.createdAt).getTime(),
        }))
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

  const handleSend = useCallback(async (value?: string) => {
    const trimmed = (value ?? inputValue).trim()
    if (!trimmed || isGenerating) return

    setInputValue('')

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: trimmed,
      status: 'success',
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])

    const assistantMsg: ChatMessage = {
      id: `assistant_${Date.now()}`,
      role: 'assistant',
      content: '',
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
      let fullContent = ''

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
              const parsed = JSON.parse(data)
              if (parsed.error) {
                throw new Error(parsed.error)
              }
              if (parsed.content) {
                fullContent += parsed.content
                setMessages((prev) => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last && last.role === 'assistant' && last.status === 'loading') {
                    updated[updated.length - 1] = { ...last, content: fullContent }
                  }
                  return updated
                })
              }
            } catch {
              if (data.includes('"content"')) {
                try {
                  const match = data.match(/"content":\s*"([^"]*)"/)
                  if (match) {
                    const content = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')
                    fullContent += content
                    setMessages((prev) => {
                      const updated = [...prev]
                      const last = updated[updated.length - 1]
                      if (last && last.role === 'assistant' && last.status === 'loading') {
                        updated[updated.length - 1] = { ...last, content: fullContent }
                      }
                      return updated
                    })
                  }
                } catch {
                  // ignore
                }
              }
            }
          }
        }
      }

      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last && last.role === 'assistant' && last.status === 'loading') {
          updated[updated.length - 1] = { ...last, content: fullContent, status: 'success' }
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
          }
        }
        return updated
      })
    } finally {
      setIsGenerating(false)
      abortRef.current = null
    }
  }, [inputValue, isGenerating, currentSessionId, selectedModel, deepThinking, webSearch, generateTitle, fetchSessions])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setIsGenerating(false)
    setMessages((prev) => {
      const updated = [...prev]
      const last = updated[updated.length - 1]
      if (last && last.status === 'loading') {
        updated[updated.length - 1] = { ...last, status: 'success' }
      }
      return updated
    })
  }, [])

  const handleNewChat = useCallback(() => {
    setMessages([])
    setCurrentSessionId(null)
    setInputValue('')
  }, [])

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