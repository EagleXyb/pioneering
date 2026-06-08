import React from 'react'
import { Collapse, Tag, Loading } from 'tdesign-react'
import { BugIcon } from 'tdesign-icons-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import type { ThinkingStep } from '../../types'
import { useThrottledContent } from '../../hooks/useThrottledContent'
import { formatDuration } from '../../utils/formatters'

export const ThinkingStepView: React.FC<{ step: ThinkingStep }> = React.memo(({ step }) => {
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
              <BugIcon style={{ color: 'var(--ag-accent, #4f46e5)' }} />
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
