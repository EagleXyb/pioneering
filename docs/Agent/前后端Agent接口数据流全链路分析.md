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

---

## 附录：前后端 Agent 接口数据流全链路分析

> 基于 `frontend/pages/agent/` 前端代码与 `python-backend/` 后端代码的深度分析，阐述后端 Agent (ModuAgent) 对接前端 Agent 页面的完整接口数据流。

---

### 一、整体架构概览

```
┌──────────────────────────────────────────────────────────────────┐
│  前端 frontend/pages/agent/                                       │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐           │
│  │ChatInput │→│useAgentChat  │→│createChatRequest  │── POST ──┐ │
│  │          │  │.handleSend() │  │(agentApi.ts:139)  │          │ │
│  └──────────┘  └──────┬───────┘  └──────────────────┘          │ │
│                        ↓                                         │ │
│  ┌──────────────────────────────────────────┐                   │ │
│  │ SSE Stream 解析 (ReadableStream reader)  │                   │ │
│  │ → useStreamParser.applyStreamEvent()     │                   │ │
│  │ → applyEventToMessages() 更新 steps[]    │                   │ │
│  │ → emitEventBusEvent() 广播到 EventBus    │                   │ │
│  └──────┬───────────────────┬───────────────┘                   │ │
│         ↓                   ↓                                    │ │
│  ┌──────────────┐  ┌────────────────┐                           │ │
│  │ChatMessage   │  │ExecutionCard   │                           │ │
│  │Bubble        │  │+ ActivityPanel │                           │ │
│  │(文本渲染)    │  │+ StatusBar     │                           │ │
│  └──────────────┘  └────────────────┘                           │ │
│         ↓                   ↓                                    │ │
│  ┌──────────────────────────────────┐                           │ │
│  │     AgentStepsPanel (右侧面板)    │                           │ │
│  │     StepRenderer 逐步骤渲染       │                           │ │
│  └──────────────────────────────────┘                           │ │
└──────────────────────────────────────────────────────────────────┘
         │                        ▲
         │  POST /chat/completions│ SSE {data: json}
         ↓                        │
┌──────────────────────────────────────────────────────────────────┐
│  python-backend                                                   │
│  ┌────────────────────────────────────────────────────┐          │
│  │ app/api/v1/chat.py → chat_completion()             │          │
│  │  - 创建/使用 session                                │          │
│  │  - 创建 user message                               │          │
│  │  - 调用 agent_bridge.stream_chat_completion()      │          │
│  │  - 遍历 sse_line，解析 event，透传 SSE              │          │
│  │  - EventSourceResponse 返回流                      │          │
│  └──────────┬─────────────────────────────────────────┘          │
│             ↓                                                     │
│  ┌────────────────────────────────────────────────────┐          │
│  │ app/core/agent_bridge.py → stream_chat_completion()│          │
│  │  - 初始化 ModuAgent (registry, reasoner, tools)    │          │
│  │  - 创建 Coordinator                                │          │
│  │  - coordinator.stream_request() → AsyncGenerator   │          │
│  │  - _coordinator_frame_to_frontend_event() 映射     │          │
│  │    coordinator frame → frontend StreamEvent        │          │
│  │  - yield {"data": json.dumps(event)}               │          │
│  └──────────┬─────────────────────────────────────────┘          │
│             ↓                                                     │
│  ┌────────────────────────────────────────────────────┐          │
│  │ ModuAgent/orchestration/coordinator.py              │          │
│  │  stream_request() → AsyncGenerator[SSE frame]      │          │
│  │                                                     │          │
│  │  执行流程:                                          │          │
│  │  1. Perception (敏感词检测)   → status frame       │          │
│  │  2. Memory (上下文查询)       → status frame       │          │
│  │  3. Reasoning (LLM 调用)      → thinking frame     │          │
│  │  4. ReAct Loop (工具调用轮次)  → tool_call/reasoning│          │
│  │     iteration frames                               │          │
│  │  5. Stream Final Answer       → token frames       │          │
│  │  6. Done                      → done frame         │          │
│  │                                                     │          │
│  │  使用 SSEEncoder 编码:                              │          │
│  │  - encode_status(phase)        → {event, data}     │          │
│  │  - encode_thinking(content)    → {event, data}     │          │
│  │  - encode_tool_call_start/end  → {event, data}     │          │
│  │  - encode_tool_result(...)     → {event, data}     │          │
│  │  - encode_token(token)         → {event, data}     │          │
│  │  - encode_reasoning_iteration  → {event, data}     │          │
│  │  - encode_done(...)            → {event, data}     │          │
│  └────────────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────────┘
```

---

### 二、核心数据流转详解

#### 2.1 前端发起请求

**入口**: [ChatInput](file:///d:/Administrator/Desktop/pioneering/frontend/pages/agent/components/ChatInput.tsx) 用户输入 → [useAgentChat.handleSend()](file:///d:/Administrator/Desktop/pioneering/frontend/pages/agent/hooks/useAgentChat.ts#L46)

```typescript
// useAgentChat.ts handleSend() 核心逻辑
const handleSend = async (value?: string) => {
  // 1. 创建 user message + assistant placeholder
  const userMsg: ChatMessage = { id: 'user_...', role: 'user', ... }
  const assistantMsg: ChatMessage = { id: 'assistant_...', role: 'assistant', steps: [], status: 'loading', ... }

  // 2. 如果没有 session，先创建
  if (!sessionId) sessionId = await createNewSession(title, model)

  // 3. POST /chat/completions (SSE 流)
  const response = await createChatRequest({
    sessionId, message, model, stream: true, deepThinking, webSearch, signal
  })

  // 4. 逐行读取 SSE 流
  const reader = response.body.getReader()
  // 解析 "data: {...}" 行 → 解析 JSON → applyStreamEvent(parsed)
}
```

**API 调用层**: [agentApi.ts](file:///d:/Administrator/Desktop/pioneering/frontend/pages/agent/api/agentApi.ts#L139-L147)

```typescript
export function createChatRequest(body) {
  return fetch(`${API_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),  // { sessionId, message, model, stream, deepThinking, webSearch }
    signal: body.signal,
  })
}
```

API 路径定义在 [shared/api/endpoints.ts](file:///d:/Administrator/Desktop/pioneering/shared/api/endpoints.ts#L42-L48):
```typescript
CHAT: {
  SESSIONS: '/chat/sessions',
  MESSAGES: (sessionId) => `/chat/sessions/${sessionId}/messages`,
  COMPLETIONS: '/chat/completions',
}
```

#### 2.2 后端 API 层接收

**路由**: [chat.py - chat_completion()](file:///d:/Administrator/Desktop/pioneering/python-backend/app/api/v1/chat.py#L296-L340)

```python
@router.post("/completions")
async def chat_completion(dto: ChatCompletionRequest, current_user, db):
    # 1. 没有 session_id → 自动创建 ChatSession
    # 2. 创建 user message (role=user)
    # 3. stream=True → 返回 EventSourceResponse

    async def event_generator():
        async for sse_line in stream_chat_completion(...):
            event = _parse_event(sse_line)  # 解析 {"data": "..."}
            # 收集 thinking_content, answer_content, tool_calls
            yield sse_line  # 透传 SSE

        # 流结束后创建 assistant message 并 commit DB
        assistant_msg = ChatMessage(role=MessageRole.assistant, ...)
        db.add(assistant_msg)
        await db.commit()

    return EventSourceResponse(event_generator())
```

请求体 [ChatCompletionRequest](file:///d:/Administrator/Desktop/pioneering/python-backend/app/schemas/chat.py#L63-L76):
```python
class ChatCompletionRequest(BaseModel):
    session_id: str | None
    message: str
    model: str | None
    stream: bool = True
    deep_think: bool = False
    net_search: bool = False
```

#### 2.3 Agent Bridge - 桥接层

**核心文件**: [agent_bridge.py](file:///d:/Administrator/Desktop/pioneering/python-backend/app/core/agent_bridge.py)

这是前端和后端 Agent 之间的 **关键转换层**，做了两件事：

**(A) 初始化 ModuAgent 组件** ([line 14-49](file:///d:/Administrator/Desktop/pioneering/python-backend/app/core/agent_bridge.py#L14-L49)):
```python
def _init_moduagent():
    registry = get_registry()
    registry.register_reasoning_engine("default", BaseLLMReasoner(api_key, base_url, model))
    registry.register_perception("text_preprocessor", TextPreprocessor())
    registry.register_memory("short_term", InMemoryShortTermMemory())
    registry.register_tool(CalculatorTool())
    registry.register_tool(SearchTool())
    registry.register_action_executor("sync", SyncActionExecutor())
```

**(B) Coordinator Frame → Frontend StreamEvent 映射** ([line 54-132](file:///d:/Administrator/Desktop/pioneering/python-backend/app/core/agent_bridge.py#L54-L132)):

这是桥梁的核心 — 将 Coordinator 内部的 `{event, data}` 帧转换为前端可识别的 `StreamEvent`:

| Coordinator Frame (event) | 转换后 Frontend StreamEvent.type |
|---|---|
| `status` (phase=`perception`/`memory`) | `null` (过滤掉) |
| `status` (其他 phase) | `"status"` |
| `thinking` | `"thinking_delta"` + `"thinking_done"` |
| `reasoning_iteration` | `"reasoning_iteration"` |
| `tool_call_start` | `"tool_call_start"` |
| `tool_call_end` | `"tool_call_end"` |
| `tool_result` | `"tool_result_end"` |
| `token` | `"answer_delta"` |
| `done` | `"answer_done"` |
| `error` | `"error"` |

**(C) 流式调用 Coordinator** ([line 144-240](file:///d:/Administrator/Desktop/pioneering/python-backend/app/core/agent_bridge.py#L144-L240)):

```python
async def stream_chat_completion(message, session_id, user_id, model, ...):
    coordinator = Coordinator()
    step_id = str(uuid.uuid4())

    async for frame in coordinator.stream_request(
        user_id=user_id, session_id=session_id,
        input_data={"input_type": "text", "prompt": message},
    ):
        events = _coordinator_frame_to_frontend_event(frame, step_id)
        for event in events:
            yield {"data": json.dumps(event)}  # SSE 格式输出

    # 流结束后附加 __metadata__ 事件
    yield {"data": json.dumps({"type": "__metadata__", "payload": {
        "thinkingContent": "...", "answerContent": "...", "toolCalls": [...]
    }})}
```

#### 2.4 ModuAgent Coordinator - Agent 执行引擎

**文件**: [coordinator.py stream_request()](file:///d:/Administrator/Desktop/pioneering/python-backend/ModuAgent/orchestration/coordinator.py#L346-L655)

执行流程 (通过 `yield` 实时流式输出 SSE 帧):

```
Step 1: Perception (感知)
  → yield SSEEncoder.encode_status("perception", trace_id)
  → 敏感词检测，如果触发则直接返回 error

Step 2: Memory (记忆)
  → yield SSEEncoder.encode_status("memory", trace_id)
  → 查询历史对话 / 知识库

Step 3: Reasoning (推理)
  → yield SSEEncoder.encode_status("thinking", trace_id)
  → LLM 生成 → yield SSEEncoder.encode_thinking(response, trace_id)

Step 4: ReAct Loop (工具调用迭代)
  → 每轮迭代 yield SSEEncoder.encode_reasoning_iteration(index, max)
  → 解析 tool_call → yield encode_tool_call_start / encode_tool_call_end
  → 执行 tool → yield encode_tool_result(...)
  → 如果还有工具调用 → 下一轮迭代 (max 3 轮)

Step 5: Stream Final Answer (流式最终输出)
  → 逐 token 调用 llm_adapter.stream()
  → yield SSEEncoder.encode_token(token, trace_id)

Step 6: Done
  → yield SSEEncoder.encode_done(trace_id, tool_results)
```

**SSEEncoder** ([streaming.py](file:///d:/Administrator/Desktop/pioneering/python-backend/ModuAgent/orchestration/communication/streaming.py#L12-L110)) 编码格式:
```python
# 每个帧的格式: {"event": "<type>", "data": "<json字符串>"}
SSEEncoder.encode_token("Hello", trace_id)
# → {"event": "token", "data": '{"token": "Hello", "trace_id": "..."}'}
```

#### 2.5 前端 SSE 解析 & 状态更新

**核心**: [useStreamParser.ts applyEventToMessages()](file:///d:/Administrator/Desktop/pioneering/frontend/pages/agent/hooks/useStreamParser.ts#L88-L370)

每条从 SSE 解析出的 `StreamEvent` 都会调用此函数，更新消息的 `steps[]` 数组：

| StreamEvent.type | 对 steps[] 的操作 |
|---|---|
| `status` | 不创建 step，仅更新 `currentPhase` |
| `thinking_delta` | 创建/追加 `ThinkingStep` (type=`thinking`) |
| `thinking_done` | 标记 ThinkingStep 状态为 `success` |
| `tool_call_start` | 创建 `ToolCallStep` (type=`tool_call`) |
| `tool_call_end` | 标记 ToolCallStep 完成 |
| `tool_result_end` | 创建/更新 `ToolResultStep` (type=`tool_result`) |
| `answer_delta` | 创建/追加 `TextStreamStep` (type=`text_stream`) |
| `answer_done` | 标记 TextStreamStep 状态为 `success` |
| `reasoning_iteration` | 创建 `ReasoningIterationStep` |
| `error` | 创建 `ErrorStep` (type=`error`) |

同时通过 [emitEventBusEvent()](file:///d:/Administrator/Desktop/pioneering/frontend/pages/agent/hooks/useStreamParser.ts#L16-L85) 广播到 `agentEventBus`。

#### 2.6 前端渲染层

有三条渲染路径，消费同一份数据：

**(A) 聊天消息气泡** - [ChatMessage.tsx](file:///d:/Administrator/Desktop/pioneering/frontend/pages/agent/components/ChatMessage.tsx)
- 提取 `TEXT_STREAM` 类型 steps → 拼接内容 → ReactMarkdown 渲染
- 流式输出时使用 `useThrottledContent` 节流 (50ms)

**(B) 执行过程卡片** - [ExecutionCard.tsx](file:///d:/Administrator/Desktop/pioneering/frontend/pages/agent/components/ExecutionCard.tsx)
- 订阅 `agentEventBus` 事件 → `useAgentRun` Hook 维护 `RunState`
- 展示 Phase 时间线 (perception → memory → thinking → tool_calling → generating → done)
- `ActivityPanel` + `StatusBar` 渲染

**(C) 右侧步骤面板** - [AgentStepsPanel.tsx](file:///d:/Administrator/Desktop/pioneering/frontend/pages/agent/components/AgentStepsPanel.tsx)
- 直接读取 `message.steps[]` 数组
- `StepRenderer` 按步骤类型渲染: `ThinkingStepView` / `ToolCallStepView` / `ToolResultStepView` / `TextStreamStepView` / `ReasoningIterationStepView` / `ErrorStepView`
- 显示实时进度 (已完成/总计)

---

### 三、关键类型映射总结

```
后端 Coordinator Frame           agent_bridge 转换        前端 StreamEvent          前端 Steps
─────────────────────────────────────────────────────────────────────────────────────────
event="status"                  → type="status"           → currentPhase 更新
  data={"phase":"thinking"}

event="thinking"                → type="thinking_delta"   → ThinkingStep
  data={"content":"..."}          + thinking_done           (type='thinking')

event="tool_call_start"         → type="tool_call_start"  → ToolCallStep
  data={"id":"..","name":".."}                               (type='tool_call')

event="tool_result"             → type="tool_result_end"  → ToolResultStep
  data={"id":"..","result":"."}                              (type='tool_result')

event="token"                   → type="answer_delta"     → TextStreamStep
  data={"token":"..."}                                        (type='text_stream')

event="reasoning_iteration"     → type="reasoning_        → ReasoningIterationStep
  data={"index":1,"max":3}        iteration"

event="done"                    → type="answer_done"      → 标记完成
  data={...}

event="error"                   → type="error"            → ErrorStep
  data={"error_code":"..."}                                   (type='error')
```

---

### 四、会话持久化 & 历史加载

1. **创建/列表**: `POST/GET /chat/sessions` → 操作 PostgreSQL `ChatSession` 表
2. **消息历史加载**: `GET /chat/sessions/{id}/messages` → 从 `ChatMessage` 表读取 → 前端 [fetchSessionMessages()](file:///d:/Administrator/Desktop/pioneering/frontend/pages/agent/api/agentApi.ts#L44-L112) 将 DB 字段 (`thinking_content`, `tool_calls`, `answer_content`) 还原为 `AgentStep[]` 数组
3. **流结束后持久化**: `chat.py` event_generator 在流结束时创建 `assistant` 的 `ChatMessage` 记录并 commit
4. **`__metadata__`**: 流结束后额外发送的元数据事件，汇总 `thinkingContent`, `answerContent`, `toolCalls` 供后端持久化使用

---

### 五、数据流中的关键设计点

1. **双层事件体系**: `agent_bridge.py` 中的 `_coordinator_frame_to_frontend_event()` 是前后端协议转换的单一入口，将 ModuAgent 内部帧格式转换为前端 `StreamEvent` 格式
2. **EventBus 解耦**: 前端 `agentEventBus` 允许 `AgentStepsPanel`、`ExecutionCard`、`StatusBar` 等组件独立订阅同一份流式数据，互不耦合
3. **SSE 逐 token 输出**: `Coordinator.stream_request()` 中最终回答通过字符级分块 (`chunk_size=4`) 或 LLM stream token 逐 token yield，前端通过 `useThrottledContent(50ms)` 节流渲染
4. **ReAct 工具循环**: Coordinator 支持最多 3 轮推理迭代，每轮都可调用工具，工具结果作为 observation 反馈给 LLM 继续推理

---

### 六、涉及的源代码文件清单

| 层级 | 文件 | 行数 | 核心职责 |
|------|------|------|---------|
| **前端 - 页面入口** | `frontend/pages/agent/index.tsx` | ~192 | 组装布局（侧边栏+聊天+右侧步骤面板+参数面板） |
| **前端 - API 层** | `frontend/pages/agent/api/agentApi.ts` | ~157 | GET/POST 会话和消息、SSE 流请求 |
| **前端 - 状态管理** | `frontend/pages/agent/hooks/useAgentChat.ts` | ~200+ | 消息管理、SSE 读取、发送/停止/重生成 |
| **前端 - SSE 解析** | `frontend/pages/agent/hooks/useStreamParser.ts` | ~390 | `StreamEvent` 解析 → `steps[]` 增量更新 + EventBus 广播 |
| **前端 - 执行状态** | `frontend/pages/agent/hooks/useAgentRun.ts` | ~200+ | 订阅 EventBus → 维护 RunState (Phase 时间线) |
| **前端 - 会话管理** | `frontend/pages/agent/hooks/useSessionManager.ts` | ~120 | 会话 CRUD、置顶/重命名 |
| **前端 - 类型定义** | `frontend/pages/agent/types/*.ts` | ~180 | `ChatMessage`, `AgentStep`, `StreamEvent`, `ChatSession` |
| **前端 - 聊天气泡** | `frontend/pages/agent/components/ChatMessage.tsx` | ~200+ | Markdown 渲染 + 执行卡片 + 操作栏 |
| **前端 - 步骤面板** | `frontend/pages/agent/components/AgentStepsPanel.tsx` | ~151 | 右侧面板：实时步骤列表、进度统计 |
| **前端 - 执行卡片** | `frontend/pages/agent/components/ExecutionCard.tsx` | ~29 | 活动面板 + 状态栏容器 |
| **前端 - API 端点** | `shared/api/endpoints.ts` | ~61 | 所有 REST API 路径定义 |
| **后端 - API 层** | `python-backend/app/api/v1/chat.py` | ~400+ | SSE 路由、会话/消息 CRUD |
| **后端 - 请求体** | `python-backend/app/schemas/chat.py` | ~95 | Pydantic 请求/响应模型 |
| **后端 - Agent 桥** | `python-backend/app/core/agent_bridge.py` | ~242 | ModuAgent 初始化、Coordinator → StreamEvent 转换 |
| **后端 - Coordinator** | `python-backend/ModuAgent/orchestration/coordinator.py` | ~700 | Agent 执行引擎 (Perception → Memory → ReAct → Stream) |
| **后端 - SSE 编码** | `python-backend/ModuAgent/orchestration/communication/streaming.py` | ~131 | SSEEncoder + StreamPublisher |
| **后端 - 事件协议** | `python-backend/ModuAgent/orchestration/communication/agui_adapter.py` | ~200+ | AGUI 事件类型定义及序列化 |
| **后端 - 协议定义** | `python-backend/ModuAgent/orchestration/communication/protocol.py` | ~200+ | AgentEvent、ErrorCode、EventDomain 等核心协议 |
| **后端 - LLM 适配** | `python-backend/ModuAgent/adapters/llm_adapter.py` | ~66 | LLM generate/stream 适配层 |
| **后端 - 配置** | `python-backend/app/config.py` | ~25 | 数据库、JWT、LLM 参数配置 |