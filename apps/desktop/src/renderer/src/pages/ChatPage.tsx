// ---- ChatPage ----

import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MessageList, ChatInput, AgentStatus } from '../components/chat'
import { useChatStore } from '../store/chatStore'

export function ChatPage(): JSX.Element {
  const [searchParams] = useSearchParams()
  const sessionIdFromUrl = searchParams.get('session')

  const {
    currentSessionId,
    selectSession,
    messages,
    isStreaming,
    streamingContent,
    streamingMessageId,
    sendMessage,
    stopStreaming,
    error,
    clearError,
    loadSessions
  } = useChatStore()

  // 根据 URL 参数选择会话
  useEffect(() => {
    if (sessionIdFromUrl && sessionIdFromUrl !== currentSessionId) {
      selectSession(sessionIdFromUrl)
    }
  }, [sessionIdFromUrl])

  // 首次进入加载会话列表
  useEffect(() => {
    loadSessions()
  }, [])

  const currentMessages = currentSessionId
    ? messages[currentSessionId] || []
    : []

  return (
    <div className="flex flex-col h-full">
      {/* Agent 状态栏 */}
      <AgentStatus
        isStreaming={isStreaming}
        error={error}
        onClearError={clearError}
      />

      {/* 消息列表 */}
      <MessageList
        messages={currentMessages}
        streamingContent={streamingContent}
        streamingMessageId={streamingMessageId}
        isStreaming={isStreaming}
      />

      {/* 输入框 */}
      <ChatInput
        onSend={sendMessage}
        onStop={stopStreaming}
        isStreaming={isStreaming}
        disabled={false}
      />
    </div>
  )
}
