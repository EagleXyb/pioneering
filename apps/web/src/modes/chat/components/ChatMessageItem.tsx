import { useState } from 'react';
import { ChatMessage, ChatActionBar } from '@tdesign-react/chat';
import type { ChatMessagesData } from 'tdesign-web-components/lib/chat-engine';
import type { ChatComment } from 'tdesign-web-components/lib/chat-engine';
import type { TdChatActionsName } from 'tdesign-web-components/lib/chat-action';
import { feedbackMessage } from '../../../api/message';

interface Props {
  message: ChatMessagesData;
}

const feedbackToComment: Record<string, ChatComment> = {
  like: 'good',
  dislike: 'bad',
  none: '',
};

export function ChatMessageItem({ message }: Props) {
  const [comment, setComment] = useState<ChatComment>(
    feedbackToComment[(message as any).feedback] || '',
  );

  const handleAction = (name: TdChatActionsName) => {
    let newComment: ChatComment = '';

    if (name === 'good') {
      newComment = comment === 'good' ? '' : 'good';
    } else if (name === 'bad') {
      newComment = comment === 'bad' ? '' : 'bad';
    }

    setComment(newComment);

    const feedbackMap: Record<string, 'like' | 'dislike' | 'none'> = {
      '': 'none',
      good: 'like',
      bad: 'dislike',
    };
    feedbackMessage((message as any).id, feedbackMap[newComment]).catch(() => {
      setComment(comment);
    });
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
          reasoning: {
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
