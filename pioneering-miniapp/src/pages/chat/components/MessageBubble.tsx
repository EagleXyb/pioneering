import { View, Text } from '@tarojs/components';
import type { ChatMessage } from '../hooks/useChatSession';
import styles from './MessageBubble.module.scss';

interface MessageBubbleProps {
  message: ChatMessage;
  onAcceptInsight?: (msgId: string) => void;
  onReviseInsight?: (msgId: string) => void;
  onSelectAction?: (title: string) => void;
}

export default function MessageBubble({
  message,
  onAcceptInsight,
  onReviseInsight,
  onSelectAction,
}: MessageBubbleProps) {
  const { id, content, isUser, type, insightData, actionData, timestamp } = message;

  const timeStr = new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // 洞察卡片
  if (type === 'insight' && insightData) {
    const resolved = insightData.accepted || insightData.revised;
    return (
      <View className={styles['insight-card-inline']}>
        <Text className={styles['insight-label']}>{insightData.label}</Text>
        <Text className={styles['insight-title']}>{insightData.title}</Text>
        <Text className={styles['insight-body']}>{insightData.body}</Text>
        <View className={styles['insight-evidence']}>
          {insightData.evidence.map((e, i) => (
            <View key={i} className={styles['insight-evidence-item']}>
              <Text>▸ {e}</Text>
            </View>
          ))}
        </View>
        {!resolved && (
          <View className={styles['insight-actions']}>
            <t-button
              theme='primary'
              size='medium'
              onClick={() => onAcceptInsight?.(id)}
            >
              ✓ 这就是我！
            </t-button>
            <t-button
              theme='default'
              variant='outline'
              size='medium'
              style='color: white; border-color: rgba(255,255,255,0.4);'
              onClick={() => onReviseInsight?.(id)}
            >
              ✎ 部分对，再说说
            </t-button>
          </View>
        )}
        {resolved && (
          <View className={styles['insight-resolved']}>
            <Text>✓ 已保存到洞察本</Text>
          </View>
        )}
      </View>
    );
  }

  // 行动卡片
  if (type === 'action' && actionData) {
    return (
      <View className={styles['action-card-inline']}>
        <Text className={styles['action-label']}>{actionData.label}</Text>
        {actionData.items.map((item, i) => (
          <View
            key={i}
            className={styles['action-item']}
            onClick={() => onSelectAction?.(item.title)}
          >
            <Text className={styles['action-item-title']}>{item.title}</Text>
            <Text className={styles['action-item-desc']}>{item.desc}</Text>
            <View className={styles['action-item-meta']}>
              <Text>风险 {item.risk}</Text>
              <Text>潜力 {item.potential}</Text>
            </View>
          </View>
        ))}
      </View>
    );
  }

  // 普通消息
  return (
    <View className={`${styles.msg} ${isUser ? styles['msg-user'] : styles['msg-agent']}`}>
      <View className={styles['msg-bubble']}>
        <Text>{content}</Text>
      </View>
      <Text className={styles['msg-meta']}>{timeStr}</Text>
    </View>
  );
}

// 打字指示器组件
export function TypingIndicator() {
  return (
    <View className={styles['typing-indicator']}>
      <View className={styles['typing-dot']} />
      <View className={styles['typing-dot']} />
      <View className={styles['typing-dot']} />
    </View>
  );
}
