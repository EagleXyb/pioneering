import { View, Text, RichText } from '@tarojs/components';
import { useCallback, useMemo } from 'react';
import type { Message } from '../constants';
import { markdownToHtml } from '../../../utils/markdown';
import './MessageBubble.scss';

interface MessageBubbleProps {
  message: Message;
  onRetry: (id: number) => void;
  onLongPress: (id: number) => void;
  isLongPressed: boolean;
  onCopy: (content: string) => void;
  onCloseLongPress: () => void;
}

export default function MessageBubble({
  message,
  onRetry,
  onLongPress,
  isLongPressed,
  onCopy,
  onCloseLongPress,
}: MessageBubbleProps) {
  const handleCopy = useCallback(() => {
    onCopy(message.content);
  }, [message.content, onCopy]);

  const aiHtml = useMemo(() => {
    if (message.type !== 'ai') return '';
    return markdownToHtml(message.content);
  }, [message.type, message.content]);

  if (message.type === 'system') {
    return (
      <View className='message-row system'>
        <View className='system-hint'>
          <Text className='system-text'>{message.content}</Text>
        </View>
      </View>
    );
  }

  return (
    <View className={`message-row ${message.type}`}>
      <View
        className={`message-bubble-wrap ${message.type}`}
        onLongPress={() => onLongPress(message.id)}
      >
        <View
          className={`message-bubble ${message.type} ${message.status === 'error' ? 'error' : ''}`}
        >
          {message.type === 'ai' ? (
            <RichText className='ai-reply' nodes={aiHtml} />
          ) : (
            <Text className='message-text' selectable>
              {message.content}
            </Text>
          )}
          {message.status === 'streaming' && <Text className='streaming-cursor'>▎</Text>}
          {message.status === 'loading' && (
            <View className='typing-dots'>
              <Text className='dot'></Text>
              <Text className='dot'></Text>
              <Text className='dot'></Text>
            </View>
          )}
        </View>

        {message.status === 'error' && (
          <View className='error-action' onClick={() => onRetry(message.id)}>
            <Text className='error-text'>发送失败，点击重试</Text>
          </View>
        )}

        {message.status === 'stopped' && (
          <View className='stopped-hint'>
            <Text className='stopped-text'>生成已停止</Text>
            <View className='retry-btn' onClick={() => onRetry(message.id)}>
              <Text className='retry-text'>重新生成</Text>
            </View>
          </View>
        )}
      </View>

      {isLongPressed && (
        <View className='longpress-menu' catchMove>
          <View className='longpress-menu-item' onClick={handleCopy}>
            <Text className='menu-icon'>📋</Text>
            <Text className='menu-label'>复制</Text>
          </View>
          <View className='longpress-divider'></View>
          <View className='longpress-menu-item' onClick={onCloseLongPress}>
            <Text className='menu-icon'>✕</Text>
            <Text className='menu-label'>取消</Text>
          </View>
        </View>
      )}
    </View>
  );
}
