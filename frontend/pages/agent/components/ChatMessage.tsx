import React, { useCallback } from 'react'
import { ChatMessage as TdChatMessage } from '@tdesign-react/chat'
import { Button, Tag, Loading, MessagePlugin } from 'tdesign-react'
import { RefreshIcon } from 'tdesign-icons-react'
import type { ChatMessage, TextStreamStep } from '../types'
import { StepType } from '../types'
import { StepRenderer } from './StepRenderer'

interface ChatMessageBubbleProps {
  message: ChatMessage
  onRegenerate?: () => void
}

export const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({
  message,
  onRegenerate,
}) => {
  const isUser = message.role === 'user'

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      MessagePlugin.success('已复制到剪贴板')
    } catch {
      MessagePlugin.error('复制失败')
    }
  }, [message.content])

  const handleLike = useCallback(() => {
    MessagePlugin.success('感谢反馈')
  }, [])

  const handleDislike = useCallback(() => {
    MessagePlugin.info('我们会努力改进')
  }, [])

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
            <Loading size="medium" text="思考中..." />
          </div>
        )}

        {message.steps.length === 0 && message.status !== 'loading' && message.content && (
          <div className="agent-text-only">
            <StepRenderer
              step={{
                id: `legacy_${message.id}`,
                type: StepType.TEXT_STREAM,
                content: message.content,
                status: 'success',
                startTime: message.timestamp,
                endTime: message.timestamp,
              } as TextStreamStep}
            />
          </div>
        )}

        {message.steps.length > 0 && (
          <div className="agent-steps">
            {message.steps.map((step) => (
              <StepRenderer key={step.id} step={step} />
            ))}
          </div>
        )}

        {message.status === 'error' && message.error && (
          <div className="agent-error">
            <Tag theme="danger" variant="light" size="small">
              {message.error}
            </Tag>
            {onRegenerate && (
              <Button
                theme="primary"
                variant="text"
                size="small"
                icon={<RefreshIcon />}
                onClick={onRegenerate}
              >
                重新生成
              </Button>
            )}
          </div>
        )}

        {message.status !== 'error' && message.content && (
          <div className="agent-message-actions">
            <Button
              theme="default"
              variant="text"
              size="small"
              onClick={handleCopy}
            >
              复制
            </Button>
            <Button theme="default" variant="text" size="small" onClick={handleLike}>
              点赞
            </Button>
            <Button
              theme="default"
              variant="text"
              size="small"
              onClick={handleDislike}
            >
              反馈
            </Button>
            {onRegenerate && (
              <Button
                theme="default"
                variant="text"
                size="small"
                icon={<RefreshIcon />}
                onClick={onRegenerate}
              >
                重新生成
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default ChatMessageBubble
