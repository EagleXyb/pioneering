import React, { useEffect, useState } from 'react'
import { Button, Tag, Skeleton } from 'tdesign-react'
import {
  ChatIcon,
  AddIcon,
  ViewListIcon,
  ChevronLeftDoubleIcon,
  ChevronRightDoubleIcon,
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
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    onRefresh()
  }, [onRefresh])

  return (
    <div className={`agent-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="agent-sidebar-header">
        {!collapsed && (
          <h3 className="agent-sidebar-title">
            <ChatIcon style={{ marginRight: 8, color: 'var(--ag-accent, #4f46e5)' }} />
            对话历史
          </h3>
        )}
        <div className="agent-sidebar-actions">
          {!collapsed && (
            <Button
              theme="primary"
              variant="text"
              shape="square"
              size="small"
              icon={<AddIcon />}
              onClick={onNewChat}
            />
          )}
          <Button
            theme="default"
            variant="text"
            shape="square"
            size="small"
            icon={collapsed ? <ChevronRightDoubleIcon /> : <ChevronLeftDoubleIcon />}
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          />
        </div>
      </div>

      {collapsed ? (
        <div className="agent-sidebar-collapsed-body">
          <div className="agent-sidebar-icon-strip">
            <Button
              theme="primary"
              variant="text"
              shape="square"
              size="small"
              icon={<AddIcon />}
              onClick={onNewChat}
              title="新对话"
            />
            <Button
              theme="default"
              variant="text"
              shape="square"
              size="small"
              icon={<ViewListIcon />}
              onClick={() => setCollapsed(false)}
              title="查看会话列表"
            />
            {currentSessionId && (
              <div className="agent-sidebar-session-indicator" title="当前会话" />
            )}
          </div>
        </div>
      ) : (
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
      )}
    </div>
  )
}