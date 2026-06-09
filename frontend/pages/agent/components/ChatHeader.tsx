import React from 'react'
import { Tooltip, Button } from 'tdesign-react'
import { SettingIcon } from 'tdesign-icons-react'

interface ChatHeaderProps {
  onOpenParams: () => void
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  onOpenParams,
}) => {

  return (
    <div className="agent-header">
      <div className="agent-header-left">
        <span className="agent-header-title">AI 智能对话</span>
      </div>
      <div className="agent-header-right">
        <Tooltip content="参数配置">
          <Button theme="default" variant="text" size="small" icon={<SettingIcon />} onClick={onOpenParams} />
        </Tooltip>
      </div>
    </div>
  )
}
