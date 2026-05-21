import { View, Text } from '@tarojs/components';
import styles from './index.module.scss';

interface ChatMessageProps {
  id: string;
  content: string;
  isUser: boolean;
}

export default function ChatMessage({ id, content, isUser }: ChatMessageProps) {
  return (
    <View id={`msg-${id}`} className={styles.wrap}>
      {isUser ? (
        <View className={styles.user}>
          <View className={styles.userBubble}>
            <Text className={styles.userText}>{content}</Text>
          </View>
        </View>
      ) : (
        <View className={styles.ai}>
          <View className={styles.aiBubble}>
            <Text className={styles.aiText}>{content}</Text>
          </View>
        </View>
      )}
    </View>
  );
}
