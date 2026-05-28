import React from 'react'
import { Layout, Button, Divider } from 'tdesign-react'
import { ArrowLeftIcon } from 'tdesign-icons-react'
import { useNavigate } from 'react-router-dom'

import { useAgentChat } from './hooks/useAgentChat'
import { ChatSidebar } from './components/ChatSidebar'
import { ChatMessageBubble } from './components/ChatMessage'
import { ChatInput } from './components/ChatInput'
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
    messagesEndRef,
    isInChatMode,
  } = useAgentChat()

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
            <div className="agent-messages-container">
              {messages.map((msg) => (
                <ChatMessageBubble
                  key={msg.id}
                  message={msg}
                />
              ))}
              <div ref={messagesEndRef} />
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
    </Layout>
  )
}

export default AgentChatbot