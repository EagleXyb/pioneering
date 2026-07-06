// ============================================================
// AgentPage — Agent 执行页面
// ============================================================

import { useState } from 'react'
import { Bot, Play, Square, Terminal, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useAgentStore } from '../stores/useAgentStore'

export function AgentPage(): JSX.Element {
  const [instruction, setInstruction] = useState('')
  const { steps, currentStepIndex, status, error, startExecution, addStep, nextStep, completeExecution, failExecution, reset } = useAgentStore()

  const handleExecute = async () => {
    if (!instruction.trim()) return
    reset()
    startExecution(instruction)

    // Simulate agent execution
    const mockSteps = [
      { id: '1', description: '分析任务需求', status: 'running' as const },
      { id: '2', description: '搜索相关知识库', status: 'pending' as const, toolName: 'search' },
      { id: '3', description: '生成解决方案', status: 'pending' as const, toolName: 'generate' },
      { id: '4', description: '验证结果', status: 'pending' as const, toolName: 'validate' }
    ]

    for (let i = 0; i < mockSteps.length; i++) {
      await new Promise((r) => setTimeout(r, 800))
      addStep(mockSteps[i] as any)
      nextStep()
    }

    completeExecution()
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Bot className="size-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold">AI Agent</h1>
            <p className="text-sm text-muted-foreground">智能体执行引擎</p>
          </div>
        </div>

        {/* Input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="输入任务指令..."
            disabled={status === 'running'}
            className="flex-1 px-4 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {status === 'running' ? (
            <Button variant="destructive" onClick={() => failExecution('用户取消')}>
              <Square className="size-4 mr-1" /> 停止
            </Button>
          ) : (
            <Button onClick={handleExecute} disabled={!instruction.trim()}>
              <Play className="size-4 mr-1" /> 执行
            </Button>
          )}
        </div>

        {/* Steps */}
        {steps.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium flex items-center gap-2">
              <Terminal className="size-4" />
              执行步骤
            </h2>
            {steps.map((step, i) => (
              <div
                key={step.id}
                className={`flex items-start gap-3 p-3 rounded-lg border ${
                  i < currentStepIndex
                    ? 'border-green-500/20 bg-green-500/5'
                    : i === currentStepIndex
                      ? 'border-primary/20 bg-primary/5'
                      : 'border-border'
                }`}
              >
                {i < currentStepIndex ? (
                  <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
                ) : i === currentStepIndex ? (
                  <Loader2 className="size-4 text-primary animate-spin mt-0.5 shrink-0" />
                ) : (
                  <div className="size-4 rounded-full border-2 border-muted-foreground/30 mt-0.5 shrink-0" />
                )}
                <div>
                  <p className="text-sm">{step.description}</p>
                  {step.toolName && (
                    <span className="inline-block mt-1 px-2 py-0.5 text-[10px] rounded bg-primary/10 text-primary">
                      🔧 {step.toolName}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/5 text-sm text-red-500">
            ⚠ {error}
          </div>
        )}
      </div>
    </div>
  )
}
