import { useState } from 'react';
import { ChatMessage, ChatActionBar } from '@tdesign-react/chat';
import { MessagePlugin } from 'tdesign-react';
import type { ChatComment, TdChatActionsName } from '../../../types/tdesign';
import type { ChatMessageData } from '../../../api/converter';
import { feedbackMessage } from '../../../api/message';

interface Props {
  message: ChatMessageData;
  onReplay?: (messageId: string) => void;
}

const feedbackToComment: Record<string, ChatComment> = {
  like: 'good',
  dislike: 'bad',
  none: '',
};

export function ChatMessageItem({ message, onReplay }: Props) {
  const [comment, setComment] = useState<ChatComment>(
    feedbackToComment[message.feedback ?? 'none'] || '',
  );

  const handleAction = (name: TdChatActionsName) => {
    if (name === 'replay') {
      onReplay?.(message.id);
      return;
    }

    // P2-5 修复：分享按钮 — 复制消息内容到剪贴板
    if (name === 'share') {
      const text = message.content
        ?.filter((c) => c.type === 'text' || c.type === 'markdown')
        .map((c) => (c as { data: string }).data)
        .join('\n') || '';
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          MessagePlugin.info('已复制消息内容，可粘贴分享');
        }).catch(() => {
          MessagePlugin.info('复制失败，请手动选择文本');
        });
      }
      return;
    }

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
    feedbackMessage(message.id, feedbackMap[newComment]).catch(() => {
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
            animation: 'circle' as const,
            maxHeight: 300,
          },
          reasoning: {
            collapsed: false,
            layout: 'border' as const,
            animation: 'circle' as const,
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
