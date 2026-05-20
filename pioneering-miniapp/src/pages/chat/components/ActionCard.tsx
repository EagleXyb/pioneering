import { View, Text } from '@tarojs/components';
import type { ActionData } from '../scripts/conversation';
import styles from './ActionCard.module.scss';

interface ActionCardProps {
  data: ActionData;
  onSelect?: (title: string) => void;
}

export default function ActionCard({ data, onSelect }: ActionCardProps) {
  return (
    <View className={styles.card}>
      <Text className={styles.label}>{data.label}</Text>
      {data.items.map((item, i) => (
        <View
          key={i}
          className={styles.item}
          onClick={() => onSelect?.(item.title)}
        >
          <Text className={styles.itemTitle}>{item.title}</Text>
          <Text className={styles.itemDesc}>{item.desc}</Text>
          <View className={styles.itemMeta}>
            <Text>风险 {item.risk}</Text>
            <Text>潜力 {item.potential}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
