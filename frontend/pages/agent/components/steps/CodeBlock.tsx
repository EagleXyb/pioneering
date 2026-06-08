import React, { useState } from 'react'
import { Button } from 'tdesign-react'

interface CodeBlockProps {
  language: string
  value: string
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language, value }) => {
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
