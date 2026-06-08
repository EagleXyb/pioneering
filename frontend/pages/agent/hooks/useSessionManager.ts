import { useState, useCallback, useEffect } from 'react'
import type { ChatSession } from '../types'
import { fetchSessions, fetchSessionMessages, createSession } from '../api/agentApi'

export function useSessionManager() {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)

  const refreshSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      const mapped = await fetchSessions()
      setSessions(mapped)
    } catch {
      console.error('获取会话列表失败')
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshSessions()
  }, [refreshSessions])

  const loadSession = useCallback(async (sessionId: string) => {
    try {
      const msgs = await fetchSessionMessages(sessionId)
      setCurrentSessionId(sessionId)
      return msgs
    } catch {
      console.error('加载会话消息失败')
      return null
    }
  }, [])

  const createNewSession = useCallback(async (title: string, model: string) => {
    try {
      const session = await createSession(title, model)
      setCurrentSessionId(session.id)
      refreshSessions()
      return session.id
    } catch {
      console.error('创建会话失败')
      return null
    }
  }, [refreshSessions])

  const resetSession = useCallback(() => {
    setCurrentSessionId(null)
  }, [])

  return {
    currentSessionId,
    sessions,
    sessionsLoading,
    refreshSessions,
    loadSession,
    createNewSession,
    resetSession,
  }
}
