import React from 'react'
import { Button } from 'tdesign-react'

interface WelcomePageProps {
  onSuggestionClick: (text: string) => void
}

const SUGGESTIONS = [
  '帮我写一份项目提案',
  '分析当前技术架构的优缺点',
  '生成一个创意营销方案',
  '帮我解读这段代码的逻辑',
]

export const WelcomePage: React.FC<WelcomePageProps> = ({ onSuggestionClick }) => {
  return (
    <div className="agent-welcome">
      <div className="agent-welcome-icon">
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 18,
            background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #6366f1 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(79, 70, 229, 0.18), 0 2px 8px rgba(79, 70, 229, 0.08)',
          }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" fill="rgba(255,255,255,0.2)"/>
            <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
            <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
          </svg>
        </div>
      </div>
      <h2 className="agent-welcome-title">有什么我可以帮助你的？</h2>
      <p className="agent-welcome-desc">
        体验从创意生成到方案落地的全流程智能对话
      </p>
      <div className="agent-suggestions">
        {SUGGESTIONS.map((text) => (
          <Button
            key={text}
            theme="default"
            variant="outline"
            className="agent-suggestion-btn"
            onClick={() => onSuggestionClick(text)}
          >
            {text}
          </Button>
        ))}
      </div>
    </div>
  )
}
