import React, { useCallback, useEffect } from 'react'
import { useAgentChat } from './hooks/useAgentChat'
import { useAgentRun } from './hooks/useAgentRun'
import { AgentMessageBubble } from './components/AgentMessage'
import { AgentInput } from './components/AgentInput'
import { AgentWelcome } from './components/AgentWelcome'
import { AgentRunProgress } from './components/AgentRunProgress'
import { useSmartScroll } from '../workspace/shared/hooks/useSmartScroll'

export const AgentMode: React.FC = () => {
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
    isInChatMode,
  } = useAgentChat()

  const { runState } = useAgentRun()

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
      {runState && runState.isRunning && (
        <AgentRunProgress
          phases={runState.phases}
          currentPhase={runState.currentPhase}
          currentIteration={runState.currentIteration}
          maxIterations={runState.maxIterations}
          toolCallCount={runState.toolCallCount}
          isRunning={runState.isRunning}
        />
      )}

      <div className="agent-messages-area" ref={containerRef}>
        {!isInChatMode ? (
          <AgentWelcome onSuggestionClick={onSuggestionClick} />
        ) : (
          <div className="agent-messages-list">
            {messages.map((msg) => (
              <AgentMessageBubble
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
        <AgentInput
          inputValue={inputValue}
          onInputChange={handleInputChange}
          onSend={handleSend}
          onStop={handleStop}
          isGenerating={isGenerating}
        />
      </div>
    </div>
  )
}

export default AgentMode
