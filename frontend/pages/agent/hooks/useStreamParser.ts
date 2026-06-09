import { useCallback } from 'react'
import type {
  ChatMessage,
  StreamEvent,
  AgentStep,
  ThinkingStep,
  ToolCallStep,
  ToolResultStep,
  TextStreamStep,
  ReasoningIterationStep,
  ErrorStep,
} from '../types'
import { StepType } from '../types'
import { agentEventBus } from './useAgentEventBus'
import { rebuildAnswerContent, statusToPhase } from '../utils/stepHelpers'

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

/**
 * 将 StreamEvent 应用到消息列表，返回更新后的消息列表
 */
function applyEventToMessages(prev: ChatMessage[], event: StreamEvent): ChatMessage[] {
  const updated = [...prev]
  const last = updated[updated.length - 1]
  if (!last || last.role !== 'assistant' || last.status !== 'loading') return updated

  const steps: AgentStep[] = [...last.steps]
  const stepId = event.stepId

  switch (event.type) {
    case 'status': {
      if (event.status) {
        const phase = statusToPhase(event.status)
        if (phase) {
          // TEXT_STREAM 类型的 status（generating/done）使用更宽松的去重：
          // 检查是否已有 pending 或 streaming 的 TEXT_STREAM step，有则不再重复创建
          if (phase === StepType.TEXT_STREAM) {
            const existing = steps.some(
              s =>
                s.type === StepType.TEXT_STREAM &&
                (s.status === 'streaming' || s.status === 'pending'),
            )
            if (!existing) {
              steps.push({
                id: `text_phase_${Date.now()}`,
                type: StepType.TEXT_STREAM,
                content: '',
                status: 'pending',
                startTime: Date.now(),
              } as TextStreamStep)
            }
          } else {
            // 非 TEXT_STREAM 类型（如 THINKING, TOOL_CALL）保持原有逻辑
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
          s => s.type === StepType.TEXT_STREAM && (s.status === 'streaming' || s.status === 'pending'),
        )
        if (idx >= 0) {
          const ts = steps[idx] as TextStreamStep
          steps[idx] = { ...ts, content: (ts.content || '') + (event.content || ''), status: 'streaming' }
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
}

/**
 * 流式解析 Hook
 * 提供 applyStreamEvent 方法，将 SSE 事件应用到消息状态
 */
export function useStreamParser(
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
) {
  const applyStreamEvent = useCallback((event: StreamEvent) => {
    setMessages((prev) => applyEventToMessages(prev, event))
    emitEventBusEvent(event)
  }, [setMessages])

  return { applyStreamEvent }
}
