// ============================================================
// ConversationList — 会话历史列表（纯列表，由 Sidebar 组合）
// ============================================================

import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  TooltipProvider
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useChatStore } from '../../stores/chatStore'
import { CONVERSATION_ROW_HEIGHT, CONVERSATION_LIST_OVERSCAN } from '@/lib/constants'
import { SessionActionsDropdown } from './SessionActionsDropdown'

export function ConversationList() {
  const navigate = useNavigate()
  const sessions = useChatStore((s) => s.sessions)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const selectSession = useChatStore((s) => s.selectSession)
  const renameSession = useChatStore((s) => s.renameSession)

  // 行内重命名：记录正在编辑的会话 id 与草稿文本
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

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

  const startRename = (sessionId: string, currentTitle: string) => {
    setEditingId(sessionId)
    setDraft(currentTitle)
    // 等待 input 渲染后聚焦
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const commitRename = async (e: React.FormEvent) => {
    e.preventDefault()
    const id = editingId
    setEditingId(null)
    if (!id) return
    const trimmed = draft.trim()
    const session = sessions.find((s) => s.id === id)
    if (!trimmed || !session || trimmed === session.title) return
    await renameSession(id, trimmed)
  }

  const cancelRename = () => {
    setEditingId(null)
    setDraft('')
  }

  return (
    <div className="flex flex-col h-full">
      <TooltipProvider>
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
                      className="px-3"
                    >
                      <div
                        onClick={() => {
                          if (editingId === session.id) return
                          handleSelect(session.id)
                        }}
                        className={cn(
                          'group flex items-center gap-2 h-[32px] px-2.5 rounded-[8px] cursor-pointer transition-colors',
                          currentSessionId === session.id
                            ? 'bg-[#E6E8EB] text-accent-foreground'
                            : 'text-muted-foreground hover:bg-[#E6E8EB] hover:text-foreground'
                        )}
                      >
                        {editingId === session.id ? (
                          <form onSubmit={commitRename} className="flex-1" onClick={(e) => e.stopPropagation()}>
                            <input
                              ref={inputRef}
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onBlur={cancelRename}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') cancelRename()
                              }}
                              maxLength={200}
                              className="w-full text-[13px] bg-white border border-primary rounded px-1 py-0.5 outline-none"
                            />
                          </form>
                        ) : (
                          <span
                            onDoubleClick={() => startRename(session.id, session.title || '新对话')}
                            className="text-[13px] truncate flex-1 pl-0.5"
                            title="双击重命名"
                          >
                            {session.title || '新对话'}
                          </span>
                        )}
                        {/* 更多操作下拉菜单：打开文件夹 / 重命名 / 保存到工作空间 / 分享 / 删除 */}
                        <SessionActionsDropdown
                          session={session}
                          onRename={() => startRename(session.id, session.title || '新对话')}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          )}
        </div>
      </TooltipProvider>
    </div>
  )
}
