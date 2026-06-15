import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react'
import { ChatMessage as TdChatMessage, ChatActionBar } from '@tdesign-react/chat'
import { Tag, Loading, MessagePlugin, Button } from 'tdesign-react'
import { ChevronDownIcon } from 'tdesign-icons-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import type { ChatMessage, TextStreamStep } from '../shared/types'
import { StepType } from '../shared/types'
import type { ChatMode } from '../shared/types'
import { useThrottledContent } from '../shared/hooks/useThrottledContent'
import { ExecutionCard } from './ExecutionCard'
import { CodeBlock } from './steps/CodeBlock'
import type { TdChatActionsName } from 'tdesign-web-components/lib/chat-action'
import type { RunState } from '../../agent-professional/hooks/useAgentRun'

const COLLAPSE_MAX_HEIGHT = 300

interface ChatMessageBubbleProps {
  message: ChatMessage
  onRegenerate?: () => void
  executionState?: RunState | null
  isGenerating?: boolean
  chatMode?: ChatMode
}

export const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({
  message,
  onRegenerate,
  executionState,
  isGenerating,
  chatMode,
}) => {
  const isUser = message.role === 'user'

  const handleAction = useCallback(
    (name: TdChatActionsName) => {
      switch (name) {
        case 'copy':
          break
        case 'good':
          MessagePlugin.success('Thanks for feedback')
          break
        case 'bad':
          MessagePlugin.info('We will work to improve')
          break
        case 'share':
          MessagePlugin.info('Share feature')
          break
        case 'replay':
          onRegenerate?.()
          break
      }
    },
    [onRegenerate],
  )

  // Combine all TEXT_STREAM step contents into a single block
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

  const isStreaming = textStreamSteps.some((s) => s.status === 'streaming')

  // Collapse state
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const [needsCollapse, setNeedsCollapse] = useState(false)

  useEffect(() => {
    if (contentRef.current && !isStreaming) {
      setNeedsCollapse(contentRef.current.scrollHeight > COLLAPSE_MAX_HEIGHT)
    }
    if (isStreaming) {
      setNeedsCollapse(false)
      setExpanded(false)
    }
  }, [throttledContent, isStreaming])

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
            <Loading size="medium" text="Thinking..." />
          </div>
        )}

        {message.steps.length === 0 && message.status !== 'loading' && message.content && (
          <div className="agent-text-only">
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
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  )
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {chatMode === 'professional' && executionState && (
          <ExecutionCard runState={executionState} message={message} isGenerating={!!isGenerating} />
        )}

        {hasTextOutput && (
          <div className={`agent-steps ${isStreaming ? 'streaming' : ''}`}>
            <div
              ref={contentRef}
              className="agent-output-content"
              style={{
                maxHeight: expanded ? 'none' : COLLAPSE_MAX_HEIGHT,
                overflow: 'hidden',
              }}
            >
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
                    return (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    )
                  },
                }}
              >
                {throttledContent}
              </ReactMarkdown>
            </div>
            {needsCollapse && !expanded && (
              <div className="agent-output-fade" />
            )}
            {needsCollapse && (
              <div className="agent-output-expand">
                <Button
                  theme="default"
                  variant="text"
                  size="small"
                  icon={<ChevronDownIcon />}
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? 'Collapse' : 'Expand'}
                </Button>
              </div>
            )}
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

export default ChatMessageBubble
