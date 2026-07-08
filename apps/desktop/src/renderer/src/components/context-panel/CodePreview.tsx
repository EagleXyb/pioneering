// ============================================================
// CodePreview — 代码预览（右栏 Context Panel）
// ============================================================

import { FileCode } from 'lucide-react'
import { useActiveFile } from '../../stores/useWorkspaceStore'

export function CodePreview() {
  const activeFile = useActiveFile()

  if (!activeFile) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <FileCode className="h-10 w-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground/60">选择文件以预览代码</p>
        <p className="text-xs text-muted-foreground/40 mt-1">
          AI 生成的代码将自动显示在此处
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/20 shrink-0">
        <FileCode className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-medium truncate">{activeFile.name}</span>
      </div>
      <div className="flex-1 overflow-auto">
        <pre className="p-4 text-xs font-mono leading-relaxed text-foreground">
          <code>{activeFile.content || '（空文件）'}</code>
        </pre>
      </div>
    </div>
  )
}
