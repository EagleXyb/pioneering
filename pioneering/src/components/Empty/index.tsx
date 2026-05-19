import { View, Image } from '@tarojs/components';
import type { CSSProperties } from 'react';
import './index.scss';

interface EmptyProps {
  icon?: string;
  text?: string;
  subText?: string;
  actionText?: string;
  onAction?: () => void;
  className?: string;
  style?: CSSProperties;
}

export default function Empty({
  icon,
  text = '暂无数据',
  subText,
  actionText,
  onAction,
  className = '',
  style,
}: EmptyProps) {
  return (
    <View className={`empty ${className}`} style={style}>
      <View className="empty-content">
        {icon && <Image className="empty-icon" src={icon} mode="aspectFit" />}
        <View className="empty-text">{text}</View>
        {subText && <View className="empty-subtext">{subText}</View>}
        {actionText && onAction && (
          <View className="empty-action" onClick={onAction}>
            {actionText}
          </View>
        )}
      </View>
    </View>
  );
}
