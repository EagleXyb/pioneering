// ============================================================
// ConversationList — 会话历史列表（左栏）
// ============================================================

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageSquare, Plus, Trash2 } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { usePlatform } from '@/hooks/usePlatform'
import { useChatStore } from '../../stores/chatStore'

export function ConversationList() {
  const navigate = useNavigate()
  const { isMac } = usePlatform()
  const { sessions, currentSessionId, selectSession, createSession, deleteSession } = useChatStore()

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
    deleteSession(sessionId)
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isModifier = isMac ? e.metaKey : e.ctrlKey
      if (isModifier && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void handleCreate()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isMac])

  return (
    <div className="flex flex-col h-full">
      {/* New task button */}
      <div className="px-2 py-2 border-b border-border shrink-0">
        <Button
          variant="secondary"
          size="sm"
          className="w-full h-8 px-3 justify-between text-xs font-normal rounded-lg"
          onClick={handleCreate}
          title="新建任务"
        >
          <span className="inline-flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            新建任务
          </span>
          <kbd className="hidden sm:inline-flex items-center rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {isMac ? '⌘ N' : 'Ctrl + N'}
          </kbd>
        </Button>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="p-1.5 space-y-0.5">
          {sessions.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-xs text-muted-foreground">暂无对话</p>
              <p className="text-[11px] text-muted-foreground/60 mt-1">
                新建对话开始交流
              </p>
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => handleSelect(session.id)}
                className={cn(
                  'group flex items-center gap-2 px-2.5 py-2 rounded-md cursor-pointer transition-colors',
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
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
