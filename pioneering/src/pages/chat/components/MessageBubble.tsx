import { View, Text } from '@tarojs/components';
import { CHAT_ROLES, MESSAGE_STATUS } from '@/constants';
import './MessageBubble.scss';

interface Message {
  id: number;
  role: string;
  content: string;
  status?: string;
  timestamp?: number;
  thinking?: boolean;
}

interface MessageBubbleProps {
  message: Message;
  onRetry?: () => void;
}

export default function MessageBubble({ message, onRetry }: MessageBubbleProps) {
  const isUser = message.role === CHAT_ROLES.USER;
  const isSystem = message.role === CHAT_ROLES.SYSTEM;
  const isLoading = message.status === MESSAGE_STATUS.LOADING;
  const isError = message.status === MESSAGE_STATUS.ERROR;

  if (isSystem) {
    return (
      <View className="msg-wrapper">
        <View className="msg-bubble msg-bubble-system">{message.content}</View>
      </View>
    );
  }

  return (
    <View className={`msg-wrapper ${isUser ? 'msg-user' : ''}`}>
      <View className={`msg-avatar ${isUser ? 'msg-avatar-user' : 'msg-avatar-ai'}`}>
        {isUser ? '我' : 'AI'}
      </View>
      <View className={`msg-bubble ${isUser ? 'msg-bubble-user' : 'msg-bubble-ai'}`}>
        {message.thinking && <Text className="msg-think-tag">💭 深度思考中</Text>}
        {isLoading ? (
          <View>
            <View className="msg-typing-dot" />
            <View className="msg-typing-dot" />
            <View className="msg-typing-dot" />
          </View>
        ) : (
          <Text>{message.content}</Text>
        )}
      </View>
      {!isUser && (
        <View className={`msg-status msg-status-ai`}>
          {isLoading && <Text className="msg-status-loading">生成中...</Text>}
          {isError && (
            <Text className="msg-status-error" onClick={onRetry}>
              发送失败，点击重试
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
