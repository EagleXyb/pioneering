import { View } from '@tarojs/components';
import './index.scss';

interface ToastProps {
  visible: boolean;
  message: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
}

const TYPE_ICONS = {
  success: '✓',
  error: '✕',
  warning: '!',
  info: 'i',
};

const TYPE_COLORS = {
  success: '$color-success',
  error: '$color-error',
  warning: '$color-warning',
  info: '$color-info',
};

export default function Toast({
  visible,
  message,
  type = 'info',
}: ToastProps) {
  if (!visible) return null;

  return (
    <View className="toast-root">
      <View className={`toast-content toast-${type}`}>
        <View className={`toast-icon toast-icon-${type}`}>{TYPE_ICONS[type]}</View>
        <View className="toast-message">{message}</View>
      </View>
    </View>
  );
}
