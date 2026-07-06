// ============================================================
// WorkspacePage — 主工作区页面
// ============================================================

import { useAppStore } from '../stores/useAppStore'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'

export function WorkspacePage(): JSX.Element {
  const { activeMode } = useAppStore()
  const { openFiles, activeFileId } = useWorkspaceStore()

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
      {/* Tab Bar */}
      <div className="flex items-center h-9 bg-muted/30 border-b border-border shrink-0 overflow-x-auto">
        {openFiles.map((file) => (
          <div
            key={file.id}
            className={`flex items-center gap-1.5 px-3 h-full text-xs border-r border-border cursor-pointer
              ${file.id === activeFileId ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
          >
            <span>{file.name}</span>
          </div>
        ))}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden bg-background">
        <div className="h-full flex items-center justify-center">
          <p className="text-sm text-muted-foreground">
            {activeMode === 'code' && '代码编辑器'}
            {activeMode === 'work' && '预览面板'}
            {activeMode === 'design' && '设计画布'}
          </p>
        </div>
      </div>
    </div>
  )
}
