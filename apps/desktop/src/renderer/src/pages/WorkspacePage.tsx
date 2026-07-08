// ============================================================
// WorkspacePage — 主工作区页面
// ============================================================

import { X } from 'lucide-react'
import { useWorkspaceStore, useActiveFile } from '../stores/useWorkspaceStore'
import { cn } from '../lib/utils'

export function WorkspacePage() {
  const { openFiles, setActiveFile, closeFile } = useWorkspaceStore()
  const activeFile = useActiveFile()

  if (openFiles.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-bold text-muted-foreground/50">欢迎使用工作区</h2>
          <p className="text-sm text-muted-foreground">
            打开文件或开始一个新的 AI 对话
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center h-9 bg-muted/30 border-b border-border shrink-0 overflow-x-auto">
        {openFiles.map((file) => (
          <div
            key={file.id}
            onClick={() => setActiveFile(file.id)}
            className={cn(
              'group flex items-center gap-1.5 px-3 h-full text-xs border-r border-border cursor-pointer transition-colors',
              file.id === activeFile?.id
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
          >
            <span className={cn(file.isDirty && 'italic')}>
              {file.name}
              {file.isDirty && ' •'}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeFile(file.id)
              }}
              className="opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/20 rounded p-0.5 transition-opacity"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-auto bg-background">
        {activeFile ? (
          <pre className="p-4 text-sm font-mono whitespace-pre-wrap">
            {activeFile.content || <span className="text-muted-foreground">（空文件）</span>}
          </pre>
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-muted-foreground">选择文件以开始编辑</p>
          </div>
        )}
      </div>
    </div>
  )
}
