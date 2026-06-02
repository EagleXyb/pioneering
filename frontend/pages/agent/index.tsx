import React, { useState, useMemo, useRef, useEffect } from 'react'
import { Layout, Button, Divider } from 'tdesign-react'
import { ArrowLeftIcon, ArrowDownIcon } from 'tdesign-icons-react'
import { useNavigate } from 'react-router-dom'

import { useAgentChat } from './hooks/useAgentChat'
import { useSmartScroll } from './hooks/useSmartScroll'
import { ChatSidebar } from './components/ChatSidebar'
import { ChatMessageBubble } from './components/ChatMessage'
import { ChatInput } from './components/ChatInput'
import { BottomPanel } from './components/BottomPanel'
import { ParamPanel, useAgentParams, type AgentParams } from './components/ParamPanel'
import './styles/chatbot.css'

const { Header, Content } = Layout

const AgentChatbot: React.FC = () => {
  const navigate = useNavigate()

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

  const handleExport = () => {
    const content = messages
      .map((m) => {
        const role = m.role === 'user' ? '你' : m.role === 'assistant' ? 'AI' : '系统'
        return `### ${role} (${new Date(m.timestamp).toLocaleString()})\n\n${m.content}\n`
      })
      .join('\n---\n\n')

    const blob = new Blob([`# AI 对话导出\n\n${content}`], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ai-chat-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleClear = () => {
    if (confirm('确定要清空当前对话吗？')) {
      handleNewChat()
    }
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

      <Layout className="agent-main-layout">
        <Header className="agent-header">
          <div className="agent-header-left">
            <Button
              theme="default"
              variant="text"
              shape="square"
              icon={<ArrowLeftIcon />}
              onClick={() => navigate(-1)}
            />
            <Divider layout="vertical" />
            <span className="agent-header-title">AI 智能对话</span>
            {currentSessionId && (
              <span className="agent-header-session-id">
                会话: {currentSessionId.slice(0, 12)}...
              </span>
            )}
          </div>
          <div className="agent-header-right">
            <Button
              theme="default"
              variant="outline"
              size="small"
              onClick={handleNewChat}
            >
              新对话
            </Button>
          </div>
        </Header>

        <Content className="agent-content">
          {!isInChatMode ? (
            <div className="agent-welcome">
              <div className="agent-welcome-icon">
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 16,
                    background: 'linear-gradient(135deg, var(--td-brand-color), var(--td-brand-color-7))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span style={{ color: '#fff', fontSize: 32, fontWeight: 700 }}>AI</span>
                </div>
              </div>
              <h2 className="agent-welcome-title">有什么我可以帮助你的？</h2>
              <p className="agent-welcome-desc">
                体验从创意生成到方案落地的全流程智能对话
              </p>
              <div className="agent-suggestions">
                {['帮我写一份项目提案', '分析当前技术架构的优缺点', '生成一个创意营销方案', '帮我解读这段代码的逻辑'].map(
                  (text) => (
                    <Button
                      key={text}
                      theme="default"
                      variant="outline"
                      className="agent-suggestion-btn"
                      onClick={() => {
                        handleInputChange(text)
                        setTimeout(() => handleSend(), 100)
                      }}
                    >
                      {text}
                    </Button>
                  ),
                )}
              </div>
            </div>
          ) : (
            <div className="agent-messages-container" ref={containerRef}>
              {messages.map((msg) => (
                <ChatMessageBubble
                  key={msg.id}
                  message={msg}
                  onRegenerate={handleRegenerate}
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

        <div className="agent-bottom-wrapper">
          <BottomPanel
            lastMessage={lastAssistantMessage}
            isGenerating={isGenerating}
            deepThinking={deepThinking}
            webSearch={webSearch}
            onDeepThinkingChange={setDeepThinking}
            onWebSearchChange={setWebSearch}
            onOpenParams={() => setParamVisible(true)}
            onClear={handleClear}
            onRegenerate={handleRegenerate}
            onExport={handleExport}
          />

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
        </div>
      </Layout>

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
