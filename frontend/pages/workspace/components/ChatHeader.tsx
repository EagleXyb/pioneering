import React from 'react'
import { Tooltip, Button } from 'tdesign-react'

const SettingsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

interface ChatHeaderProps {
  onOpenParams: () => void
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  onOpenParams,
}) => {

  return (
    <div className="agent-header">
      <div className="agent-header-left">
        <span className="agent-header-title">AI Assistant</span>
      </div>
      <div className="agent-header-right">
        <Tooltip content="Parameters">
          <Button theme="default" variant="text" size="small" icon={<SettingsIcon />} onClick={onOpenParams} />
        </Tooltip>
      </div>
    </div>
  )
}
