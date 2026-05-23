import { useMemo } from 'react';
import Taro from '@tarojs/taro';
import { View, Image } from '@tarojs/components';
import { NavIcons } from '@/utils/icons';
import styles from './ChatNavBar.module.scss';

interface ChatNavBarProps {
  onOpenDrawer: () => void;
  onNewChat: () => void;
}

export default function ChatNavBar({ onOpenDrawer, onNewChat }: ChatNavBarProps) {
  const navbarStyle = useMemo(() => {
    try {
      const sys = Taro.getSystemInfoSync();
      const menu = Taro.getMenuButtonBoundingClientRect();
      const statusBarHeight = sys.statusBarHeight || 44;
      const contentHeight = 2 * (menu.top - statusBarHeight) + menu.height;
      return {
        paddingTop: `${statusBarHeight}px`,
        height: `${contentHeight}px`,
      };
    } catch {
      return { paddingTop: '44px', height: '48px' };
    }
  }, []);

  return (
    <View className={styles.navActions} style={navbarStyle}>
      <View className={styles.navBtn} onClick={onOpenDrawer}>
        <Image className={styles.navIcon} src={NavIcons.viewList()} />
      </View>
      <View className={styles.navBtn} onClick={onNewChat}>
        <Image className={styles.navIcon} src={NavIcons.add()} />
      </View>
    </View>
  );
}
