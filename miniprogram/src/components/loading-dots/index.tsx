import { View } from '@tarojs/components';
import styles from './index.module.scss';

export default function LoadingDots() {
  return (
    <View id="msg-loading" className={styles.wrap}>
      <View className={styles.ai}>
        <View className={styles.bubble}>
          <View className={styles.dots}>
            <View className={styles.dot} />
            <View className={styles.dot} />
            <View className={styles.dot} />
          </View>
        </View>
      </View>
    </View>
  );
}
