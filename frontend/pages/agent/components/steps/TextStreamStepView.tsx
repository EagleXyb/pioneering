import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import type { TextStreamStep } from '../../types'
import { useThrottledContent } from '../../hooks/useThrottledContent'
import { CodeBlock } from './CodeBlock'

export const TextStreamStepView: React.FC<{ step: TextStreamStep }> = React.memo(({ step }) => {
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
