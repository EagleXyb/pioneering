import React, { useRef } from 'react'
import { ChatSender } from '@tdesign-react/chat'
import { Button, Space, Tooltip, Dropdown, Tag } from 'tdesign-react'
import {
  ArrowUpIcon,
  StopIcon,
  InternetIcon,
  AttachIcon,
  CheckIcon,
  ChevronDownIcon,
} from 'tdesign-icons-react'
import type { TdChatSenderParams } from 'tdesign-web-components/lib/chat-sender/type'
import { MODEL_MAP, PROVIDER_LIST } from '@shared/constants'

export type ChatMode = 'normal' | 'professional' | 'task'

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
  chatMode: ChatMode
  onChatModeChange: (mode: ChatMode) => void
}

const ALL_MODELS = PROVIDER_LIST.flatMap((provider) =>
  (MODEL_MAP[provider.id] || []).map((m) => ({
    content: `${provider.name} - ${m.name}`,
    value: m.id,
  })),
)

const MODE_OPTIONS: Array<{
  value: ChatMode
  label: string
}> = [
  { value: 'normal',       label: 'Normal Mode' },
  { value: 'professional', label: 'Professional Mode' },
  { value: 'task',         label: 'Task Mode' },
]

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
  chatMode,
  onChatModeChange,
}) => {
  const senderRef = useRef<HTMLElement>(null)

  const currentModelLabel =
    ALL_MODELS.find((m) => m.value === selectedModel)?.content || 'Select Model'

  const currentMode: { value: ChatMode; label: string } =
    MODE_OPTIONS.find((m) => m.value === chatMode) || MODE_OPTIONS[0]

  const handleModeSelect = (data: unknown) => {
    const v = (data as { value?: string | number }).value
    if (v === 'normal' || v === 'professional' || v === 'task') {
      onChatModeChange(v)
    }
  }

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
      placeholder="Enter your question..."
      loading={isGenerating}
      autosize={{ minRows: 2, maxRows: 6 }}
      onChange={handleChange}
      onSend={handleSend}
      onStop={handleStop}
    >
      <div slot="footer-prefix">
        <Space align="center" size="small">
          <Dropdown
            trigger="click"
            placement="top-left"
            onClick={handleModeSelect}
            options={MODE_OPTIONS.map((m) => ({
              content: (
                <div className="agent-mode-option">
                  <span className="agent-mode-option-label">{m.label}</span>
                  {m.value === chatMode && (
                    <CheckIcon className="agent-mode-option-check" />
                  )}
                </div>
              ),
              value: m.value,
            }))}
          >
            <Button
              variant="outline"
              shape="round"
              size="small"
            >
              {currentMode.label}
              <ChevronDownIcon style={{ marginLeft: 4, verticalAlign: 'middle' }} />
            </Button>
          </Dropdown>
          <Tooltip content="Images only, max 20MB total">
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
            R1.Deep Thinking          </Button>
          <Button
            variant="outline"
            shape="round"
            theme={webSearch ? 'primary' : 'default'}
            icon={<InternetIcon />}
            size="small"
            onClick={() => onWebSearchChange(!webSearch)}
          >
            Web Search
          </Button>
        </Space>
      </div>

      <div slot="actions">
        <Dropdown
          options={ALL_MODELS}
          onClick={handleModelSwitch}
          trigger="click"
        >
          <Tag
            shape="round"
            variant="light"
            className="model-selector-tag"
          >
            {currentModelLabel}
          </Tag>
        </Dropdown>
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
