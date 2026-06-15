import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { ChatMessage as TdChatMessage, ChatActionBar } from '@tdesign-react/chat'
import { Tag, Loading, MessagePlugin, Button } from 'tdesign-react'
import { ChevronDownIcon, ChevronRightIcon } from 'tdesign-icons-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import type { AgentMessage, AgentStep, ThinkingStep, ToolCallStep, ToolResultStep, TextStreamStep } from '../types'
import { StepType } from '../types'
import { useThrottledContent } from '../../workspace/shared/hooks/useThrottledContent'
import { CodeBlock } from './steps/CodeBlock'
import type { TdChatActionsName } from 'tdesign-web-components/lib/chat-action'

interface AgentMessageBubbleProps {
  message: AgentMessage
  onRegenerate?: () => void
  isGenerating?: boolean
}

const StepIcon: React.FC<{ type: string; status: string }> = ({ type, status }) => {
  const iconMap: Record<string, string> = {
    [StepType.THINKING]: '💭',
    [StepType.TOOL_CALL]: '🔧',
    [StepType.TOOL_RESULT]: '📋',
    [StepType.TEXT_STREAM]: '✍️',
    [StepType.REASONING_ITERATION]: '🔄',
    [StepType.ERROR]: '❌',
  }
  const statusIcon = status === 'streaming' ? '⏳' : status === 'error' ? '❌' : '✅'
  return (
    <span className="agent-step-icon">
      {iconMap[type] || '•'} {statusIcon}
    </span>
  )
}

const StepRow: React.FC<{ step: AgentStep; defaultExpanded?: boolean }> = ({ step, defaultExpanded = false }) => {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const title = useMemo(() => {
    switch (step.type) {
      case StepType.THINKING:
        return 'Thinking Process'
      case StepType.TOOL_CALL:
        return `Call Tool: ${(step as ToolCallStep).toolName}`
      case StepType.TOOL_RESULT:
        return `Tool Result: ${(step as ToolResultStep).toolName}`
      case StepType.TEXT_STREAM:
        return 'Generate Answer'
      case StepType.REASONING_ITERATION:
        return `Reasoning Iteration ${(step as import('../types').ReasoningIterationStep).iterationIndex}/${(step as import('../types').ReasoningIterationStep).maxIterations}`
      case StepType.ERROR:
        return `Error: ${(step as import('../types').ErrorStep).errorCode}`
      default:
        return 'Unknown Step'
    }
  }, [step])

  const content = useMemo(() => {
    switch (step.type) {
      case StepType.THINKING:
        return (step as ThinkingStep).content
      case StepType.TOOL_CALL:
        return (step as ToolCallStep).arguments
      case StepType.TOOL_RESULT:
        return (step as ToolResultStep).result
      case StepType.TEXT_STREAM:
        return (step as TextStreamStep).content
      case StepType.ERROR:
        return (step as import('../types').ErrorStep).message
      default:
        return ''
    }
  }, [step])

  const hasContent = content && content.length > 0
  const isStreaming = step.status === 'streaming'

  return (
    <div className={`agent-step-row ${step.status}`}>
      <div
        className="agent-step-header"
        onClick={() => hasContent && setExpanded(!expanded)}
        style={{ cursor: hasContent ? 'pointer' : 'default' }}
      >
        <StepIcon type={step.type} status={step.status} />
        <span className="agent-step-title">{title}</span>
        {isStreaming && <Loading size="small" />}
        {hasContent && (
          <span className="agent-step-toggle">
            {expanded ? <ChevronDownIcon size="16px" /> : <ChevronRightIcon size="16px" />}
          </span>
        )}
      </div>
      {expanded && hasContent && (
        <div className="agent-step-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '')
                const codeStr = String(children).replace(/\n$/, '')
                if (match) {
                  return <CodeBlock language={match[1]} value={codeStr} />
                }
                return <code className={className} {...props}>{children}</code>
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  )
}

export const AgentMessageBubble: React.FC<AgentMessageBubbleProps> = ({
  message,
  onRegenerate,
  isGenerating,
}) => {
  const isUser = message.role === 'user'

  const handleAction = useCallback(
    (name: TdChatActionsName) => {
      switch (name) {
        case 'copy':
          break
        case 'good':
          MessagePlugin.success('感谢反馈')
          break
        case 'bad':
          MessagePlugin.info('我们会努力改进')
          break
        case 'share':
          MessagePlugin.info('分享功能')
          break
        case 'replay':
          onRegenerate?.()
          break
      }
    },
    [onRegenerate],
  )

  const textStreamSteps = useMemo(
    () => message.steps.filter((s) => s.type === StepType.TEXT_STREAM),
    [message.steps],
  )
  const rawCombinedContent = useMemo(
    () => textStreamSteps.map((s) => (s as TextStreamStep).content).join(''),
    [textStreamSteps],
  )
  const throttledContent = useThrottledContent(rawCombinedContent, 50)
  const hasTextOutput = throttledContent.length > 0

  const nonTextSteps = useMemo(
    () => message.steps.filter((s) => s.type !== StepType.TEXT_STREAM),
    [message.steps],
  )
  const hasSteps = nonTextSteps.length > 0

  if (isUser) {
    return (
      <div className="agent-message-row agent-user-row">
        <TdChatMessage
          role="user"
          content={[{ type: 'text', data: message.content }]}
          placement="right"
          variant="base"
        />
      </div>
    )
  }

  return (
    <div className="agent-message-row agent-assistant-row">
      <div className="agent-assistant-content">
        {message.steps.length === 0 && message.status === 'loading' && (
          <div className="agent-loading">
            <Loading size="medium" text="Agent is thinking..." />
          </div>
        )}

        {hasSteps && (
          <div className="agent-steps-panel">
            {nonTextSteps.map((step, idx) => (
              <StepRow
                key={step.id || idx}
                step={step}
                defaultExpanded={step.type === StepType.ERROR}
              />
            ))}
          </div>
        )}

        {hasTextOutput && (
          <div className="agent-output-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '')
                  const codeStr = String(children).replace(/\n$/, '')
                  if (match) {
                    return <CodeBlock language={match[1]} value={codeStr} />
                  }
                  return <code className={className} {...props}>{children}</code>
                },
              }}
            >
              {throttledContent}
            </ReactMarkdown>
          </div>
        )}

        {message.status === 'error' && message.error && (
          <div className="agent-error">
            <Tag theme="danger" variant="light" size="small">
              {message.error}
            </Tag>
          </div>
        )}

        {message.status !== 'error' && message.content && (
          <ChatActionBar
            copyText={message.content}
            handleAction={handleAction}
            actionBar={['copy', 'good', 'bad', 'share', ...(onRegenerate ? ['replay'] : [])] as TdChatActionsName[]}
            tooltipProps={{ theme: 'light', showArrow: false }}
            style={{ marginTop: 4, opacity: 0.7 }}
          />
        )}
      </div>
    </div>
  )
}

export default AgentMessageBubble
