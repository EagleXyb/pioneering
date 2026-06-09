import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import type { ThinkingStep } from '../../types'
import { useThrottledContent } from '../../hooks/useThrottledContent'

export const ThinkingStepView: React.FC<{ step: ThinkingStep }> = React.memo(({ step }) => {
  const isStreaming = step.status === 'streaming'
  const throttledContent = useThrottledContent(step.content, 50)

  return (
    <div className="step-content">
      {throttledContent ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
        >
          {throttledContent}
        </ReactMarkdown>
      ) : (
        <span className="step-empty">思考中...</span>
      )}
    </div>
  )
})

ThinkingStepView.displayName = 'ThinkingStepView'