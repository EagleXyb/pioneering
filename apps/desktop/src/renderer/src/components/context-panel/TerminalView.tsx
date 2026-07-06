// ============================================================
// TerminalView — 终端视图（右栏 Context Panel）
// ============================================================

import { Terminal } from 'lucide-react'

export function TerminalView() {
  return (
    <div className="flex flex-col h-full bg-zinc-950 text-green-400 font-mono text-xs">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 bg-zinc-900 shrink-0">
        <Terminal className="h-3.5 w-3.5" />
        <span className="text-xs text-zinc-400">Terminal</span>
      </div>

      <div className="flex-1 overflow-auto p-3">
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-zinc-500">
            <span className="text-green-400">$</span>
            <span>pioneering --help</span>
          </div>
          <div className="text-zinc-400 pl-4">
            <p>Pioneering Desktop AI Agent v0.1.0</p>
            <p>Usage: pioneering &lt;command&gt; [options]</p>
            <p className="mt-1">Commands:</p>
            <p className="pl-4">chat    启动 AI 对话模式</p>
            <p className="pl-4">agent   执行 AI Agent 任务</p>
            <p className="pl-4">build   构建当前项目</p>
          </div>
          <div className="flex items-center gap-1 pt-2">
            <span className="text-green-400 animate-pulse">$</span>
            <span className="animate-pulse text-zinc-300">▊</span>
          </div>
        </div>
      </div>

      <div className="px-3 py-1.5 border-t border-zinc-800 bg-zinc-900 shrink-0">
        <span className="text-[10px] text-zinc-600">
          Agent 沙箱终端 — 命令将自动执行
        </span>
      </div>
    </div>
  )
}
