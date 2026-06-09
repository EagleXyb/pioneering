import React, { useState, useMemo, useRef, useEffect } from 'react'
import { Layout, Button } from 'tdesign-react'
import { ArrowDownIcon } from 'tdesign-icons-react'

import { useAgentChat } from './hooks/useAgentChat'
import { useSmartScroll } from './hooks/useSmartScroll'
import { useAgentRun } from './hooks/useAgentRun'
import { useResizablePanel } from './hooks/useResizablePanel'
import { ChatSidebar } from './components/ChatSidebar'
import { ChatMessageBubble } from './components/ChatMessage'
import { ChatInput } from './components/ChatInput'
import { ChatHeader } from './components/ChatHeader'
import { WelcomePage } from './components/WelcomePage'
import { AgentStepsPanel } from './components/AgentStepsPanel'
import { ParamPanel, useAgentParams, type AgentParams } from './components/ParamPanel'
import './styles/chatbot.css'

const { Content } = Layout

const AgentChatbot: React.FC = () => {
  const {
    messages,
    isGenerating,
    inputValue,
    handleSend,
    handleStop,
    handleNewChat,
    handleRegenerate,
    handleInputChange,
    currentSessionId,
    sessions,
    sessionsLoading,
    selectedModel,
    setSelectedModel,
    deepThinking,
    setDeepThinking,
    webSearch,
    setWebSearch,
    loadSession,
    fetchSessions,
    isInChatMode,
  } = useAgentChat()

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
    handleInputChange(text)
    setTimeout(() => handleSend(), 100)
  }

  return (
    <Layout className="agent-layout">
      <ChatSidebar
        sessions={sessions}
        loading={sessionsLoading}
        currentSessionId={currentSessionId}
        onSelectSession={loadSession}
        onNewChat={handleNewChat}
        onRefresh={fetchSessions}
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
                {messages.map((msg) => (
                  <ChatMessageBubble
                    key={msg.id}
                    message={msg}
                    onRegenerate={handleRegenerate}
                    executionState={msg.id === lastAssistantMessage?.id ? runState : null}
                    isGenerating={isGenerating}
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
            />
          </div>
        </Layout>

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

export default AgentChatbot
