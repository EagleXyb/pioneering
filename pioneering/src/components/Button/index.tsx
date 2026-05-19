import { View } from '@tarojs/components';
import type { CSSProperties, ReactNode } from 'react';
import './index.scss';

interface ButtonProps {
  type?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  children?: ReactNode;
}

export default function Button({
  type = 'primary',
  size = 'md',
  block = false,
  disabled = false,
  loading = false,
  className = '',
  style,
  onClick,
  children,
}: ButtonProps) {
  const cls = `btn btn-${type} btn-${size}${block ? ' btn-block' : ''}${
    disabled || loading ? ' btn-disabled' : ''
  }${loading ? ' btn-loading' : ''} ${className}`;

  return (
    <View
      className={cls}
      style={style}
      onClick={disabled || loading ? undefined : onClick}
    >
      {loading ? <View className="btn-loading-dot" /> : null}
      {children}
    </View>
  );
}
