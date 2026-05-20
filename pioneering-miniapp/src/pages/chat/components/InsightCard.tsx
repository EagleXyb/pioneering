import { View, Text } from '@tarojs/components';
import type { InsightData } from '../scripts/conversation';
import styles from './InsightCard.module.scss';

interface InsightCardProps {
  data: InsightData;
  onAccept?: (msgId: string) => void;
  onRevise?: (msgId: string) => void;
  msgId: string;
}

export default function InsightCard({ data, onAccept, onRevise, msgId }: InsightCardProps) {
  const resolved = data.accepted || data.revised;

  return (
    <View className={styles.card}>
      <Text className={styles.label}>{data.label}</Text>
      <Text className={styles.title}>{data.title}</Text>
      <Text className={styles.body}>{data.body}</Text>
      <View className={styles.evidence}>
        {data.evidence.map((e, i) => (
          <View key={i} className={styles.evidenceItem}>
            <Text>▸ {e}</Text>
          </View>
        ))}
      </View>
      {!resolved && (
        <View className={styles.actions}>
          <t-button
            theme="primary"
            size="medium"
            onClick={() => onAccept?.(msgId)}
          >
            ✓ 这就是我！
          </t-button>
          <t-button
            theme="default"
            variant="outline"
            size="medium"
            style="color: white; border-color: rgba(255,255,255,0.4);"
            onClick={() => onRevise?.(msgId)}
          >
            ✎ 部分对，再说说
          </t-button>
        </View>
      )}
      {resolved && (
        <View className={styles.resolved}>
          <Text>✓ 已保存到洞察本</Text>
        </View>
      )}
    </View>
  );
}
