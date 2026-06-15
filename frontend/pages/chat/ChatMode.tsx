import React, { useCallback, useEffect } from 'react'
import { useChat } from './hooks/useChat'
import { ChatMessageBubble } from './components/ChatMessage'
import { ChatInput } from './components/ChatInput'
import { WelcomePage } from './components/WelcomePage'
import { useSmartScroll } from '../workspace/shared/hooks/useSmartScroll'

export const ChatMode: React.FC = () => {
  const {
    messages,
    isGenerating,
    inputValue,
    setInputValue,
    handleSend,
    handleStop,
    handleNewChat,
    handleRegenerate,
    handleInputChange,
    selectedModel,
    setSelectedModel,
    deepThinking,
    setDeepThinking,
    webSearch,
    setWebSearch,
    isInChatMode,
  } = useChat()

  const { containerRef, scrollToBottom, userScrolledUpRef } = useSmartScroll([messages])

  useEffect(() => {
    if (!userScrolledUpRef.current && isInChatMode) {
      scrollToBottom()
    }
  }, [messages, isInChatMode, scrollToBottom, userScrolledUpRef])

  const onSuggestionClick = useCallback(
    (text: string) => {
      handleSend(text)
    },
    [handleSend],
  )

  return (
    <div className="agent-chat-container">
      <div className="agent-messages-area" ref={containerRef}>
        {!isInChatMode ? (
          <WelcomePage onSuggestionClick={onSuggestionClick} />
        ) : (
          <div className="agent-messages-list">
            {messages.map((msg) => (
              <ChatMessageBubble
                key={msg.id}
                message={msg}
                onRegenerate={msg.role === 'assistant' ? handleRegenerate : undefined}
                isGenerating={isGenerating}
              />
            ))}
          </div>
        )}
      </div>

      <div className="agent-input-area">
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
  )
}

export default ChatMode
