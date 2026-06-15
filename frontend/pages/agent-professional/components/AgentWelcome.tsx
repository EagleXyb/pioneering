import React from 'react'
import { Button } from 'tdesign-react'

interface AgentWelcomeProps {
  onSuggestionClick: (text: string) => void
}

const SUGGESTIONS = [
  '帮我分析这份报告并生成摘要',
  '搜索最新的技术趋势并整理',
  '规划一个完整的开发流程',
  '帮我调试这段代码并修复问题',
]

export const AgentWelcome: React.FC<AgentWelcomeProps> = ({ onSuggestionClick }) => {
  return (
    <div className="agent-welcome">
      <div className="agent-welcome-icon">
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 18,
            background: 'linear-gradient(135deg, #059669 0%, #10b981 50%, #34d399 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(5, 150, 105, 0.18), 0 2px 8px rgba(5, 150, 105, 0.08)',
          }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2Z" stroke="white" strokeWidth="1.5" fill="rgba(255,255,255,0.15)"/>
            <path d="M8 12L11 15L16 9" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>
      <h2 className="agent-welcome-title">专业 Agent 模式</h2>
      <p className="agent-welcome-desc">
        自动规划任务、调用工具、多步推理，完成复杂工作流
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
