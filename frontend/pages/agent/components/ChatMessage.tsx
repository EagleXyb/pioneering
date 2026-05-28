import React, { useCallback, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button, Tag, Tooltip, MessagePlugin } from 'tdesign-react'
import {
  ThumbUpIcon,
  ThumbDownIcon,
  CopyIcon,
  RefreshIcon,
  UserIcon,
} from 'tdesign-icons-react'
import type { ChatMessage } from '../types'

interface ChatMessageBubbleProps {
  message: ChatMessage
  onRegenerate?: () => void
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({
  message,
  onRegenerate,
}) => {
  const [feedback, setFeedback] = useState<'like' | 'dislike' | null>(null)
  const isUser = message.role === 'user'
  const isLoading = message.status === 'loading'

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      MessagePlugin.success('已复制到剪贴板')
    } catch {
      MessagePlugin.error('复制失败')
    }
  }, [message.content])

  const handleLike = useCallback(() => {
    setFeedback((prev) => (prev === 'like' ? null : 'like'))
    MessagePlugin.success('感谢反馈')
  }, [])

  const handleDislike = useCallback(() => {
    setFeedback((prev) => (prev === 'dislike' ? null : 'dislike'))
    MessagePlugin.info('我们会努力改进')
  }, [])

  return (
    <div className={`agent-message-row ${isUser ? 'agent-user-row' : 'agent-assistant-row'}`}>
      {!isUser && (
        <div className="agent-avatar">
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              backgroundColor: 'var(--td-brand-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>AI</span>
          </div>
        </div>
      )}

      <div className={`agent-bubble ${isUser ? 'agent-user-bubble' : 'agent-assistant-bubble'}`}>
        <div className="agent-bubble-header">
          <span className="agent-bubble-role">
            {isUser ? '你' : 'AI 助手'}
          </span>
          <span className="agent-bubble-time">{formatTime(message.timestamp)}</span>
        </div>

        <div className="agent-bubble-body">
          {isLoading && !message.content ? (
            <div className="agent-loading">
              <span className="agent-loading-dot" />
              <span className="agent-loading-dot" />
              <span className="agent-loading-dot" />
            </div>
          ) : isUser ? (
            <div className="agent-content-text">{message.content}</div>
          ) : (
            <div className="agent-content-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content || '思考中...'}
              </ReactMarkdown>
            </div>
          )}
        </div>

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

        {!isUser && !isLoading && message.status !== 'error' && (
          <div className="agent-bubble-actions">
            <Tooltip content="复制">
              <Button
                theme="default"
                variant="text"
                size="small"
                shape="square"
                icon={<CopyIcon />}
                onClick={handleCopy}
              />
            </Tooltip>
            <Tooltip content="赞同">
              <Button
                theme={feedback === 'like' ? 'primary' : 'default'}
                variant="text"
                size="small"
                shape="square"
                icon={<ThumbUpIcon />}
                onClick={handleLike}
              />
            </Tooltip>
            <Tooltip content="不赞同">
              <Button
                theme={feedback === 'dislike' ? 'danger' : 'default'}
                variant="text"
                size="small"
                shape="square"
                icon={<ThumbDownIcon />}
                onClick={handleDislike}
              />
            </Tooltip>
            {onRegenerate && (
              <Tooltip content="重新生成">
                <Button
                  theme="default"
                  variant="text"
                  size="small"
                  shape="square"
                  icon={<RefreshIcon />}
                  onClick={onRegenerate}
                />
              </Tooltip>
            )}
          </div>
        )}
      </div>

      {isUser && (
        <div className="agent-avatar agent-user-avatar">
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              backgroundColor: 'var(--td-bg-color-component)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--td-component-border)',
            }}
          >
            <UserIcon size="18px" />
          </div>
        </div>
      )}
    </div>
  )
}