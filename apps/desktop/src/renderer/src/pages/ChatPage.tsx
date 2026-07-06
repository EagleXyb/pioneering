// ============================================================
// ChatPage — 聊天页面 (由 ChatPanel 替代，保留用于路由兼容)
// ============================================================

import { ChatPanel } from '../components/chat/ChatPanel'

export function ChatPage(): JSX.Element {
  return <ChatPanel />
}
