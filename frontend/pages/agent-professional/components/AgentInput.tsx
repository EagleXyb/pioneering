import React from 'react'
import { ChatSender } from '@tdesign-react/chat'
import { Button, Space, Tooltip } from 'tdesign-react'
import {
  ArrowUpIcon,
  StopIcon,
  AttachIcon,
} from 'tdesign-icons-react'
import type { TdChatSenderParams } from 'tdesign-web-components/lib/chat-sender/type'

interface AgentInputProps {
  inputValue: string
  onInputChange: (value: string) => void
  onSend: (value?: string) => void
  onStop: () => void
  isGenerating: boolean
}

export const AgentInput: React.FC<AgentInputProps> = ({
  inputValue,
  onInputChange,
  onSend,
  onStop,
  isGenerating,
}) => {
  const handleChange = (e: CustomEvent<string>) => {
    onInputChange(e.detail)
  }

  const handleSend = (e: CustomEvent<TdChatSenderParams>) => {
    onSend(e.detail.value)
  }

  const handleStop = () => {
    onStop()
  }

  return (
    <ChatSender
      value={inputValue}
      placeholder="Describe your task, Agent will auto-plan and execute..."
      loading={isGenerating}
      autosize={{ minRows: 2, maxRows: 6 }}
      onChange={handleChange}
      onSend={handleSend}
      onStop={handleStop}
    >
      <div slot="footer-prefix">
        <Space align="center" size="small">
          <Tooltip content="Images only, max 20MB total">
            <Button
              shape="round"
              variant="outline"
              size="small"
              icon={<AttachIcon />}
            />
          </Tooltip>
        </Space>
      </div>

      <div slot="actions">
        {!isGenerating ? (
          <Button
            shape="circle"
            icon={<ArrowUpIcon size={24} />}
            onClick={() => onSend()}
            style={{ opacity: inputValue ? '1' : '0.5' }}
          />
        ) : (
          <Button
            shape="circle"
            icon={<StopIcon size={32} />}
            onClick={handleStop}
          />
        )}
      </div>
    </ChatSender>
  )
}
