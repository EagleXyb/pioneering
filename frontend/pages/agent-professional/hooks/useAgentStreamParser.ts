import { useCallback } from 'react'
import type {
  AgentMessage,
  AgentStep,
  ThinkingStep,
  ToolCallStep,
  ToolResultStep,
  TextStreamStep,
  ErrorStep,
} from '../types'
import { StepType } from '../types'
import { agentEventBus } from './useAgentEventBus'
import { rebuildAnswerContent } from '../utils/stepHelpers'

// 自增计数器
let _idCounter = 0
function nextId(prefix: string): string {
  return `${prefix}${Date.now()}_${++_idCounter}`
}

/**
 * Agent 模式流式解析 Hook
 * 解析 Agent SSE 事件（type: thinking / tool_call / tool_result / text_stream / done / error）
 * 并应用到消息状态
 */
export function useAgentStreamParser(
  setMessages: React.Dispatch<React.SetStateAction<AgentMessage[]>>
) {
  const applyAgentEvent = useCallback((parsed: Record<string, unknown>) => {
    const etype = parsed.type as string | undefined

    setMessages((prev) => {
      const updated = [...prev]
      const last = updated[updated.length - 1]
      if (!last || last.role !== 'assistant' || last.status !== 'loading') return updated

      const steps: AgentStep[] = [...last.steps]
      let fullContent = ''

      switch (etype) {
        case 'thinking': {
          steps.push({
            id: nextId('thinking_'),
            type: StepType.THINKING,
            content: (parsed.summary as string) || '',
            status: (parsed.status as string) === 'running' ? 'streaming' : 'success',
            startTime: Date.now(),
            endTime: (parsed.status as string) !== 'running' ? Date.now() : undefined,
          } as ThinkingStep)
          break
        }
        case 'tool_call': {
          steps.push({
            id: (parsed.executionId as string) || nextId('tool_'),
            type: StepType.TOOL_CALL,
            toolName: (parsed.toolName as string) || 'unknown',
            arguments: (parsed.summary as string) || '',
            status: (parsed.status as string) === 'running' ? 'streaming' : 'success',
            startTime: Date.now(),
          } as ToolCallStep)
          break
        }
        case 'tool_result': {
          const execId = parsed.executionId as string
          for (let i = steps.length - 1; i >= 0; i--) {
            if (steps[i].type === StepType.TOOL_CALL && (steps[i] as ToolCallStep).id === execId) {
              steps[i] = { ...steps[i], status: 'success', endTime: Date.now() } as ToolCallStep
              break
            }
          }
          steps.push({
            id: `${execId || 'result'}_${steps.length}`,
            type: StepType.TOOL_RESULT,
            toolCallId: execId || '',
            toolName: (parsed.toolName as string) || 'unknown',
            result: (parsed.summary as string) || '',
            status: 'success',
            startTime: Date.now(),
            endTime: Date.now(),
          } as ToolResultStep)
          break
        }
        case 'text_stream': {
          const token = (parsed.text as string) || ''
          const existingIdx = steps.findIndex(s => s.type === StepType.TEXT_STREAM && s.status === 'streaming')
          if (existingIdx >= 0) {
            const ts = steps[existingIdx] as TextStreamStep
            steps[existingIdx] = { ...ts, content: ts.content + token }
          } else {
            steps.push({
              id: nextId('text_'),
              type: StepType.TEXT_STREAM,
              content: token,
              status: 'streaming',
              startTime: Date.now(),
            } as TextStreamStep)
          }
          break
        }
        default: {
          if (parsed.errorCode !== undefined || parsed.message !== undefined) {
            steps.push({
              id: nextId('error_'),
              type: StepType.ERROR,
              errorCode: (parsed.errorCode as string) || 'UNKNOWN',
              message: (parsed.message as string) || '',
              status: 'error',
              startTime: Date.now(),
              recoverable: false,
            } as ErrorStep)
          }
          break
        }
      }

      const isDone = etype === undefined && parsed.errorCode === undefined

      if (isDone || etype === 'done') {
        for (let i = steps.length - 1; i >= 0; i--) {
          if (steps[i].status === 'streaming') {
            steps[i] = { ...steps[i], status: 'success', endTime: Date.now() }
          }
        }
      }

      fullContent = steps
        .filter(s => s.type === StepType.TEXT_STREAM)
        .map(s => (s as TextStreamStep).content)
        .join('')

      updated[updated.length - 1] = {
        ...last,
        steps,
        content: fullContent || last.content,
      }
      return updated
    })
  }, [setMessages])

  return { applyAgentEvent }
}
