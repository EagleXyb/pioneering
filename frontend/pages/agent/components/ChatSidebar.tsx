import React, { useEffect } from 'react'
import { Button, Tag, Skeleton } from 'tdesign-react'
import {
  ChatIcon,
  AddIcon,
  RefreshIcon,
} from 'tdesign-icons-react'
import type { ChatSession } from '../types'

interface ChatSidebarProps {
  sessions: ChatSession[]
  loading: boolean
  currentSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onNewChat: () => void
  onRefresh: () => void
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
  sessions,
  loading,
  currentSessionId,
  onSelectSession,
  onNewChat,
  onRefresh,
}) => {
  useEffect(() => {
    onRefresh()
  }, [onRefresh])

  return (
    <div className="agent-sidebar">
      <div className="agent-sidebar-header">
        <h3 className="agent-sidebar-title">
          <ChatIcon style={{ marginRight: 8 }} />
          对话历史
        </h3>
        <div className="agent-sidebar-actions">
          <Button
            theme="default"
            variant="text"
            shape="square"
            size="small"
            icon={<RefreshIcon />}
            onClick={onRefresh}
          />
          <Button
            theme="primary"
            variant="text"
            shape="square"
            size="small"
            icon={<AddIcon />}
            onClick={onNewChat}
          />
        </div>
      </div>

      <div className="agent-sidebar-body">
        {loading ? (
          <div style={{ padding: 16 }}>
            <Skeleton theme="text" rowCol={[1, 1, 1, 1]} />
          </div>
        ) : sessions.length === 0 ? (
          <div className="agent-sidebar-empty">
            <ChatIcon size="32px" style={{ color: 'var(--td-text-color-placeholder)' }} />
            <p>暂无对话记录</p>
            <Button theme="primary" variant="outline" size="small" onClick={onNewChat}>
              开始新对话
            </Button>
          </div>
        ) : (
          <div className="agent-session-list">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`agent-session-item ${currentSessionId === session.id ? 'active' : ''}`}
                onClick={() => onSelectSession(session.id)}
              >
                <div className="agent-session-info">
                  <div className="agent-session-title">{session.title || '新对话'}</div>
                  <div className="agent-session-meta">
                    <Tag size="small" variant="light" theme="default">
                      {session.model || 'unknown'}
                    </Tag>
                    <span className="agent-session-msg-count">
                      {session.messageCount || 0} 条消息
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}