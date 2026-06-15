import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { Layout, Button } from 'tdesign-react'
import { ArrowDownIcon } from 'tdesign-icons-react'
import { ChatSidebar } from './components/ChatSidebar'
import { ChatHeader } from './components/ChatHeader'
import { ChatMessageBubble } from './components/ChatMessage'
import { ChatInput } from './components/ChatInput'
import { WelcomePage } from './components/WelcomePage'
import { ParamPanel, useAgentParams, type AgentParams } from './components/ParamPanel'
import { AgentStepsPanel } from '../agent-professional/components/AgentStepsPanel'
import { useAgentRun } from '../agent-professional/hooks/useAgentRun'
import { useResizablePanel } from '../agent-professional/hooks/useResizablePanel'
import { useSmartScroll } from './shared/hooks/useSmartScroll'
import type { ChatMode as ChatModeType } from './shared/types'
import './styles/variables.css'
import './styles/layout.css'
import './styles/sidebar.css'

const { Aside, Content } = Layout

const Workspace: React.FC = () => {
  const [activeMode, setActiveMode] = useState<ChatModeType>('normal')
  const [paramVisible, setParamVisible] = useState(false)
  const { params, setParams } = useAgentParams()
  const { runState } = useAgentRun()

  const [maxPanelWidth, setMaxPanelWidth] = useState(() => Math.floor(window.innerWidth / 2))

  useEffect(() => {
    const handleResize = () => {
      setMaxPanelWidth(Math.floor(window.innerWidth / 2))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const rightPanel = useResizablePanel({
    initialWidth: 420,
    minWidth: 420,
    maxWidth: maxPanelWidth,
  })

  // 临时状态 - 实际由各模式 hook 管理
  const [messages, setMessages] = useState<import('./shared/types').ChatMessage[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [selectedModel, setSelectedModel] = useState('glm-4-flash')
  const [deepThinking, setDeepThinking] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [isInChatMode, setIsInChatMode] = useState(false)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<import('./shared/types').ChatSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)

  const isInProfessionalMode = activeMode === 'professional'

  const lastAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i]
    }
    return null
  }, [messages])

  const { containerRef, scrollToBottom, userScrolledUpRef } = useSmartScroll([messages])
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!userScrolledUpRef.current && isInChatMode) {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      })
    }
  }, [messages, isInChatMode, userScrolledUpRef])

  const handleSuggestionClick = (text: string) => {
    setInputValue(text)
    setTimeout(() => handleSend(), 100)
  }

  const handleSend = () => {
    // 实际发送逻辑由各模式 hook 处理
    setIsInChatMode(true)
  }

  const handleStop = () => {
    setIsGenerating(false)
  }

  const handleNewChat = () => {
    setMessages([])
    setCurrentSessionId(null)
    setInputValue('')
    setIsInChatMode(false)
  }

  const handleRegenerate = () => {
    // 实际重新生成逻辑由各模式 hook 处理
  }

  const handleInputChange = (value: string) => {
    setInputValue(value)
  }

  const handleModeChange = (mode: ChatModeType) => {
    setActiveMode(mode)
  }

  const deduplicatedMessages = useMemo(() => {
    const seen = new Set<string>()
    return messages.filter(msg => {
      if (seen.has(msg.id)) return false
      seen.add(msg.id)
      return true
    })
  }, [messages])

  return (
    <Layout className="workspace-layout">
      <ChatSidebar
        sessions={sessions}
        loading={sessionsLoading}
        currentSessionId={currentSessionId}
        onSelectSession={() => {}}
        onNewChat={handleNewChat}
        onRefresh={() => {}}
        onRemoveSession={() => {}}
        onTogglePin={() => {}}
        onRenameSession={() => {}}
      />

      <div className="agent-center-right-container">
        <Layout className="agent-main-layout">
          <ChatHeader
            onOpenParams={() => setParamVisible(true)}
          />

          <Content className="agent-content">
            {!isInChatMode ? (
              <WelcomePage onSuggestionClick={handleSuggestionClick} />
            ) : (
              <div className="agent-messages-container" ref={containerRef}>
                {deduplicatedMessages.map((msg) => (
                  <ChatMessageBubble
                    key={msg.id}
                    message={msg}
                    onRegenerate={handleRegenerate}
                    executionState={msg.id === lastAssistantMessage?.id ? runState : null}
                    isGenerating={isGenerating}
                    chatMode={activeMode}
                  />
                ))}
                <div ref={messagesEndRef} />
                {userScrolledUpRef.current && isInChatMode && (
                  <Button
                    className="agent-scroll-to-bottom"
                    theme="primary"
                    shape="circle"
                    size="small"
                    icon={<ArrowDownIcon />}
                    onClick={() => {
                      userScrolledUpRef.current = false
                      scrollToBottom()
                    }}
                  >
                    回到最新
                  </Button>
                )}
              </div>
            )}
          </Content>

          <div className="agent-input-container">
            <ChatInput
              inputValue={inputValue}
              onInputChange={handleInputChange}
              onSend={handleSend}
              onStop={handleStop}
              isGenerating={isGenerating}
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              deepThinking={deepThinking}
              onDeepThinkingChange={setDeepThinking}
              webSearch={webSearch}
              onWebSearchChange={setWebSearch}
              chatMode={activeMode}
              onChatModeChange={handleModeChange}
            />
          </div>
        </Layout>

        {isInProfessionalMode && (
          <>
            <div
              className={`agent-resizer ${rightPanel.collapsed ? 'collapsed' : ''}`}
              onMouseDown={rightPanel.handleMouseDown}
              onDoubleClick={rightPanel.toggleCollapsed}
            >
              <div className="agent-resizer-line" />
            </div>

            <div
              className="agent-right-panel-wrapper"
              style={{ width: rightPanel.width }}
            >
              <AgentStepsPanel
                message={lastAssistantMessage}
                isGenerating={isGenerating}
                collapsed={rightPanel.collapsed}
                onToggleCollapsed={rightPanel.toggleCollapsed}
              />
            </div>
          </>
        )}
      </div>

      <ParamPanel
        visible={paramVisible}
        onClose={() => setParamVisible(false)}
        params={params}
        onChange={(p) => setParams(p as AgentParams)}
      />
    </Layout>
  )
}

export default Workspace
