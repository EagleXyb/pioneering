import { ChatMessage } from '@tdesign-react/chat';
import type { ChatMessagesData } from 'tdesign-web-components/lib/chat-engine';

interface Props {
  message: ChatMessagesData;
}

export function ChatMessageItem({ message }: Props) {
  return (
    <ChatMessage
      message={message}
      avatar=""
      variant="base"
      placement={message.role === 'user' ? 'right' : 'left'}
      chatContentProps={{
        thinking: {
          collapsed: false,
          layout: 'border',
          animation: 'circle',
          maxHeight: 300,
        },
      }}
    />
  );
}
