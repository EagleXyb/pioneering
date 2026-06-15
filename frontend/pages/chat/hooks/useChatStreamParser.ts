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
import { rebuildAnswerContent } from '../utils/stepHelpers'

// 自增计数器，确保同一毫秒内生成的 fallback ID 不会重复
let _stepIdCounter = 0
function nextStepId(prefix: string): string {
  return `${prefix}${Date.now()}_${++_stepIdCounter}`
}

function applyEventToMessages(prev: ChatMessage[], event: StreamEvent): ChatMessage[] {
  const updated = [...prev]
  const last = updated[updated.length - 1]
  if (!last || last.role !== 'assistant' || last.status !== 'loading') return updated

  const steps: AgentStep[] = [...last.steps]
  const stepId = event.stepId

  switch (event.type) {
    case 'status': {
      break
    }

    case 'thinking_delta': {
      if (stepId) {
        const idx = steps.findIndex(s => s.id === stepId)
        if (idx >= 0 && steps[idx].type === StepType.THINKING) {
          const t = steps[idx] as ThinkingStep
          steps[idx] = { ...t, content: t.content + (event.content || ''), status: 'streaming' }
        } else {
          const fallbackIdx = steps.findIndex(
            s => s.type === StepType.THINKING && s.status === 'streaming',
          )
          if (fallbackIdx >= 0) {
            const t = steps[fallbackIdx] as ThinkingStep
            steps[fallbackIdx] = { ...t, content: t.content + (event.content || ''), status: 'streaming' }
          } else {
            steps.push({
              id: stepId,
              type: StepType.THINKING,
              content: event.content || '',
              status: 'streaming',
              startTime: Date.now(),
            } as ThinkingStep)
          }
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
            id: nextStepId('thinking_'),
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
        id: event.id || nextStepId('tool_'),
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
      const resultId = event.id || nextStepId('tool_result_')
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
          const fallbackIdx = steps.findIndex(
            s => s.type === StepType.TEXT_STREAM && (s.status === 'streaming' || s.status === 'pending'),
          )
          if (fallbackIdx >= 0) {
            const ts = steps[fallbackIdx] as TextStreamStep
            steps[fallbackIdx] = { ...ts, content: (ts.content || '') + (event.content || ''), status: 'streaming' }
          } else {
            steps.push({
              id: stepId,
              type: StepType.TEXT_STREAM,
              content: event.content || '',
              status: 'streaming',
              startTime: Date.now(),
            } as TextStreamStep)
          }
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
            id: nextStepId('text_'),
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
        id: nextStepId('iteration_'),
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
        id: nextStepId('error_'),
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
 * Chat 模式流式解析 Hook
 * 提供 applyStreamEvent 方法，将 SSE 事件应用到消息状态
 */
export function useChatStreamParser(
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
) {
  const applyStreamEvent = useCallback((event: StreamEvent) => {
    setMessages((prev) => applyEventToMessages(prev, event))
  }, [setMessages])

  return { applyStreamEvent }
}
