// ============================================================
// SessionActionsDropdown — 会话行右侧「⋯」更多操作下拉菜单
// ============================================================
// 对齐截图视觉：hover 会话行时右侧显示三圆点按钮，点击展开：
//   打开文件夹 / 重命名 / 保存到工作空间（占位） / 分享任务 / 删除任务
//
// 依赖说明（后端未就绪的降级策略）：
//   - 打开文件夹：走 IPC FILE_SHOW_IN_FOLDER（打开 userData 数据目录）
//   - 保存到工作空间：disabled 占位「即将开放」，后端就绪后启用子菜单
//   - 分享任务：优先取后端 shareUrl 复制到剪贴板；后端 404 时降级复制会话信息
//   - 删除任务：通过全局 ConfirmDialog（Radix Dialog）弹出自定义确认，
//     样式对齐截图：⚠ 警告图标 + 「确认删除」红底按钮
//
// 溢出规避：DropdownMenuContent 内置 Radix Portal（挂载到 body），
// 天然脱离 ScrollArea / 虚拟化容器的 overflow 裁剪。
// ============================================================

import { useCallback, useState, memo } from 'react'
import { useSetAtom } from 'jotai'
import {
  MoreHorizontal,
  FolderOpen,
  PencilLine,
  Save,
  Share2,
  Trash2,
  Check
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { fileApi, clipboardApi } from '@/services/ipc'
import { useChatStore } from '@/stores/chatStore'
import { openConfirmDialogAtom } from '@/stores/atoms'
import type { ChatSession } from '@shared/types'

interface SessionActionsDropdownProps {
  session: ChatSession
  /** 触发行内重命名（复用 ConversationList 的 inline 编辑逻辑） */
  onRename: () => void
}

export const SessionActionsDropdown = memo(function SessionActionsDropdown({
  session,
  onRename
}: SessionActionsDropdownProps) {
  const deleteSession = useChatStore((s) => s.deleteSession)
  const shareSession = useChatStore((s) => s.shareSession)
  const openConfirm = useSetAtom(openConfirmDialogAtom)
  const [copied, setCopied] = useState(false)

  // 打开文件夹：无参 → 主进程打开 userData 数据目录（路径白名单校验在主进程）
  const handleOpenFolder = useCallback(() => {
    void fileApi.showInFolder()
  }, [])

  // 删除：通过全局 ConfirmDialog 弹出自定义确认（替换原 window.confirm）
  const handleDelete = useCallback(() => {
    const id = session.id
    const sessionTitle = session.title || '新对话'
    openConfirm({
      id: `delete-session-${id}-${Date.now()}`,
      title: '删除任务',
      description: `确认后将从列表中删除任务「${sessionTitle}」，请确认是否删除？`,
      confirmText: '确认删除',
      confirmVariant: 'destructive',
      icon: 'warning',
      onConfirm: async () => deleteSession(id)
    })
  }, [deleteSession, session.id, session.title, openConfirm])

  // 分享：后端就绪取 shareUrl，未就绪降级复制会话信息；菜单保持打开展示「已复制」
  const handleShare = useCallback(async () => {
    const url = await shareSession(session.id)
    const text = url ?? `${session.title || '会话'}\nSession ID: ${session.id}`
    await clipboardApi.write(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }, [shareSession, session.id, session.title])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="更多操作"
          onClick={(e) => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-100 transition-all p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={4}
        className="w-52 rounded-[10px]"
      >
        <DropdownMenuItem onSelect={handleOpenFolder}>
          <FolderOpen className="size-4" />
          打开文件夹
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRename}>
          <PencilLine className="size-4" />
          重命名
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Save className="size-4" />
          保存到工作空间
          <span className="ml-auto text-[10px] text-muted-foreground/60">即将开放</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            // preventDefault 保持菜单打开，便于展示「已复制」反馈
            e.preventDefault()
            void handleShare()
          }}
        >
          {copied ? (
            <Check className="size-4 text-green-500" />
          ) : (
            <Share2 className="size-4" />
          )}
          {copied ? '已复制' : '分享任务'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => void handleDelete()}
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <Trash2 className="size-4" />
          删除任务
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
