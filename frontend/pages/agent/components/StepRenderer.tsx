import React, { useState } from 'react'
import { Collapse, Card, Tag, Loading, Divider, Alert, Button, Timeline } from 'tdesign-react'
import {
  BugIcon,
  ToolsIcon,
  CheckCircleIcon,
  CloseCircleIcon,
  TimeIcon,
  RefreshIcon,
} from 'tdesign-icons-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import type {
  AgentStep,
  ThinkingStep,
  ToolCallStep,
  ToolResultStep,
  TextStreamStep,
  ReasoningIterationStep,
  ErrorStep,
  StepStatus,
} from '../types'
import { StepType } from '../types'
import { useThrottledContent } from '../hooks/useThrottledContent'

function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2)
  } catch {
    return str
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function statusToTagTheme(status: StepStatus): 'default' | 'primary' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'pending':
      return 'default'
    case 'streaming':
      return 'warning'
    case 'success':
      return 'success'
    case 'error':
      return 'danger'
  }
}

function statusToLabel(status: StepStatus, defaultLabel: string): string {
  if (status === 'pending') return '等待中'
  if (status === 'streaming') return '执行中'
  if (status === 'success') return '已完成'
  if (status === 'error') return '失败'
  return defaultLabel
}

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

const ThinkingStepView: React.FC<{ step: ThinkingStep }> = React.memo(({ step }) => {
  const isStreaming = step.status === 'streaming'
  const throttledContent = useThrottledContent(step.content, 50)
  const duration = step.endTime ? formatDuration(step.endTime - step.startTime) : ''

  return (
    <div className="step-thinking">
      <Collapse
        defaultValue={isStreaming ? ['thinking'] : []}
        expandOnRowClick
        borderless
        className="step-thinking-collapse"
      >
        <Collapse.Panel
          value="thinking"
          header={
            <div className="step-thinking-header">
              <BugIcon style={{ color: 'var(--td-brand-color)' }} />
              <span className="step-thinking-title">思考过程</span>
              {isStreaming && <Loading size="small" />}
              {!isStreaming && duration && (
                <Tag size="small" variant="light" theme="default">
                  {duration}
                </Tag>
              )}
            </div>
          }
        >
          <div className="step-thinking-content">
            {throttledContent ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
              >
                {throttledContent}
              </ReactMarkdown>
            ) : (
              <span className="step-empty">暂无内容</span>
            )}
          </div>
        </Collapse.Panel>
      </Collapse>
    </div>
  )
})

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
            <Tag theme={statusToTagTheme(step.status)} variant="light" size="small">
              {statusToLabel(step.status, '已完成')}
            </Tag>
          </div>
        </div>
        {step.arguments && (
          <div className="step-tool-call-args">
            <div className="step-tool-call-label">参数</div>
            <pre className="step-tool-call-code">{formatJson(step.arguments)}</pre>
          </div>
        )}
        {step.errorCode && (
          <div className="step-tool-call-error">
            <Tag theme="danger" variant="light" size="small">
              {step.errorCode}
            </Tag>
          </div>
        )}
      </Card>
    </div>
  )
})

const ToolResultStepView: React.FC<{ step: ToolResultStep }> = React.memo(({ step }) => {
  const isStreaming = step.status === 'streaming'
  const isError = step.status === 'error'

  return (
    <div className="step-tool-result">
      <Timeline layout="vertical" className="step-tool-result-timeline">
        <Timeline.Item
          label={step.duration ? formatDuration(step.duration) : ''}
          dot={
            isError ? (
              <CloseCircleIcon style={{ color: 'var(--td-error-color)' }} />
            ) : (
              <CheckCircleIcon style={{ color: 'var(--td-success-color)' }} />
            )
          }
        >
          <div className="step-tool-result-header">
            <Tag theme={isError ? 'danger' : 'success'} variant="light" size="small">
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
            <pre className="step-tool-call-code">{formatJson(step.result)}</pre>
          )}
          {isStreaming && (
            <div className="step-tool-result-loading">
              <Loading size="small" text="接收结果中..." />
            </div>
          )}
        </Timeline.Item>
      </Timeline>
    </div>
  )
})

interface CodeBlockProps {
  language: string
  value: string
}

const CodeBlock: React.FC<CodeBlockProps> = ({ language, value }) => {
  const lines = value.split('\n')
  const isLong = lines.length > 50
  const [expanded, setExpanded] = useState(false)
  const displayCode =
    isLong && !expanded ? lines.slice(0, 50).join('\n') + '\n// ... (点击展开全部)' : value

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-block-lang">{language}</span>
        {isLong && (
          <Button
            size="small"
            variant="text"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(!expanded)
            }}
          >
            {expanded ? '收起' : '展开全部'}
          </Button>
        )}
      </div>
      <pre className="code-block-pre">
        <code className={`language-${language}`}>{displayCode}</code>
      </pre>
    </div>
  )
}

const TextStreamStepView: React.FC<{ step: TextStreamStep }> = React.memo(({ step }) => {
  const throttledContent = useThrottledContent(step.content, 50)
  const isStreaming = step.status === 'streaming'

  return (
    <div className={`step-text-stream ${isStreaming ? 'streaming' : ''}`}>
      {throttledContent ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '')
              const codeStr = String(children).replace(/\n$/, '')
              if (match) {
                return <CodeBlock language={match[1]} value={codeStr} />
              }
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              )
            },
          }}
        >
          {throttledContent}
        </ReactMarkdown>
      ) : null}
    </div>
  )
})

const ReasoningIterationStepView: React.FC<{ step: ReasoningIterationStep }> = React.memo(
  ({ step }) => (
    <Divider align="center" className="step-reasoning-iteration">
      <Tag theme="primary" variant="light" size="small">
        第 {step.iterationIndex}/{step.maxIterations} 轮推理
      </Tag>
    </Divider>
  ),
)

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
