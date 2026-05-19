import { View } from '@tarojs/components';
import type { CSSProperties } from 'react';
import './index.scss';

interface LoadingProps {
  text?: string;
  fullscreen?: boolean;
  className?: string;
  style?: CSSProperties;
}

export default function Loading({
  text = '加载中...',
  fullscreen = false,
  className = '',
  style,
}: LoadingProps) {
  const cls = `loading${fullscreen ? ' loading-fullscreen' : ''} ${className}`;

  return (
    <View className={cls} style={style}>
      <View className="loading-spinner">
        <View className="loading-dot" />
        <View className="loading-dot" />
        <View className="loading-dot" />
      </View>
      {text && <View className="loading-text">{text}</View>}
    </View>
  );
}
