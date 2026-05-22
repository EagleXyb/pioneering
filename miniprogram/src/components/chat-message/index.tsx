interface ChatMessageProps {
  content: string;
  isUser: boolean;
}

export default function ChatMessage({ content, isUser }: ChatMessageProps) {
  return (
    <t-chat-message
      role={isUser ? 'user' : 'assistant'}
      content={{ type: 'text', data: content }}
    >
      {/* content 插槽：使用 t-chat-content 渲染对话正文 */}
      <t-chat-content
        slot="content"
        content={{ type: 'text', data: content }}
        role={isUser ? 'user' : 'assistant'}
      />
    </t-chat-message>
  );
}