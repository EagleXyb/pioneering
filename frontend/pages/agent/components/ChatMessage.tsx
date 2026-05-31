import React, { useCallback, useMemo } from 'react'
import { ChatMessage as TdChatMessage } from '@tdesign-react/chat'
import { Button, Tag, MessagePlugin } from 'tdesign-react'
import { RefreshIcon } from 'tdesign-icons-react'
import type { ChatMessage } from '../types'

interface ChatMessageBubbleProps {
  message: ChatMessage
  onRegenerate?: () => void
}

export const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({
  message,
  onRegenerate,
}) => {
  const isUser = message.role === 'user'
  const hasThinkingContent = !!message.thinkingContent
  const hasToolCalls = !!(message.toolCalls && message.toolCalls.length > 0)
  const hasAnswerContent = !!(message.answerContent || message.content)
  const isThinking = message.currentPhase === 'thinking'

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

  const handleShare = useCallback(() => {
    const shareData = { text: message.content }
    if (navigator.share) {
      navigator.share(shareData).catch(() => {})
    } else {
      navigator.clipboard.writeText(message.content)
        .then(() => MessagePlugin.success('已复制到剪贴板'))
        .catch(() => MessagePlugin.error('复制失败'))
    }
  }, [message.content])

  const mapStatus = useMemo(() => {
    if (message.status === 'error') return 'error' as const
    if (message.status === 'loading') {
      if (hasAnswerContent || hasThinkingContent) return 'streaming' as const
      return 'pending' as const
    }
    return 'complete' as const
  }, [message.status, hasAnswerContent, hasThinkingContent])

  const assistantContent = useMemo(() => {
    const items: any[] = []

    if (hasThinkingContent) {
      items.push({
        type: 'thinking',
        data: { text: message.thinkingContent || '', title: '思考过程' },
        status: isThinking ? 'streaming' : 'complete',
      })
    }

    if (hasToolCalls) {
      message.toolCalls!.forEach((tc) => {
        items.push({
          type: 'toolcall',
          data: {
            toolCallId: tc.id,
            toolCallName: tc.name,
            args: tc.arguments,
            result: tc.result,
          },
        })
      })
    }

    if (hasAnswerContent) {
      items.push({
        type: 'markdown',
        data: message.answerContent || message.content || '',
      })
    }

    return items
  }, [message.thinkingContent, message.toolCalls, message.answerContent, message.content, hasThinkingContent, hasToolCalls, hasAnswerContent, isThinking])

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
      <TdChatMessage
        role="assistant"
        content={assistantContent.length > 0 ? assistantContent : undefined}
        status={mapStatus}
        placement="left"
        variant="base"
        actions={['copy', 'good', 'bad', 'share', 'replay']}
        handleActions={{
          copy: handleCopy,
          good: handleLike,
          bad: handleDislike,
          share: handleShare,
          replay: onRegenerate,
        }}
        chatContentProps={{
          thinking: { maxHeight: 400, animation: 'dots', layout: 'border' },
          markdown: {
            options: {
              syntax: {
                mathBlock: { engine: 'katex' },
                inlineMath: { engine: 'katex' },
              },
            },
          },
        }}
      />

      {message.status === 'error' && (
        <div className="agent-error">
          <Tag theme="danger" variant="light" size="small">
            {message.error || '生成失败'}
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
    </div>
  )
}