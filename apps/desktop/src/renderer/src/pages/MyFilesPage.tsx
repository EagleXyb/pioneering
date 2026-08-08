import { Folder } from 'lucide-react'

export function MyFilesPage() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 select-none bg-background">
      <Folder className="size-10 text-muted-foreground/30" strokeWidth={1.5} />
      <p className="text-sm font-medium text-foreground/80">我的文件</p>
      <p className="text-[11px] text-muted-foreground/50">开发中，即将上线</p>
    </div>
  )
}
