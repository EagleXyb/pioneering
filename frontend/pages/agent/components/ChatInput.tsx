import React, { useRef } from 'react'
import { ChatSender } from '@tdesign-react/chat'
import { Button, Space, Tooltip, Dropdown, Tag } from 'tdesign-react'
import {
  ArrowUpIcon,
  StopIcon,
  InternetIcon,
  AttachIcon,
} from 'tdesign-icons-react'
import type { TdChatSenderParams } from 'tdesign-web-components/lib/chat-sender/type'
import { MODEL_MAP, PROVIDER_LIST } from '@shared/constants'

interface ChatInputProps {
  inputValue: string
  onInputChange: (value: string) => void
  onSend: (value?: string) => void
  onStop: () => void
  isGenerating: boolean
  selectedModel: string
  onModelChange: (model: string) => void
  deepThinking: boolean
  onDeepThinkingChange: (value: boolean) => void
  webSearch: boolean
  onWebSearchChange: (value: boolean) => void
}

const ALL_MODELS = PROVIDER_LIST.flatMap((provider) =>
  (MODEL_MAP[provider.id] || []).map((m) => ({
    content: `${provider.name} - ${m.name}`,
    value: m.id,
  })),
)

export const ChatInput: React.FC<ChatInputProps> = ({
  inputValue,
  onInputChange,
  onSend,
  onStop,
  isGenerating,
  selectedModel,
  onModelChange,
  deepThinking,
  onDeepThinkingChange,
  webSearch,
  onWebSearchChange,
}) => {
  const senderRef = useRef<HTMLElement>(null)

  const currentModelLabel =
    ALL_MODELS.find((m) => m.value === selectedModel)?.content || '选择模型'

  const handleChange = (e: CustomEvent<string>) => {
    onInputChange(e.detail)
  }

  const handleSend = (e: CustomEvent<TdChatSenderParams>) => {
    onSend(e.detail.value)
  }

  const handleStop = () => {
    onStop()
  }

  const handleModelSwitch = (data: unknown) => {
    const v = (data as { value?: string | number }).value
    if (v != null) onModelChange(String(v))
  }

  const onAttachClick = () => {
    senderRef.current?.focus()
  }

  return (
    <ChatSender
      ref={senderRef}
      value={inputValue}
      placeholder="输入你的问题，体验智能对话..."
      loading={isGenerating}
      autosize={{ minRows: 2, maxRows: 6 }}
      onChange={handleChange}
      onSend={handleSend}
      onStop={handleStop}
    >
      <div slot="input-prefix">
        <Dropdown
          options={ALL_MODELS}
          onClick={handleModelSwitch}
          trigger="click"
          style={{ padding: 0 }}
        >
          <Tag
            shape="round"
            variant="light"
            color="#0052D9"
            style={{ marginRight: 4, cursor: 'pointer' }}
          >
            {currentModelLabel}
          </Tag>
        </Dropdown>
      </div>

      <div slot="footer-prefix">
        <Space align="center" size="small">
          <Tooltip content="仅支持图片，总大小不超过20M">
            <Button
              shape="round"
              variant="outline"
              size="small"
              icon={<AttachIcon />}
              onClick={onAttachClick}
            />
          </Tooltip>
          <Button
            variant="outline"
            shape="round"
            theme={deepThinking ? 'primary' : 'default'}
            size="small"
            onClick={() => onDeepThinkingChange(!deepThinking)}
          >
            R1.深度思考
          </Button>
          <Button
            variant="outline"
            shape="round"
            theme={webSearch ? 'primary' : 'default'}
            icon={<InternetIcon />}
            size="small"
            onClick={() => onWebSearchChange(!webSearch)}
          >
            联网查询
          </Button>
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