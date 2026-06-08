import type { ChatMessage } from '../types'

export function exportMessages(messages: ChatMessage[]): void {
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
