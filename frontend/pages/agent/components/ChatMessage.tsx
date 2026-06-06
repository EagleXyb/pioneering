import React, { useCallback } from 'react'
import { ChatMessage as TdChatMessage, ChatActionBar } from '@tdesign-react/chat'
import { Tag, Loading, MessagePlugin } from 'tdesign-react'
import type { ChatMessage, TextStreamStep } from '../types'
import { StepType } from '../types'
import { StepRenderer } from './StepRenderer'
import type { TdChatActionsName } from 'tdesign-web-components/lib/chat-action'

interface ChatMessageBubbleProps {
  message: ChatMessage
  onRegenerate?: () => void
}

export const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({
  message,
  onRegenerate,
}) => {
  const isUser = message.role === 'user'

  const handleAction = useCallback(
    (name: TdChatActionsName) => {
      switch (name) {
        case 'good':
          MessagePlugin.success('感谢反馈')
          break
        case 'bad':
          MessagePlugin.info('我们会努力改进')
          break
        case 'replay':
          onRegenerate?.()
          break
      }
    },
    [onRegenerate],
  )

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
          </div>
        )}

        {message.status !== 'error' && message.content && (
          <ChatActionBar
            copyText={message.content}
            handleAction={handleAction}
            actionBar={['copy', 'good', 'bad', ...(onRegenerate ? ['replay'] : [])] as TdChatActionsName[]}
            tooltipProps={{ theme: 'light', showArrow: false }}
          />
        )}
      </div>
    </div>
  )
}

export default ChatMessageBubble
