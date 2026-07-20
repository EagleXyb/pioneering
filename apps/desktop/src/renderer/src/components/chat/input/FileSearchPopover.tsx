// ============================================================
// FileSearchPopover — 「@」文件搜索弹出层（对应文档 §10.2）
// 受控渲染：列出已附加文件（按 query 过滤）并提供「浏览文件…」入口。
// 由于本项目主进程未提供 fs:search-files，文件选择经 fileApi 对话框完成，
// 选择与文档一致的 @{} 标签写入编辑器。
//
// T01 a11y：采用 listbox + option + aria-activedescendant 模式；
// 「浏览文件…」作为独立按钮，role 不属于 listbox，避免被 AT 误读为选项。
// ============================================================

import { FileText, FolderSearch } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SelectedFileItem } from '@/lib/input/select-file-editor'

export interface FileSearchPopoverProps {
  open: boolean
  /** 已由 InputArea 过滤后的文件列表 */
  files: SelectedFileItem[]
  activeIndex: number
  onHover: (index: number) => void
  onSelectFile: (path: string) => void
  onBrowse: () => void
}

export function FileSearchPopover({
  open,
  files,
  activeIndex,
  onHover,
  onSelectFile,
  onBrowse
}: FileSearchPopoverProps) {
  if (!open) return null

  const results = files
  const optionId = (i: number) => `file-option-${i}`
  const activeId = results.length > 0 ? optionId(activeIndex) : undefined

  return (
    <div
      className="absolute bottom-full left-0 z-50 mb-2 max-h-72 w-80 overflow-hidden rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
      // T01 a11y：文件选择列表
      role="listbox"
      aria-label="引用文件列表"
      aria-activedescendant={activeId}
      tabIndex={-1}
    >
      <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground" aria-hidden>
        引用文件
      </div>
      {results.length > 0 ? (
        results.map((file, i) => {
          const isActive = i === activeIndex
          return (
            <button
              key={file.path}
              id={optionId(i)}
              type="button"
              role="option"
              aria-selected={isActive}
              aria-label={`引用文件 ${file.name}，路径 ${file.path}`}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                onSelectFile(file.path)
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
                isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
              )}
            >
              <FileText className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="max-w-[8rem] truncate text-[10px] text-muted-foreground">
                {file.path}
              </span>
            </button>
          )
        })
      ) : (
        <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
          暂无已附加文件，点击下方按钮浏览
        </div>
      )}
      <button
        type="button"
        // T01 a11y：浏览文件作为独立操作按钮，不混入 listbox
        aria-label="浏览并选择文件"
        onMouseDown={(e) => {
          e.preventDefault()
          onBrowse()
        }}
        className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/60"
      >
        <FolderSearch className="size-4" aria-hidden />
        浏览文件…
      </button>
    </div>
  )
}
