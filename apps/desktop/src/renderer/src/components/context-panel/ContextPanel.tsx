// ============================================================
// ContextPanel — 右栏上下文面板（Code / Diff / Terminal）
// ============================================================

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CodePreview } from './CodePreview'
import { TerminalView } from './TerminalView'
import { DiffViewer } from './DiffViewer'
import { FileCode, Terminal, GitCompare } from 'lucide-react'

export function ContextPanel() {
  return (
    <div className="flex flex-col h-full bg-muted/20 border-l border-border">
      <Tabs defaultValue="code" className="flex flex-col h-full">
        <div className="px-2 py-1.5 border-b border-border bg-background shrink-0">
          <TabsList className="h-7 bg-muted/50">
            <TabsTrigger value="code" className="text-[11px] gap-1 h-5 px-2 data-[state=active]:bg-background">
              <FileCode className="h-3 w-3" />
              Code
            </TabsTrigger>
            <TabsTrigger value="diff" className="text-[11px] gap-1 h-5 px-2 data-[state=active]:bg-background">
              <GitCompare className="h-3 w-3" />
              Diff
            </TabsTrigger>
            <TabsTrigger value="terminal" className="text-[11px] gap-1 h-5 px-2 data-[state=active]:bg-background">
              <Terminal className="h-3 w-3" />
              Terminal
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="code" className="flex-1 overflow-hidden mt-0 data-[state=inactive]:hidden">
          <CodePreview />
        </TabsContent>
        <TabsContent value="diff" className="flex-1 overflow-hidden mt-0 data-[state=inactive]:hidden">
          <DiffViewer />
        </TabsContent>
        <TabsContent value="terminal" className="flex-1 overflow-hidden mt-0 data-[state=inactive]:hidden">
          <TerminalView />
        </TabsContent>
      </Tabs>
    </div>
  )
}
