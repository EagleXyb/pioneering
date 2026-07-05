// ============================================================
// AppLayout — 应用主布局（含侧边栏导航）
// ============================================================

import { useState, useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  MessageSquare,
  Bot,
  Settings,
  Home,
  Plus,
  Trash2,
  ChevronLeft,
  PanelLeftClose,
  PanelLeft
} from 'lucide-react'
import { Button } from '../ui/button'
import { useChatStore } from '../../store/chatStore'
import { cn } from '../../lib/utils'
import { shellApi } from '../../services/ipc'

interface NavItem {
  path: string
  label: string
  icon: React.ReactNode
}

const navItems: NavItem[] = [
  { path: '/', label: 'Home', icon: <Home className="size-4" /> },
  {
    path: '/chat',
    label: 'Chat',
    icon: <MessageSquare className="size-4" />
  },
  { path: '/agent', label: 'Agent', icon: <Bot className="size-4" /> },
  {
    path: '/settings',
    label: 'Settings',
    icon: <Settings className="size-4" />
  }
]

export function AppLayout(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const {
    sessions,
    currentSessionId,
    loadSessions,
    createSession,
    selectSession,
    deleteSession
  } = useChatStore()

  // 进入 Chat 页面时加载会话列表
  useEffect(() => {
    if (location.pathname === '/chat' && sessions.length === 0) {
      loadSessions()
    }
  }, [location.pathname, sessions.length, loadSessions])

  const handleNewChat = async () => {
    try {
      const session = await createSession()
      navigate(`/chat?session=${session.id}`)
    } catch {
      // 错误已在 store 中处理
    }
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* 侧边栏 */}
      <aside
        className={cn(
          'flex flex-col border-r border-border bg-card transition-all duration-200',
          sidebarOpen ? 'w-64' : 'w-0 overflow-hidden'
        )}
      >
        <div className="flex items-center justify-between p-3 border-b border-border">
          <h2 className="font-semibold text-sm truncate">Pioneering AI</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(false)}
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>

        {/* 导航链接 */}
        <nav className="p-2 space-y-1">
          {navItems.map((item) => (
            <Button
              key={item.path}
              variant={location.pathname === item.path ? 'secondary' : 'ghost'}
              className="w-full justify-start gap-2"
              onClick={() => navigate(item.path)}
            >
              {item.icon}
              {item.label}
            </Button>
          ))}
        </nav>

        {/* Chat 页特有：会话列表 */}
        {location.pathname === '/chat' && (
          <>
            <div className="px-3 py-2 border-t border-border">
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                size="sm"
                onClick={handleNewChat}
              >
                <Plus className="size-4" />
                New Chat
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto px-2">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={cn(
                    'group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm hover:bg-accent',
                    currentSessionId === session.id && 'bg-accent'
                  )}
                  onClick={() => {
                    selectSession(session.id)
                    navigate(`/chat?session=${session.id}`)
                  }}
                >
                  <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">
                    {session.title || 'Untitled'}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 opacity-0 group-hover:opacity-100 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteSession(session.id)
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
      </aside>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶栏 */}
        <header className="flex items-center gap-2 h-12 px-4 border-b border-border shrink-0">
          {!sidebarOpen && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeft className="size-4" />
            </Button>
          )}
          <div className="flex-1" />
        </header>

        {/* 页面内容 */}
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
