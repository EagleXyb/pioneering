import { useState } from 'react';
import { ChatMessage, ChatActionBar } from '@tdesign-react/chat';
import type { ChatMessagesData } from 'tdesign-web-components/lib/chat-engine';
import type { ChatComment } from 'tdesign-web-components/lib/chat-engine';
import type { TdChatActionsName } from 'tdesign-web-components/lib/chat-action';

interface Props {
  message: ChatMessagesData;
}

export function ChatMessageItem({ message }: Props) {
  const [comment, setComment] = useState<ChatComment>((message as any).comment || '');

  const handleAction = (name: TdChatActionsName) => {
    if (name === 'good') {
      setComment(comment === 'good' ? '' : 'good');
    } else if (name === 'bad') {
      setComment(comment === 'bad' ? '' : 'bad');
    }
  };

  // 提取文本内容用于复制
  const copyText =
    message.role === 'assistant' && message.content
      ? message.content
          .filter((c) => c.type === 'text' || c.type === 'markdown')
          .map((c) => (c as { data: string }).data)
          .join('\n')
      : '';

  return (
    <div className={message.role === 'assistant' ? 'chat-message-ai' : ''}>
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
      >
        {message.role === 'assistant' && (
          <ChatActionBar
            slot="actionbar"
            actionBar={['copy', 'good', 'bad', 'share', 'replay']}
            comment={comment}
            copyText={copyText}
            handleAction={handleAction}
            tooltipProps={{
              theme: 'light',
              showArrow: false,
            }}
          />
        )}
      </ChatMessage>
    </div>
  );
}
