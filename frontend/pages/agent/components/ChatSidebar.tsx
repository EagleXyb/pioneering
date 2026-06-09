import React, { useEffect, useRef, useState } from 'react'
import { Button, Tag, Skeleton, Dialog, Input } from 'tdesign-react'
import {
  ChatIcon,
  AddIcon,
  ViewListIcon,
  EditIcon,
  PinFilledIcon,
  PinIcon,
  ShareIcon,
  CheckIcon,
  FolderOpenIcon,
  DownloadIcon,
  DeleteIcon,
} from 'tdesign-icons-react'
import type { ChatSession } from '../types'

const PanelLeftCloseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
    <path d="m16 15-3-3 3-3" />
  </svg>
)

const EllipsisIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </svg>
)

const PanelLeftOpenIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
    <path d="m14 9 3 3-3 3" />
  </svg>
)

interface ChatSidebarProps {
  sessions: ChatSession[]
  loading: boolean
  currentSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onNewChat: () => void
  onRefresh: () => void
  onRemoveSession?: (sessionId: string) => void
  onTogglePin?: (sessionId: string) => void
  onRenameSession?: (sessionId: string, newTitle: string) => void
}

interface MenuState {
  sessionId: string
  top: number
  left: number
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
  sessions,
  loading,
  currentSessionId,
  onSelectSession,
  onNewChat,
  onRefresh,
  onRemoveSession,
  onTogglePin,
  onRenameSession,
}) => {
  const [collapsed, setCollapsed] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renameState, setRenameState] = useState<{
    sessionId: string
    title: string
  } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const sidebarRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    onRefresh()
  }, [onRefresh])

  // 点击外部关闭菜单
  useEffect(() => {
    if (!menu) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (
        !target.closest('.agent-session-action-menu') &&
        !target.closest('.agent-session-action-trigger')
      ) {
        setMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menu])

  // 重命名窗口滚动/缩放时关闭菜单
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  const handleOpenMenu = (
    e: React.MouseEvent<HTMLElement>,
    sessionId: string,
  ) => {
    e.stopPropagation()
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const sidebarRect = sidebarRef.current?.getBoundingClientRect()
    const menuWidth = 200
    const menuHeight = 320
    // 默认贴右侧溢出
    let left = rect.right + 4
    if (sidebarRect && left + menuWidth > sidebarRect.right) {
      left = rect.left - menuWidth - 4
    }
    let top = rect.top
    if (top + menuHeight > window.innerHeight - 8) {
      top = window.innerHeight - menuHeight - 8
    }
    setMenu({ sessionId, top, left })
  }

  const handleRename = (session: ChatSession) => {
    setMenu(null)
    setRenameState({ sessionId: session.id, title: session.title })
    setRenameDraft(session.title)
  }

  const handleRenameConfirm = () => {
    if (renameState && onRenameSession) {
      onRenameSession(renameState.sessionId, renameDraft)
    }
    setRenameState(null)
  }

  const handleDelete = (session: ChatSession) => {
    setMenu(null)
    const sessionTitle = session.title
    const confirmed = window.confirm(
      `确定要删除对话"${sessionTitle}"吗？`,
    )
    if (confirmed && onRemoveSession) {
      onRemoveSession(session.id)
    }
  }

  return (
    <div ref={sidebarRef} className={`agent-sidebar ${collapsed ? 'collapsed' : ''}`}>
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
            icon={collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
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
              {sessions.map((session) => {
                const isPinned = session.pinned
                const isMenuOpen = menu?.sessionId === session.id
                return (
                  <div
                    key={session.id}
                    className={`agent-session-item ${currentSessionId === session.id ? 'active' : ''} ${isPinned ? 'pinned' : ''}`}
                    onClick={() => onSelectSession(session.id)}
                  >
                    <div className="agent-session-info">
                      <div className="agent-session-title-row">
                        {isPinned && (
                          <PinFilledIcon className="agent-session-pin-icon" />
                        )}
                        <div className="agent-session-title">
                          {session.title || '新对话'}
                        </div>
                        <button
                          className={`agent-session-action-trigger ${isMenuOpen ? 'is-open' : ''}`}
                          onClick={(e) => handleOpenMenu(e, session.id)}
                          title="更多操作"
                          aria-label="更多操作"
                        >
                          <EllipsisIcon />
                        </button>
                      </div>
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
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* 悬浮操作菜单（portal-style 定位） */}
      {menu &&
        (() => {
          const session = sessions.find((s) => s.id === menu.sessionId)
          if (!session) return null
          const isPinned = !!session.pinned
          return (
            <div
              className="agent-session-action-menu"
              style={{ top: menu.top, left: menu.left }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="agent-menu-item"
                onClick={() => handleRename(session)}
              >
                <EditIcon className="agent-menu-icon" />
                <span>重命名</span>
              </button>
              <button
                className="agent-menu-item"
                onClick={() => {
                  setMenu(null)
                  onTogglePin?.(session.id)
                }}
              >
                {isPinned ? (
                  <PinIcon className="agent-menu-icon" />
                ) : (
                  <PinFilledIcon className="agent-menu-icon" />
                )}
                <span>{isPinned ? '取消置顶' : '置顶'}</span>
              </button>
              <button
                className="agent-menu-item"
                onClick={() => {
                  setMenu(null)
                  navigator.clipboard
                    ?.writeText(`${window.location.origin}?session=${session.id}`)
                    .catch(() => {})
                }}
              >
                <ShareIcon className="agent-menu-icon" />
                <span>分享此对话</span>
              </button>
              <button
                className="agent-menu-item"
                onClick={() => {
                  setMenu(null)
                  alert('批量管理（前端占位）')
                }}
              >
                <CheckIcon className="agent-menu-icon" />
                <span>批量管理</span>
              </button>
              <div className="agent-menu-divider" />
              <button
                className="agent-menu-item has-submenu"
                onClick={() => {
                  setMenu(null)
                  alert('移动到分组（前端占位）')
                }}
              >
                <FolderOpenIcon className="agent-menu-icon" />
                <span>移动到分组</span>
                <span className="agent-menu-arrow">›</span>
              </button>
              <button
                className="agent-menu-item has-submenu"
                onClick={() => {
                  setMenu(null)
                  alert('导出对话（前端占位）')
                }}
              >
                <DownloadIcon className="agent-menu-icon" />
                <span>导出对话</span>
                <span className="agent-menu-arrow">›</span>
              </button>
              <div className="agent-menu-divider" />
              <button
                className="agent-menu-item is-danger"
                onClick={() => handleDelete(session)}
              >
                <DeleteIcon className="agent-menu-icon" />
                <span>删除此对话</span>
              </button>
            </div>
          )
        })()}

      {/* 重命名对话框 */}
      <Dialog
        visible={!!renameState}
        onClose={() => setRenameState(null)}
        header="重命名对话"
        width={420}
        onConfirm={handleRenameConfirm}
        confirmBtn="保存"
        cancelBtn="取消"
      >
        <div className="agent-rename-form">
          <div className="agent-rename-label">对话标题</div>
          <Input
            value={renameDraft}
            onChange={(v) => setRenameDraft(v as string)}
            placeholder="请输入新的对话标题"
            maxlength={50}
            autofocus
            onEnter={(v) => {
              setRenameDraft((v as string) ?? renameDraft)
              handleRenameConfirm()
            }}
          />
          <div className="agent-rename-hint">
            新的标题仅在本设备显示，不会同步到服务器
          </div>
        </div>
      </Dialog>
    </div>
  )
}

export default ChatSidebar
