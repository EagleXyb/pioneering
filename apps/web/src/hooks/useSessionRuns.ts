import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listAgentRuns,
  type AgentRunData,
} from '../api/agent';
import type { ChatStatus } from '../types/chat';

/**
 * 按会话加载 Agent run 记录，构建 messageId → run 映射。
 *
 * - 会话切换 / 首次：拉取该会话全部 runs；
 * - 每次执行从流式回到 idle（run 刚收尾）：自动刷新，保证刚完成的消息能看到轨迹；
 * - temp_ 临时会话或无 sessionId：返回空，不发请求。
 */
export function useSessionRuns(
  sessionId: string | null | undefined,
  status: ChatStatus,
): {
  runs: AgentRunData[]
  byMessage: ReadonlyMap<string, AgentRunData>
  reload: () => Promise<void>
} {
  const [runs, setRuns] = useState<AgentRunData[]>([])

  const reload = useCallback(async () => {
    if (!sessionId || sessionId.startsWith('temp_')) {
      setRuns([])
      return
    }
    try {
      setRuns(await listAgentRuns(sessionId))
    } catch {
      // 加载失败保留现有数据，不阻塞消息展示
    }
  }, [sessionId])

  // 会话切换加载
  useEffect(() => {
    void reload()
  }, [reload])

  // 执行回到 idle 时刷新（run 在流末尾落库）
  const streaming = status === 'streaming'
  useEffect(() => {
    if (!streaming) void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming])

  const byMessage = useMemo(() => {
    const m = new Map<string, AgentRunData>()
    for (const r of runs) {
      if (r.messageId) m.set(r.messageId, r)
    }
    return m
  }, [runs])

  return { runs, byMessage, reload }
}
