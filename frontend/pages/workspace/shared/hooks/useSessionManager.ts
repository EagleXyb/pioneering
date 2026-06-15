import { useState, useCallback, useEffect, useRef } from 'react'
import type { ChatSession } from '../types'

/** API 适配器接口，由各模式注入具体实现 */
export interface SessionApiAdapter {
  fetchSessions: () => Promise<ChatSession[]>
  fetchSessionMessages: (sessionId: string) => Promise<unknown[]>
  createSession: (title: string, model: string) => Promise<{ id: string }>
  deleteSession: (sessionId: string) => Promise<void>
}

export function useSessionManager(adapter?: SessionApiAdapter) {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [pinnedSessionIds, setPinnedSessionIds] = useState<Set<string>>(new Set())
  const [renamedTitles, setRenamedTitles] = useState<Record<string, string>>({})

  const adapterRef = useRef(adapter)
  adapterRef.current = adapter

  const refreshSessions = useCallback(async () => {
    if (!adapterRef.current) return
    setSessionsLoading(true)
    try {
      const mapped = await adapterRef.current.fetchSessions()
      const seen = new Set<string>()
      const deduplicated = mapped.filter(s => {
        if (seen.has(s.id)) return false
        seen.add(s.id)
        return true
      })
      setSessions(deduplicated)
    } catch {
      console.error('获取会话列表失败')
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (adapterRef.current) {
      refreshSessions()
    }
  }, [refreshSessions])

  const loadSession = useCallback(async (sessionId: string) => {
    if (!adapterRef.current) return null
    try {
      const msgs = await adapterRef.current.fetchSessionMessages(sessionId)
      setCurrentSessionId(sessionId)
      return msgs
    } catch {
      console.error('加载会话消息失败')
      return null
    }
  }, [])

  const createNewSession = useCallback(async (title: string, model: string) => {
    if (!adapterRef.current) return null
    try {
      const session = await adapterRef.current.createSession(title, model)
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

  const removeSession = useCallback(async (sessionId: string) => {
    if (!adapterRef.current) return
    try {
      await adapterRef.current.deleteSession(sessionId)
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
      setPinnedSessionIds((prev) => {
        if (!prev.has(sessionId)) return prev
        const next = new Set(prev)
        next.delete(sessionId)
        return next
      })
      setCurrentSessionId((prev) => (prev === sessionId ? null : prev))
    } catch {
      console.error('删除会话失败')
    }
  }, [])

  const togglePinSession = useCallback((sessionId: string) => {
    setPinnedSessionIds((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) {
        next.delete(sessionId)
      } else {
        next.add(sessionId)
      }
      return next
    })
  }, [])

  const renameSession = useCallback((sessionId: string, newTitle: string) => {
    const trimmed = newTitle.trim()
    if (!trimmed) return
    setRenamedTitles((prev) => ({ ...prev, [sessionId]: trimmed }))
  }, [])

  const visibleSessions = sessions
    .map((s) => ({
      ...s,
      title: renamedTitles[s.id] ?? s.title,
      pinned: pinnedSessionIds.has(s.id),
    }))
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      return 0
    })

  return {
    currentSessionId,
    sessions: visibleSessions,
    sessionsLoading,
    refreshSessions,
    loadSession,
    createNewSession,
    resetSession,
    removeSession,
    togglePinSession,
    renameSession,
  }
}
