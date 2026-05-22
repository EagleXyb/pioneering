import { useState } from 'react';
import { View, Text } from '@tarojs/components';
import type { MessageStatus } from '@/types/chat';
import styles from './index.module.scss';

interface ChatMessageProps {
  content: string;
  thinkingContent?: string;
  isUser: boolean;
  status?: MessageStatus;
  error?: string;
  onRegenerate?: () => void;
}

export default function ChatMessage({
  content,
  thinkingContent,
  isUser,
  status = 'done',
  error,
  onRegenerate,
}: ChatMessageProps) {
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const showThinking = !!thinkingContent && !isUser;
  const isStreaming = status === 'streaming';
  const isError = status === 'error';
  const isStopped = status === 'stopped';

  // 用户消息
  if (isUser) {
    return (
      <t-chat-message role="user" content={{ type: 'text', data: content }}>
        <t-chat-content
          slot="content"
          content={{ type: 'text', data: content }}
          role="user"
        />
      </t-chat-message>
    );
  }

  // AI 消息
  return (
    <View className={styles.aiWrap}>
      {/* 思考过程 */}
      {showThinking && (
        <View className={styles.thinkingSection}>
          <View
            className={styles.thinkingHeader}
            onClick={() => setThinkingExpanded(!thinkingExpanded)}
          >
            <Text className={styles.thinkingLabel}>思考过程</Text>
            <Text className={styles.thinkingArrow}>
              {thinkingExpanded ? '▾' : '▸'}
            </Text>
          </View>
          {thinkingExpanded && (
            <View className={styles.thinkingContent}>
              <Text className={styles.thinkingText}>{thinkingContent}</Text>
            </View>
          )}
        </View>
      )}

      {/* 正文 */}
      <t-chat-message
        role="assistant"
        content={{ type: 'text', data: content || '...' }}
      >
        <t-chat-content
          slot="content"
          content={{ type: 'text', data: content || '...' }}
          role="assistant"
        />
      </t-chat-message>

      {/* 流式打字光标 */}
      {isStreaming && <View className={styles.typingCursor} />}

      {/* 已停止标记 */}
      {isStopped && (
        <View className={styles.statusTag}>
          <Text className={styles.statusText}>已停止生成</Text>
        </View>
      )}

      {/* 错误状态 */}
      {isError && (
        <View className={styles.errorWrap}>
          <Text className={styles.errorText}>
            {error || '生成失败，请重试'}
          </Text>
        </View>
      )}

      {/* 重新生成按钮（done/stopped/error 时显示） */}
      {status !== 'streaming' && status !== 'pending' && onRegenerate && (
        <View className={styles.regenerateBtn} onClick={onRegenerate}>
          <t-icon name="refresh" size="32rpx" />
          <Text className={styles.regenerateText}>重新生成</Text>
        </View>
      )}
    </View>
  );
}