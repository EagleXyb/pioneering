import React, { useState } from 'react'

interface CodeBlockProps {
  language: string
  value: string
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language, value }) => {
  const lines = value.split('\n')
  const isLong = lines.length > 50
  const [expanded, setExpanded] = useState(false)
  const displayCode =
    isLong && !expanded ? lines.slice(0, 50).join('\n') + '\n// ... (click to expand)' : value

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-block-lang">{language}</span>
      </div>
      <pre className="code-block-pre" onClick={() => isLong && setExpanded(!expanded)} style={{ cursor: isLong ? 'pointer' : 'default' }}>
        <code className={`language-${language}`}>{displayCode}</code>
      </pre>
    </div>
  )
}
