// ============================================================
// ConversationList — 会话历史列表（左栏）
// ============================================================

import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { PanelLeftClose, PanelLeftOpen, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { useAtom } from 'jotai'
import { sidebarVisibleAtom } from '@/stores/atoms'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { usePlatform } from '@/hooks/usePlatform'
import { formatAccelerator } from '@/menu/formatAccelerator'
import { useChatStore } from '../../stores/chatStore'
import { CONVERSATION_ROW_HEIGHT, CONVERSATION_LIST_OVERSCAN } from '@/lib/constants'

export function ConversationList() {
  const navigate = useNavigate()
  const { platform } = usePlatform()
  const [sidebarVisible, setSidebarVisible] = useAtom(sidebarVisibleAtom)
  const { sessions, currentSessionId, selectSession, createSession, deleteSession } = useChatStore()

  // 长列表虚拟化：仅渲染视口内行，避免大量会话时 DOM 膨胀（固定行高）
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () =>
      scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null,
    estimateSize: () => CONVERSATION_ROW_HEIGHT,
    overscan: CONVERSATION_LIST_OVERSCAN
  })

  const handleSelect = (sessionId: string) => {
    selectSession(sessionId)
    navigate('/')
  }

  const handleCreate = async () => {
    await createSession()
    navigate('/')
  }

  const handleDelete = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    // B9 修复：原实现点击删除图标直接删除，误触风险高。增加确认弹窗。
    if (!window.confirm('确定删除该对话？删除后不可恢复。')) return
    deleteSession(sessionId)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header — Logo + 侧边栏切换 + 新建任务等操作入口 */}
      <div className="conversation-list-header px-3 pb-4 flex flex-col gap-2 shrink-0">
        <TooltipProvider>
          {/* Top row: Logo + sidebar toggle */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded bg-sidebar-primary flex items-center justify-center">
                <span className="text-[10px] font-bold text-sidebar-primary-foreground">P</span>
              </div>
              <span className="text-xs font-semibold text-foreground/90">Pioneering</span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setSidebarVisible(!sidebarVisible)}
                >
                  {sidebarVisible ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center" className="text-xs">
                {sidebarVisible ? '收起侧边栏' : '展开侧边栏'}
              </TooltipContent>
            </Tooltip>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="group/new-task w-full h-8 px-3 justify-between text-xs font-normal rounded-lg"
            onClick={handleCreate}
          >
            <span className="inline-flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              新建任务
            </span>
            <kbd
              className={cn(
                'inline-flex items-center rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground',
                'opacity-0 -translate-x-1 transition-all duration-150',
                'group-hover/new-task:opacity-100 group-hover/new-task:translate-x-0',
                'sm:inline-flex'
              )}
            >
              {formatAccelerator('CmdOrCtrl+N', platform)}
            </kbd>
          </Button>
        </TooltipProvider>
      </div>

      {/* Content — 会话列表（长列表虚拟化） */}
      <div className="conversation-list-content flex-1 min-h-0">
        {sessions.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-muted-foreground">暂无对话</p>
            <p className="text-[11px] text-muted-foreground/60 mt-1">
              新建对话开始交流
            </p>
          </div>
        ) : (
          <ScrollArea ref={scrollRef} className="h-full">
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
              {virtualizer.getVirtualItems().map((row) => {
                const session = sessions[row.index]
                if (!session) return null
                return (
                  <div
                    key={session.id}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${row.size}px`,
                      transform: `translateY(${row.start}px)`
                    }}
                    className="px-1.5"
                  >
                    <div
                      onClick={() => handleSelect(session.id)}
                      className={cn(
                        'group flex items-center gap-2 h-[32px] px-2.5 rounded-md cursor-pointer transition-colors',
                        currentSessionId === session.id
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                      )}
                    >
                      <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                      <span className="text-xs truncate flex-1">{session.title || '新对话'}</span>
                      <button
                        onClick={(e) => handleDelete(e, session.id)}
                        className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-all p-0.5"
                        title="删除"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}
