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
import type { ChatSession } from '../shared/types'

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

  // Close menu when clicking outside
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

  // Close menu on resize/scroll
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
    // Default: float to right
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
      `纭畾瑕佸垹闄ゅ璇?${sessionTitle}"鍚楋紵`,
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
            Chat History
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
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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
              title="New Chat"
            />
            <Button
              theme="default"
              variant="text"
              shape="square"
              size="small"
              icon={<ViewListIcon />}
              onClick={() => setCollapsed(false)}
              title="View session list"
            />
            {currentSessionId && (
              <div className="agent-sidebar-session-indicator" title="Current session" />
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
              <p>No chat history</p>
              <Button theme="primary" variant="outline" size="small" onClick={onNewChat}>
                Start new chat
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
                          {session.title || 'New Chat'}
                        </div>
                        <button
                          className={`agent-session-action-trigger ${isMenuOpen ? 'is-open' : ''}`}
                          onClick={(e) => handleOpenMenu(e, session.id)}
                          title="More actions"
                          aria-label="More actions"
                        >
                          <EllipsisIcon />
                        </button>
                      </div>
                      <div className="agent-session-meta">
                        <Tag size="small" variant="light" theme="default">
                          {session.model || 'unknown'}
                        </Tag>
                        <span className="agent-session-msg-count">
                          {session.messageCount || 0} messages                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Floating action menu (portal-style) */}
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
                <span>Rename</span>
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
                <span>{isPinned ? 'Unpin' : 'Pin'}</span>
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
                <span>Share</span>
              </button>
              <button
                className="agent-menu-item"
                onClick={() => {
                  setMenu(null)
                  alert('Batch manage (placeholder)')
                }}
              >
                <CheckIcon className="agent-menu-icon" />
                <span>Batch Manage</span>
              </button>
              <div className="agent-menu-divider" />
              <button
                className="agent-menu-item has-submenu"
                onClick={() => {
                  setMenu(null)
                  alert('Move to group (placeholder)')
                }}
              >
                <FolderOpenIcon className="agent-menu-icon" />
                <span>Move to Group</span>
                <span className="agent-menu-arrow">&gt;</span>
              </button>
              <button
                className="agent-menu-item has-submenu"
                onClick={() => {
                  setMenu(null)
                  alert('Export chat (placeholder)')
                }}
              >
                <DownloadIcon className="agent-menu-icon" />
                <span>Export</span>
                <span className="agent-menu-arrow">&gt;</span>
              </button>
              <div className="agent-menu-divider" />
              <button
                className="agent-menu-item is-danger"
                onClick={() => handleDelete(session)}
              >
                <DeleteIcon className="agent-menu-icon" />
                <span>Delete</span>
              </button>
            </div>
          )
        })()}

      {/* Rename Dialog */}
      <Dialog
        visible={!!renameState}
        onClose={() => setRenameState(null)}
        header="Rename"
        width={420}
        onConfirm={handleRenameConfirm}
        confirmBtn="Save"
        cancelBtn="Cancel"
      >
        <div className="agent-rename-form">
          <div className="agent-rename-label">Session Title</div>
          <Input
            value={renameDraft}
            onChange={(v) => setRenameDraft(v as string)}
            placeholder="Enter a new session title"
            maxlength={50}
            autofocus
            onEnter={(v) => {
              setRenameDraft((v as string) ?? renameDraft)
              handleRenameConfirm()
            }}
          />
          <div className="agent-rename-hint">
            The new title is only displayed locally and will not be synced to the server
          </div>
        </div>
      </Dialog>
    </div>
  )
}

export default ChatSidebar
