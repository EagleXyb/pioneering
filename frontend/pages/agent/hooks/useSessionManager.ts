import { useState, useCallback, useEffect } from 'react'
import type { ChatSession } from '../types'
import { fetchSessions, fetchSessionMessages, createSession, deleteSession } from '../api/agentApi'

export function useSessionManager() {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  // 本地置顶会话 id 集合
  const [pinnedSessionIds, setPinnedSessionIds] = useState<Set<string>>(new Set())
  // 本地重命名映射
  const [renamedTitles, setRenamedTitles] = useState<Record<string, string>>({})

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

  // 调用后端 API 删除会话
  const removeSession = useCallback(async (sessionId: string) => {
    try {
      await deleteSession(sessionId)
      // 从本地列表中移除
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

  // 切换置顶
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

  // 重命名
  const renameSession = useCallback((sessionId: string, newTitle: string) => {
    const trimmed = newTitle.trim()
    if (!trimmed) return
    setRenamedTitles((prev) => ({ ...prev, [sessionId]: trimmed }))
  }, [])

  // 应用到列表：合并重命名/置顶、置顶项置顶排序
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
