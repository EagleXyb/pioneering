# ModuAgent 前端改造方案：从"黑盒推理"到"白盒轨迹"

> 基于 `docs/Agent/ModuAgent 前端界面设计方案.md` 的架构指导，结合 `frontend/pages/agent/` 现有代码的深度分析，提出将 Agent 执行过程从"黑盒推理"转化为"白盒轨迹"的完整改造方案。

---

## 〇、现有代码分析

### 0.1 现有文件清单

| 文件 | 行数 | 核心职责 |
|------|------|---------|
| `types.ts` | 53 行 | 定义 `ChatMessage`、`ToolCall`、`StreamEvent` 等基础类型 |
| `hooks/useAgentChat.ts` | 409 行 | SSE 流解析、消息状态管理、会话 CRUD |
| `components/ChatMessage.tsx` | 156 行 | 使用 `@tdesign-react/chat` 的 `ChatMessage` 渲染气泡 |
| `components/ChatInput.tsx` | 152 行 | 使用 `@tdesign-react/chat` 的 `ChatSender` 组件 |
| `components/ChatSidebar.tsx` | 97 行 | 会话列表侧边栏 |
| `components/ToolCallCard.tsx` | 90 行 | 单个工具调用卡片的展开/折叠 |
| `styles/chatbot.css` | 507 行 | 完整布局样式 |
| `index.tsx` | 157 行 | 页面入口，组装布局 |

### 0.2 现有架构的优势

1. **已使用 TDesign Chat 组件体系**：`ChatMessage`、`ChatSender` 提供了基础的 thinking/toolcall/markdown 内容槽位
2. **SSE 流解析已实现**：`applyStreamEvent` 函数处理了 8 种事件类型的分发
3. **会话管理已完备**：创建/加载/切换会话功能齐全
4. **ToolCallCard 组件已存在**：基本的展开/折叠 + 状态图标 + JSON 格式化

### 0.3 现有架构的核心缺陷（与"白盒轨迹"目标的差距）

| 缺陷 | 现状 | 目标 |
|------|------|------|
| **消息扁平化** | `ChatMessage` 只有 `content` + `thinkingContent` + `answerContent` 三个字符串字段 | 一条消息应包含 `steps: AgentStep[]` 数组，每个步骤独立类型化 |
| **无 Step 概念** | 所有内容混在一个 message 对象中，通过 `currentPhase` 标记当前阶段 | 每个 Thinking/ToolCall/ToolResult/Text 都是独立的 Step，有独立的 `id`、`status`、`timestamp` |
| **SSE 状态更新粒度粗** | `applyStreamEvent` 每次替换整个 `last` 消息对象，触发全量重渲染 | 应按 `stepId` 增量更新特定 Step，避免无关组件重渲染 |
| **渲染组件单一** | 仅依赖 `@tdesign-react/chat` 的 `ChatMessage`，渲染策略受限 | 根据 `StepType` 映射不同 TDesign 原生组件（Collapse/Card/Timeline/Tag） |
| **无 Markdown 防抖** | `answer_delta` 每次更新都触发 `ReactMarkdown` 全量重解析 | 使用 `requestAnimationFrame` 或 `useDeferredValue` 节流渲染 |
| **无智能滚动** | `scrollIntoView` 粗暴滚动，打断用户阅读 | 检测用户是否在底部，仅在底部时自动滚动 |
| **无执行轨迹可视化** | 缺少底部面板的流程图/日志/性能图表 | 需新增底部面板，展示 ReAct 流程图和事件日志 |

---

## 一、核心数据结构设计（`types.ts` 改造）

### 1.1 改造策略

**彻底废除** `ChatMessage` 的扁平字段（`thinkingContent`、`answerContent`、`currentPhase`），**全部替换为** `steps: AgentStep[]` 结构化数组。

### 1.2 新类型定义

```typescript
// ============================================================
// 步骤类型枚举 —— 白盒轨迹的核心
// ============================================================
export enum StepType {
  THINKING = 'thinking',           // 思考过程（LLM 内部推理）
  TOOL_CALL = 'tool_call',         // 工具调用发起
  TOOL_RESULT = 'tool_result',     // 工具调用结果
  TEXT_STREAM = 'text_stream',     // 流式文本输出（最终回答）
  REASONING_ITERATION = 'reasoning_iteration', // ReAct 迭代标记
  ERROR = 'error',                 // 错误步骤
}

export type StepStatus = 'pending' | 'streaming' | 'success' | 'error'

// ============================================================
// 各类步骤的独立数据结构
// ============================================================
export interface ThinkingStep {
  id: string
  type: StepType.THINKING
  content: string            // 增量拼接的思考文本
  status: StepStatus
  startTime: number
  endTime?: number
}

export interface ToolCallStep {
  id: string
  type: StepType.TOOL_CALL
  toolName: string
  arguments: string          // JSON 字符串
  status: StepStatus
  startTime: number
  endTime?: number
  errorCode?: string
}

export interface ToolResultStep {
  id: string
  type: StepType.TOOL_RESULT
  toolCallId: string         // 关联的 ToolCallStep.id
  toolName: string
  result: string             // JSON 字符串
  status: StepStatus
  startTime: number
  endTime?: number
  duration?: number          // 工具执行耗时(ms)
}

export interface TextStreamStep {
  id: string
  type: StepType.TEXT_STREAM
  content: string            // 增量拼接的最终回答文本
  status: StepStatus
  startTime: number
  endTime?: number
}

export interface ReasoningIterationStep {
  id: string
  type: StepType.REASONING_ITERATION
  iterationIndex: number     // 第几轮迭代（1-based）
  maxIterations: number
  status: StepStatus
  startTime: number
  endTime?: number
}

export interface ErrorStep {
  id: string
  type: StepType.ERROR
  errorCode: string
  message: string
  status: StepStatus
  startTime: number
  recoverable: boolean       // 是否可恢复
  suggestedAction?: string   // 建议操作
}

// ============================================================
// 联合类型
// ============================================================
export type AgentStep =
  | ThinkingStep
  | ToolCallStep
  | ToolResultStep
  | TextStreamStep
  | ReasoningIterationStep
  | ErrorStep

// ============================================================
// 改造后的 ChatMessage（核心变化）
// ============================================================
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string            // 快速访问：steps 中所有 TEXT_STREAM 的拼接
  steps: AgentStep[]         // 【核心】白盒轨迹步骤数组
  status: 'loading' | 'success' | 'error'
  error?: string
  timestamp: number
  // 以下字段全部废弃，由 steps 替代：
  // thinkingContent?: string     → ThinkingStep.content
  // answerContent?: string       → TextStreamStep.content
  // toolCalls?: ToolCall[]       → ToolCallStep[] + ToolResultStep[]
  // currentPhase?: MessagePhase  → 由 steps 中最后一个 step 的 type 决定
}

// ============================================================
// 辅助函数：从 steps 派生快捷信息
// ============================================================
export function getCurrentPhase(msg: ChatMessage): StepType | 'idle' {
  if (msg.steps.length === 0) return 'idle'
  const lastStep = msg.steps[msg.steps.length - 1]
  if (lastStep.status === 'streaming' || lastStep.status === 'pending') {
    return lastStep.type
  }
  return 'idle'
}

export function getToolCallCount(msg: ChatMessage): number {
  return msg.steps.filter(s => s.type === StepType.TOOL_CALL).length
}

export function getTotalDuration(msg: ChatMessage): number {
  if (msg.steps.length === 0) return 0
  const firstStart = msg.steps[0].startTime
  const lastEnd = msg.steps[msg.steps.length - 1].endTime || Date.now()
  return lastEnd - firstStart
}
```

### 1.3 StreamEvent 类型扩展

```typescript
// 改造后的 StreamEvent —— 每个事件都携带 stepId
export interface StreamEvent {
  type: 'status' | 'thinking_delta' | 'thinking_done' |
        'tool_call_start' | 'tool_call_delta' | 'tool_call_end' |
        'tool_result_start' | 'tool_result_delta' | 'tool_result_end' |
        'answer_delta' | 'answer_done' |
        'reasoning_iteration' |
        'error'
  // 新增：步骤标识，用于增量更新特定 Step
  stepId?: string
  // 新增：ReAct 迭代信息
  iterationIndex?: number
  maxIterations?: number
  // 原有字段
  status?: string
  content?: string
  error?: string
  errorCode?: string
  id?: string
  name?: string
  arguments?: string
  result?: string
  message?: string
  recoverable?: boolean
  suggestedAction?: string
}
```

---

## 二、SSE 状态管理 Hook 改造（`useAgentChat.ts` 重构）

### 2.1 改造原则

> 后端 SSE 推送的 chunk 是碎片化的，前端需要以 **步骤（Step）** 为最小更新单元，通过 `stepId` 精确定位，避免全量替换消息对象。

### 2.2 核心改造点

**改造前**（现有代码，[useAgentChat.ts:L143-L251](file:///c:/Users/HS/Desktop/pioneering/frontend/pages/agent/hooks/useAgentChat.ts#L143-L251)）：
```typescript
// 问题：每次事件都替换整个 last 消息对象
const applyStreamEvent = (event: StreamEvent) => {
  setMessages((prev) => {
    const updated = [...prev]
    const last = updated[updated.length - 1]
    // 整个替换 last 对象 → 触发所有子组件重渲染
    updated[updated.length - 1] = { ...last, ... }
    return updated
  })
}
```

**改造后**（以 `stepId` 为粒度的增量更新）：

```typescript
// 核心：按 stepId 增量更新 steps 数组中的特定 Step
const applyStreamEvent = useCallback((event: StreamEvent) => {
  setMessages((prev) => {
    const updated = [...prev]
    const last = updated[updated.length - 1]
    if (!last || last.role !== 'assistant' || last.status !== 'loading') return updated

    const steps = [...last.steps]
    const stepId = event.stepId

    switch (event.type) {
      // ========== 思考过程 ==========
      case 'thinking_delta':
        if (stepId) {
          const idx = steps.findIndex(s => s.id === stepId)
          if (idx >= 0) {
            steps[idx] = {
              ...steps[idx],
              content: (steps[idx] as ThinkingStep).content + (event.content || ''),
            } as ThinkingStep
          } else {
            steps.push({
              id: stepId,
              type: StepType.THINKING,
              content: event.content || '',
              status: 'streaming',
              startTime: Date.now(),
            } as ThinkingStep)
          }
        }
        break

      case 'thinking_done':
        if (stepId) {
          const idx = steps.findIndex(s => s.id === stepId)
          if (idx >= 0) {
            steps[idx] = { ...steps[idx], status: 'success', endTime: Date.now() } as ThinkingStep
          }
        }
        break

      // ========== 工具调用 ==========
      case 'tool_call_start':
        steps.push({
          id: event.id || `tool_${Date.now()}`,
          type: StepType.TOOL_CALL,
          toolName: event.name || 'unknown',
          arguments: event.arguments || '',
          status: 'streaming',
          startTime: Date.now(),
        } as ToolCallStep)
        break

      case 'tool_call_delta':
        if (event.id) {
          const idx = steps.findIndex(
            s => s.type === StepType.TOOL_CALL && (s as ToolCallStep).id === event.id
          )
          if (idx >= 0) {
            steps[idx] = {
              ...steps[idx],
              arguments: (steps[idx] as ToolCallStep).arguments + (event.content || ''),
            } as ToolCallStep
          }
        }
        break

      case 'tool_call_end':
        if (event.id) {
          const idx = steps.findIndex(
            s => s.type === StepType.TOOL_CALL && (s as ToolCallStep).id === event.id
          )
          if (idx >= 0) {
            steps[idx] = { ...steps[idx], status: 'success', endTime: Date.now() } as ToolCallStep
          }
        }
        break

      // ========== 工具结果 ==========
      case 'tool_result_start':
        steps.push({
          id: event.id || `tool_result_${Date.now()}`,
          type: StepType.TOOL_RESULT,
          toolCallId: event.id || '',
          toolName: event.name || 'unknown',
          result: '',
          status: 'streaming',
          startTime: Date.now(),
        } as ToolResultStep)
        break

      case 'tool_result_delta':
        if (event.id) {
          const idx = steps.findIndex(
            s => s.type === StepType.TOOL_RESULT && (s as ToolResultStep).id === event.id
          )
          if (idx >= 0) {
            steps[idx] = {
              ...steps[idx],
              result: (steps[idx] as ToolResultStep).result + (event.content || ''),
            } as ToolResultStep
          }
        }
        break

      case 'tool_result_end':
        if (event.id) {
          const idx = steps.findIndex(
            s => s.type === StepType.TOOL_RESULT && (s as ToolResultStep).id === event.id
          )
          if (idx >= 0) {
            const step = steps[idx] as ToolResultStep
            steps[idx] = {
              ...step,
              result: event.result || step.result,
              status: 'success',
              endTime: Date.now(),
              duration: Date.now() - step.startTime,
            } as ToolResultStep
          }
        }
        break

      // ========== 流式文本 ==========
      case 'answer_delta':
        if (stepId) {
          const idx = steps.findIndex(s => s.id === stepId)
          if (idx >= 0) {
            steps[idx] = {
              ...steps[idx],
              content: (steps[idx] as TextStreamStep).content + (event.content || ''),
            } as TextStreamStep
          } else {
            steps.push({
              id: stepId,
              type: StepType.TEXT_STREAM,
              content: event.content || '',
              status: 'streaming',
              startTime: Date.now(),
            } as TextStreamStep)
          }
        }
        break

      case 'answer_done':
        if (stepId) {
          const idx = steps.findIndex(s => s.id === stepId)
          if (idx >= 0) {
            steps[idx] = { ...steps[idx], status: 'success', endTime: Date.now() } as TextStreamStep
          }
        }
        break

      // ========== ReAct 迭代标记 ==========
      case 'reasoning_iteration':
        steps.push({
          id: `iteration_${event.iterationIndex}_${Date.now()}`,
          type: StepType.REASONING_ITERATION,
          iterationIndex: event.iterationIndex || 1,
          maxIterations: event.maxIterations || 3,
          status: 'success',
          startTime: Date.now(),
          endTime: Date.now(),
        } as ReasoningIterationStep)
        break

      // ========== 错误 ==========
      case 'error':
        steps.push({
          id: `error_${Date.now()}`,
          type: StepType.ERROR,
          errorCode: event.errorCode || 'UNKNOWN',
          message: event.message || event.error || '未知错误',
          status: 'error',
          startTime: Date.now(),
          recoverable: event.recoverable ?? false,
          suggestedAction: event.suggestedAction,
        } as ErrorStep)
        break
    }

    // 更新 content 为所有 TEXT_STREAM 的拼接（保持向后兼容）
    const fullContent = steps
      .filter(s => s.type === StepType.TEXT_STREAM)
      .map(s => (s as TextStreamStep).content)
      .join('')

    updated[updated.length - 1] = {
      ...last,
      steps,
      content: fullContent,
    }
    return updated
  })
}, [])
```

### 2.3 新增 Hook：`useSmartScroll`

```typescript
import { useRef, useCallback, useEffect } from 'react'

export function useSmartScroll(deps: unknown[]) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const userScrolledUpRef = useRef(false)
  const autoScrollEnabledRef = useRef(true)

  // 检测用户是否手动上滚
  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const threshold = 80 // 距离底部 80px 以内视为"在底部"
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    userScrolledUpRef.current = distanceFromBottom > threshold
  }, [])

  // 仅在用户未上滚时自动滚动
  const scrollToBottom = useCallback(() => {
    if (!userScrolledUpRef.current && containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [])

  useEffect(() => {
    if (autoScrollEnabledRef.current) {
      scrollToBottom()
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps

  // 用户手动滚回底部时恢复自动滚动
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  return { containerRef, scrollToBottom, userScrolledUpRef }
}
```

---

## 三、UI 渲染策略（`ChatMessage.tsx` 重写）

### 3.1 总体策略

> 不再使用 `@tdesign-react/chat` 的 `ChatMessage` 组件的 thinking/toolcall/markdown 内容槽位，而是**直接遍历 `steps` 数组**，为每种 `StepType` 映射专属的 TDesign 原生组件。

### 3.2 步骤 → 组件映射表

| StepType | TDesign 组件 | 视觉风格 | 理由 |
|----------|------------|---------|------|
| `THINKING` | `Collapse` + `Tag` | 折叠面板，默认收起，左侧蓝色竖线 | 思考过程长且非核心，折叠满足极客窥探欲 |
| `TOOL_CALL` | `Card` + `Tag` + `Loading` | 卡片，左侧橙色竖线，右上角 Loading 动画 | 展示 Agent 正在干什么，给用户掌控感 |
| `TOOL_RESULT` | `Card`（嵌套） + `Timeline` | 卡片嵌套在上方 TOOL_CALL 内，绿色边框 | 展示工具执行结果，关联关系清晰 |
| `TEXT_STREAM` | `ReactMarkdown` | 标准 Markdown 渲染，支持代码高亮 | 最终回答，支持富文本 |
| `REASONING_ITERATION` | `Divider` + `Tag` | 分割线 + "第 X/3 轮迭代" | 标记 ReAct 循环边界 |
| `ERROR` | `Alert` + `Button` | 红色警告框 + 建议操作按钮 | 异常醒目，提供恢复路径 |

### 3.3 组件实现代码

```typescript
// components/StepRenderer.tsx —— 新增文件
import React, { useMemo } from 'react'
import { Collapse, Card, Tag, Loading, Divider, Alert, Button, Timeline } from 'tdesign-react'
import {
  BulbIcon, ToolsIcon, CheckCircleIcon, CloseCircleIcon,
  TimeIcon, RefreshIcon,
} from 'tdesign-icons-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { AgentStep } from '../types'
import { StepType } from '../types'

// ============================================================
// 步骤渲染器：根据 StepType 分发到不同组件
// ============================================================
export const StepRenderer: React.FC<{ step: AgentStep }> = React.memo(({ step }) => {
  switch (step.type) {
    case StepType.THINKING:
      return <ThinkingStepView step={step} />
    case StepType.TOOL_CALL:
      return <ToolCallStepView step={step} />
    case StepType.TOOL_RESULT:
      return <ToolResultStepView step={step} />
    case StepType.TEXT_STREAM:
      return <TextStreamStepView step={step} />
    case StepType.REASONING_ITERATION:
      return <ReasoningIterationStepView step={step} />
    case StepType.ERROR:
      return <ErrorStepView step={step} />
    default:
      return null
  }
})

// ============================================================
// 1. 思考过程 → Collapse（折叠面板）
// ============================================================
const ThinkingStepView: React.FC<{ step: ThinkingStep }> = React.memo(({ step }) => {
  const isStreaming = step.status === 'streaming'
  const duration = step.endTime ? `${((step.endTime - step.startTime) / 1000).toFixed(1)}s` : ''

  return (
    <div className="step-thinking">
      <Collapse defaultValue={isStreaming ? ['thinking'] : []} borderless>
        <Collapse.Panel
          value="thinking"
          header={
            <div className="step-thinking-header">
              <BulbIcon style={{ color: 'var(--td-brand-color)' }} />
              <span>思考过程</span>
              {isStreaming && <Loading size="small" />}
              {duration && (
                <Tag size="small" variant="light" theme="default">
                  {duration}
                </Tag>
              )}
            </div>
          }
        >
          <div className="step-thinking-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
            >
              {step.content}
            </ReactMarkdown>
          </div>
        </Collapse.Panel>
      </Collapse>
    </div>
  )
})

// ============================================================
// 2. 工具调用中 → Card + Tag + Loading
// ============================================================
const ToolCallStepView: React.FC<{ step: ToolCallStep }> = React.memo(({ step }) => {
  const isStreaming = step.status === 'streaming' || step.status === 'pending'

  return (
    <div className="step-tool-call">
      <Card bordered className="step-tool-call-card">
        <div className="step-tool-call-header">
          <div className="step-tool-call-left">
            {isStreaming ? (
              <Loading size="small" />
            ) : step.status === 'error' ? (
              <CloseCircleIcon style={{ color: 'var(--td-error-color)' }} />
            ) : (
              <ToolsIcon style={{ color: 'var(--td-warning-color)' }} />
            )}
            <Tag theme="warning" variant="light" size="small">
              调用工具
            </Tag>
            <span className="step-tool-call-name">{step.toolName}</span>
          </div>
          {isStreaming && (
            <Tag theme="warning" variant="outline" size="small">
              执行中...
            </Tag>
          )}
        </div>
        {step.arguments && (
          <div className="step-tool-call-args">
            <div className="step-tool-call-label">参数</div>
            <pre className="step-tool-call-code">
              {formatJson(step.arguments)}
            </pre>
          </div>
        )}
      </Card>
    </div>
  )
})

// ============================================================
// 3. 工具结果 → Timeline 项
// ============================================================
const ToolResultStepView: React.FC<{ step: ToolResultStep }> = React.memo(({ step }) => {
  const isStreaming = step.status === 'streaming'

  return (
    <div className="step-tool-result">
      <Timeline layout="vertical">
        <Timeline.Item
          dot={
            step.status === 'error'
              ? <CloseCircleIcon style={{ color: 'var(--td-error-color)' }} />
              : <CheckCircleIcon style={{ color: 'var(--td-success-color)' }} />
          }
        >
          <div className="step-tool-result-header">
            <Tag theme="success" variant="light" size="small">
              工具结果
            </Tag>
            <span className="step-tool-result-name">{step.toolName}</span>
            {step.duration && (
              <Tag size="small" variant="outline" theme="default">
                <TimeIcon style={{ marginRight: 2 }} />
                {step.duration}ms
              </Tag>
            )}
          </div>
          {step.result && (
            <pre className="step-tool-call-code">
              {formatJson(step.result)}
            </pre>
          )}
          {isStreaming && <Loading size="small" text="接收结果中..." />}
        </Timeline.Item>
      </Timeline>
    </div>
  )
})

// ============================================================
// 4. 流式文本输出 → ReactMarkdown（带防抖）
// ============================================================
const TextStreamStepView: React.FC<{ step: TextStreamStep }> = React.memo(({ step }) => {
  // 使用 useDeferredValue 降低渲染频率，防止卡顿
  const deferredContent = React.useDeferredValue(step.content)

  return (
    <div className="step-text-stream">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const codeStr = String(children).replace(/\n$/, '')
            // 使用 50 行截断 + "显示全部" 按钮优化长代码渲染
            const lines = codeStr.split('\n')
            const isLong = lines.length > 50
            const [expanded, setExpanded] = React.useState(false)
            const displayCode = isLong && !expanded
              ? lines.slice(0, 50).join('\n') + '\n// ... (点击展开全部)'
              : codeStr

            return match ? (
              <div className="code-block-wrapper">
                <div className="code-block-header">
                  <span>{match[1]}</span>
                  {isLong && (
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => setExpanded(!expanded)}
                    >
                      {expanded ? '收起' : '展开全部'}
                    </Button>
                  )}
                </div>
                <SyntaxHighlighter
                  style={oneDark}
                  language={match[1]}
                  PreTag="div"
                >
                  {displayCode}
                </SyntaxHighlighter>
              </div>
            ) : (
              <code className={className} {...props}>
                {children}
              </code>
            )
          },
        }}
      >
        {deferredContent}
      </ReactMarkdown>
    </div>
  )
})

// ============================================================
// 5. ReAct 迭代标记 → Divider
// ============================================================
const ReasoningIterationStepView: React.FC<{ step: ReasoningIterationStep }> = React.memo(({ step }) => (
  <Divider align="center">
    <Tag theme="primary" variant="light" size="small">
      第 {step.iterationIndex}/{step.maxIterations} 轮推理
    </Tag>
  </Divider>
))

// ============================================================
// 6. 错误步骤 → Alert
// ============================================================
const ErrorStepView: React.FC<{ step: ErrorStep }> = React.memo(({ step }) => (
  <div className="step-error">
    <Alert
      theme="error"
      title={`错误: ${step.errorCode}`}
      message={step.message}
      operation={
        step.recoverable && step.suggestedAction ? (
          <Button theme="primary" variant="outline" size="small">
            <RefreshIcon style={{ marginRight: 4 }} />
            {step.suggestedAction}
          </Button>
        ) : undefined
      }
    />
  </div>
))

// ============================================================
// 工具函数
// ============================================================
function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2)
  } catch {
    return str
  }
}
```

### 3.4 改造后的 ChatMessageBubble

```typescript
// components/ChatMessage.tsx —— 精简后的版本
export const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({
  message,
  onRegenerate,
}) => {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="agent-message-row agent-user-row">
        <TdChatMessage
          role="user"
          content={[{ type: 'text', data: message.content }]}
          placement="right"
          variant="base"
        />
      </div>
    )
  }

  // 白盒轨迹：遍历 steps 渲染
  return (
    <div className="agent-message-row agent-assistant-row">
      <div className="agent-assistant-steps">
        {/* 步骤列表 */}
        {message.steps.map((step) => (
          <StepRenderer key={step.id} step={step} />
        ))}

        {/* 加载状态 */}
        {message.status === 'loading' && message.steps.length === 0 && (
          <div className="agent-loading">
            <Loading size="medium" text="思考中..." />
          </div>
        )}

        {/* 错误状态 */}
        {message.status === 'error' && message.error && (
          <div className="agent-error">
            <Tag theme="danger" variant="light" size="small">
              {message.error}
            </Tag>
            {onRegenerate && (
              <Button
                theme="primary"
                variant="text"
                size="small"
                icon={<RefreshIcon />}
                onClick={onRegenerate}
              >
                重新生成
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

---

## 四、关键体验优化

### 4.1 Markdown 渲染防抖

**问题**：每个 SSE token 都触发 `ReactMarkdown` 全量重解析，导致严重卡顿。

**方案**：`StepRenderer` 中的 `TextStreamStepView` 已使用 `useDeferredValue`，但更精细的控制需要：

```typescript
// hooks/useThrottledContent.ts —— 新增文件
import { useState, useEffect, useRef } from 'react'

export function useThrottledContent(rawContent: string, interval = 32): string {
  // interval = 32ms ≈ 约 30fps，人眼流畅感知
  const [display, setDisplay] = useState(rawContent)
  const lastUpdateRef = useRef(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const now = performance.now()
    const elapsed = now - lastUpdateRef.current

    if (elapsed >= interval) {
      setDisplay(rawContent)
      lastUpdateRef.current = now
    } else {
      // 使用 requestAnimationFrame 延迟到下一帧
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        setDisplay(rawContent)
        lastUpdateRef.current = performance.now()
      })
    }

    return () => cancelAnimationFrame(rafRef.current)
  }, [rawContent, interval])

  return display
}
```

在 `TextStreamStepView` 中使用：
```typescript
const TextStreamStepView: React.FC<{ step: TextStreamStep }> = React.memo(({ step }) => {
  const throttledContent = useThrottledContent(step.content, 50) // 50ms 节流
  // ... 使用 throttledContent 而非 step.content 渲染 Markdown
})
```

### 4.2 智能自动滚动

**问题**：用户阅读历史消息时，新 token 到达不应强制拉回底部。

**方案**：已在 §2.3 中实现 `useSmartScroll` Hook，核心逻辑：
- 监听 `scroll` 事件，计算 `distanceFromBottom`
- 距离底部 > 80px 时，暂停自动滚动
- 用户滚回底部时，恢复自动滚动
- 仅在 `content` 变化时触发滚动检查

### 4.3 代码块长内容优化

**问题**：工具返回结果可能包含数千行 JSON，直接渲染导致卡顿。

**方案**：在 `TextStreamStepView` 的 `ReactMarkdown` 中：
- 代码块超过 50 行时，默认截断显示前 50 行
- 提供"展开全部" / "收起"按钮
- 使用 `SyntaxHighlighter` 的虚拟化渲染

### 4.4 步骤动画

```css
/* 新增步骤动画样式 */
.step-thinking,
.step-tool-call,
.step-tool-result,
.step-text-stream,
.step-error {
  animation: stepSlideIn 0.3s ease-out;
  margin-bottom: 12px;
}

@keyframes stepSlideIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 流式输出光标闪烁效果 */
.step-text-stream.streaming::after {
  content: '▍';
  animation: blink 1s step-end infinite;
  color: var(--td-brand-color);
}

@keyframes blink {
  50% { opacity: 0; }
}
```

---

## 五、文件改造清单

### 5.1 改造文件

| 文件 | 改造类型 | 改动说明 |
|------|---------|---------|
| `types.ts` | **重写** | 新增 `StepType` 枚举、6 种 Step 接口、`AgentStep` 联合类型、辅助函数；废弃 `thinkingContent`/`answerContent`/`currentPhase` |
| `hooks/useAgentChat.ts` | **重构** | 核心 `applyStreamEvent` 改为按 `stepId` 增量更新 `steps`；新增 `useSmartScroll` Hook |
| `components/ChatMessage.tsx` | **重写** | 不再使用 `TdChatMessage` 的 content 槽位，改为遍历 `steps` 渲染 `StepRenderer` |
| `components/ToolCallCard.tsx` | **废弃** | 功能已合并到 `StepRenderer` 的 `ToolCallStepView` 和 `ToolResultStepView` |
| `index.tsx` | **小改** | 使用 `useSmartScroll` 替代 `messagesEndRef`；新增底部面板入口 |
| `styles/chatbot.css` | **增量** | 新增步骤动画样式、代码块样式、底部面板布局样式 |

### 5.2 新增文件

| 文件 | 职责 |
|------|------|
| `components/StepRenderer.tsx` | 步骤渲染分发器 + 6 种步骤视图组件 |
| `hooks/useSmartScroll.ts` | 智能自动滚动 Hook |
| `hooks/useThrottledContent.ts` | Markdown 渲染节流 Hook |
| `components/BottomPanel.tsx` | 底部面板（执行流程图 + 事件日志 + 性能指标） |
| `components/StatusBar.tsx` | 顶部状态栏（阶段进度条 + 关键指标） |
| `components/ParamPanel.tsx` | 右侧参数调整面板 |

### 5.3 保留不变的文件

| 文件 | 原因 |
|------|------|
| `components/ChatInput.tsx` | 功能完备，无需改动 |
| `components/ChatSidebar.tsx` | 功能完备，无需改动 |
| `styles/chatbot.css` | 基础布局样式保留，仅增量添加 |

---

## 六、改造路线图

### 阶段一：数据结构迁移（1-2 天）
1. 新增 `StepType` 枚举和所有 Step 接口到 `types.ts`
2. 保留旧字段作为 `@deprecated`，添加 `steps` 字段
3. 添加辅助函数 `getCurrentPhase`、`getToolCallCount` 等
4. 确保 TypeScript 编译通过

### 阶段二：SSE Hook 重构（2-3 天）
1. 重构 `applyStreamEvent` 为按 `stepId` 增量更新
2. 添加 `useSmartScroll` Hook
3. 添加 `useThrottledContent` Hook
4. 确保与后端 SSE 协议兼容

### 阶段三：UI 组件改造（3-4 天）
1. 创建 `StepRenderer.tsx` 及 6 种步骤视图
2. 重写 `ChatMessage.tsx`
3. 增量添加 CSS 动画样式
4. 标记 `ToolCallCard.tsx` 为废弃

### 阶段四：可视化面板（3-4 天）
1. 创建 `BottomPanel.tsx`（执行流程图 + 事件日志 + 性能指标）
2. 创建 `StatusBar.tsx`（顶部状态栏）
3. 创建 `ParamPanel.tsx`（参数调整面板）
4. 集成到 `index.tsx` 布局

### 阶段五：测试与优化（2-3 天）
1. 流式输出性能测试
2. 智能滚动边界测试
3. 异常状态展示验证
4. 移动端响应式适配

---

## 七、总结

本改造方案的核心思想是 **将消息从"扁平字符串"升级为"结构化步骤数组"**，通过以下三个层面的改造实现"白盒轨迹"：

| 层面 | 改造前 | 改造后 |
|------|-------|-------|
| **数据层** | `ChatMessage` 扁平字段 | `steps: AgentStep[]` 结构化数组 |
| **状态层** | 全量替换消息对象 | 按 `stepId` 增量更新 Step |
| **视图层** | 单一 `TdChatMessage` 组件 | 6 种 `StepType` 映射 6 种 TDesign 组件 |

改造后的前端将能够：
- 精确展示 Agent 每一步的**执行内容**和**耗时**
- 提供**思考过程折叠**、**工具调用卡片**、**结果 Timeline** 等差异化视觉
- 通过**底部面板**实时查看执行流程图和事件日志
- 通过**智能滚动**和**Markdown 节流**保障流畅体验