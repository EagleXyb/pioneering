// ============================================================
// DiffViewer — Diff 对比视图（右栏 Context Panel）
// ============================================================

import { GitCompare } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/useWorkspaceStore'
import { cn } from '@/lib/utils'

export function DiffViewer() {
  const { openFiles, activeFileId } = useWorkspaceStore()
  const activeFile = openFiles.find((f) => f.id === activeFileId)

  if (!activeFile) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <GitCompare className="h-10 w-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground/60">选择文件查看 Diff</p>
        <p className="text-xs text-muted-foreground/40 mt-1">
          AI 修改的文件变更将显示在此处
        </p>
      </div>
    )
  }

  // Simple diff-like view: show current content with line numbers
  const lines = (activeFile.content || '').split('\n')

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/20 shrink-0">
        <GitCompare className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-medium truncate">
          Diff — {activeFile.name}
        </span>
        {activeFile.isDirty && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500">
            未保存
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto font-mono text-xs">
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              'flex border-b border-border/30',
              i === 0 && 'bg-green-500/10' // mock: first line "added"
            )}
          >
            <span className="w-10 shrink-0 text-right pr-3 text-muted-foreground/40 select-none py-0.5">
              {i + 1}
            </span>
            <span className="flex-1 py-0.5">
              {line || <span className="opacity-0">.</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
