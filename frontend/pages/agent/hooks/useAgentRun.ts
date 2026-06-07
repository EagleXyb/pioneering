import { useState, useCallback, useRef } from 'react'
import { useAgentEvent, agentEventBus } from './useAgentEventBus'

/**
 * Run 阶段定义
 */
export type RunPhase =
  | 'idle'
  | 'perception'
  | 'memory'
  | 'thinking'
  | 'tool_calling'
  | 'generating'
  | 'done'
  | 'error'

export interface RunPhaseInfo {
  phase: RunPhase
  status: 'wait' | 'process' | 'finish' | 'error'
  startTime: number
  endTime?: number
}

export interface RunState {
  runId: string
  phases: RunPhaseInfo[]
  currentPhase: RunPhase
  currentIteration: number
  maxIterations: number
  toolCallCount: number
  thinkingContent: string
  answerContent: string
  isRunning: boolean
  error: string | null
}

const PHASE_ORDER: RunPhase[] = [
  'perception',
  'memory',
  'thinking',
  'tool_calling',
  'generating',
  'done',
]

function createInitialRunState(runId: string): RunState {
  return {
    runId,
    phases: PHASE_ORDER.map((phase) => ({
      phase,
      status: 'wait' as const,
      startTime: 0,
    })),
    currentPhase: 'idle',
    currentIteration: 0,
    maxIterations: 3,
    toolCallCount: 0,
    thinkingContent: '',
    answerContent: '',
    isRunning: false,
    error: null,
  }
}

export function useAgentRun() {
  const [runState, setRunState] = useState<RunState | null>(null)
  const runIdRef = useRef<string>('')

  const updatePhase = useCallback((phase: RunPhase, status: RunPhaseInfo['status']) => {
    setRunState((prev) => {
      if (!prev) return prev
      const phases = prev.phases.map((p) => {
        if (p.phase === phase) {
          return {
            ...p,
            status,
            startTime: p.startTime || Date.now(),
            endTime: status === 'finish' || status === 'error' ? Date.now() : undefined,
          }
        }
        // 当前阶段之前的阶段标记为完成
        const phaseIdx = PHASE_ORDER.indexOf(phase)
        const pIdx = PHASE_ORDER.indexOf(p.phase)
        if (pIdx < phaseIdx && p.status === 'wait') {
          return { ...p, status: 'finish' as const, startTime: Date.now(), endTime: Date.now() }
        }
        return p
      })
      return { ...prev, phases, currentPhase: phase }
    })
  }, [])

  // 订阅 run:started
  useAgentEvent('run:started', (event) => {
    const runId = (event.data.runId as string) || `run_${Date.now()}`
    runIdRef.current = runId
    setRunState({
      ...createInitialRunState(runId),
      isRunning: true,
    })
  }, [])

  // 订阅阶段切换
  useAgentEvent(
    ['phase:perception', 'phase:memory', 'phase:thinking', 'phase:tool_calling', 'phase:generating', 'phase:done'],
    (event) => {
      const phaseMap: Record<string, RunPhase> = {
        'phase:perception': 'perception',
        'phase:memory': 'memory',
        'phase:thinking': 'thinking',
        'phase:tool_calling': 'tool_calling',
        'phase:generating': 'generating',
        'phase:done': 'done',
      }
      const phase = phaseMap[event.type]
      if (phase) {
        updatePhase(phase, 'process')
      }
    },
    [updatePhase],
  )

  // 订阅思考内容
  useAgentEvent('thinking:delta', (event) => {
    const delta = (event.data.delta as string) || ''
    setRunState((prev) => {
      if (!prev) return prev
      return { ...prev, thinkingContent: prev.thinkingContent + delta }
    })
  }, [])

  useAgentEvent('thinking:completed', () => {
    updatePhase('thinking', 'finish')
  }, [updatePhase])

  // 订阅工具调用
  useAgentEvent('tool_call:started', () => {
    setRunState((prev) => {
      if (!prev) return prev
      return { ...prev, toolCallCount: prev.toolCallCount + 1 }
    })
  }, [])

  useAgentEvent('tool_call:completed', () => {
    // 工具调用完成的逻辑
  }, [])

  // 订阅推理迭代
  useAgentEvent('reasoning:iteration', (event) => {
    const iteration = (event.data.iteration as number) || 0
    const maxIterations = (event.data.maxIterations as number) || 3
    setRunState((prev) => {
      if (!prev) return prev
      return { ...prev, currentIteration: iteration, maxIterations }
    })
  }, [])

  // 订阅回答内容
  useAgentEvent('answer:delta', (event) => {
    const delta = (event.data.delta as string) || ''
    setRunState((prev) => {
      if (!prev) return prev
      return { ...prev, answerContent: prev.answerContent + delta }
    })
  }, [])

  useAgentEvent('answer:completed', () => {
    updatePhase('generating', 'finish')
  }, [updatePhase])

  // 订阅完成和错误
  useAgentEvent('run:finished', () => {
    setRunState((prev) => {
      if (!prev) return prev
      return { ...prev, isRunning: false, currentPhase: 'done' }
    })
  }, [])

  useAgentEvent('run:error', (event) => {
    const errorMsg = (event.data.message as string) || '未知错误'
    setRunState((prev) => {
      if (!prev) return prev
      return { ...prev, isRunning: false, error: errorMsg, currentPhase: 'error' }
    })
  }, [])

  useAgentEvent('error:occurred', (event) => {
    const errorMsg = (event.data.message as string) || '未知错误'
    setRunState((prev) => {
      if (!prev) return prev
      return { ...prev, error: errorMsg }
    })
  }, [])

  /**
   * 启动一个新的 Run
   */
  const startRun = useCallback((runId?: string) => {
    const id = runId || `run_${Date.now()}`
    runIdRef.current = id
    agentEventBus.emit('run:started', { runId: id })
    const state = createInitialRunState(id)
    setRunState({ ...state, isRunning: true })
  }, [])

  /**
   * 结束当前 Run
   */
  const finishRun = useCallback(() => {
    agentEventBus.emit('run:finished', { runId: runIdRef.current })
  }, [])

  /**
   * 重置 Run 状态
   */
  const resetRun = useCallback(() => {
    setRunState(null)
    runIdRef.current = ''
  }, [])

  return {
    runState,
    startRun,
    finishRun,
    resetRun,
  }
}