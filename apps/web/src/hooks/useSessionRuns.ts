import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listAgentRuns,
  type AgentRunData,
} from '../api/agent';
import type { ChatStatus } from '../types/chat';

/**
 * 流式期间轮询间隔：run 在流开始前即以 running 状态落库（事件时间轴收尾时才写入），
 * 定期刷新让右侧执行轨迹面板能尽早发现并跟随正在执行的 run。
 */
const STREAMING_POLL_MS = 2500;

/**
 * 按会话加载 Agent run 记录，构建 messageId → run 映射。
 *
 * - 会话切换 / 首次：拉取该会话全部 runs；
 * - 流式期间：定期刷新（发现 running 的 run）；结束后刷新（run 在流末尾落库完整事件）；
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

  // 会话切换 / 挂载加载；流式期间定期刷新（尽早发现 running 的 run）；
  // 回到 idle 时刷新（run 已收尾，事件时间轴写入）
  const streaming = status === 'streaming'
  useEffect(() => {
    void reload()
    if (!streaming) return
    const timer = window.setInterval(() => void reload(), STREAMING_POLL_MS)
    return () => window.clearInterval(timer)
  }, [streaming, reload])

  const byMessage = useMemo(() => {
    const m = new Map<string, AgentRunData>()
    for (const r of runs) {
      if (r.messageId) m.set(r.messageId, r)
    }
    return m
  }, [runs])

  return { runs, byMessage, reload }
}
