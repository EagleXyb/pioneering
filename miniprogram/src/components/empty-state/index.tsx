import { View, Text } from '@tarojs/components';
import styles from './index.module.scss';

interface EmptyStateProps {
  text: string;
}

export default function EmptyState({ text }: EmptyStateProps) {
  return (
    <View className={styles.wrap}>
      <Text className={styles.text}>{text}</Text>
    </View>
  );
}
