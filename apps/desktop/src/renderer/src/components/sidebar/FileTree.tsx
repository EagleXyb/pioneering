// ============================================================
// FileTree — 文件树（左栏）
// ============================================================

import { File, FolderOpen, X } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useWorkspaceStore } from '../../stores/useWorkspaceStore'

export function FileTree() {
  const { openFiles, activeFileId, setActiveFile, closeFile } = useWorkspaceStore()

  if (openFiles.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-2 py-2 border-b border-border shrink-0">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            文件
          </h3>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-4">
            <FolderOpen className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground/60">暂无打开的文件</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-2 py-2 border-b border-border shrink-0">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          文件
        </h3>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-1.5 space-y-0.5">
          {openFiles.map((file) => (
            <div
              key={file.id}
              onClick={() => setActiveFile(file.id)}
              className={cn(
                'group flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors',
                file.id === activeFileId
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
            >
              <File className="h-3.5 w-3.5 shrink-0" />
              <span className="text-xs truncate flex-1">
                {file.name}
                {file.isDirty && <span className="ml-1 text-orange-400">•</span>}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closeFile(file.id)
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-all p-0.5"
                title="关闭文件"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
