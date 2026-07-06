// ============================================================
// ConversationList — 会话历史列表（左栏）
// ============================================================

import { MessageSquare, Plus, Trash2 } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useChatStore } from '../../stores/chatStore'

export function ConversationList() {
  const { sessions, currentSessionId, selectSession, createSession, deleteSession } = useChatStore()

  const handleDelete = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    deleteSession(sessionId)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-border shrink-0">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          对话
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => createSession()}
          title="新建对话"
        >
          <Plus className="h-3.5 w-3.5" />
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
                onClick={() => selectSession(session.id)}
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
