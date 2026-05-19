import { View } from '@tarojs/components';
import type { CSSProperties, ReactNode } from 'react';
import './index.scss';

interface CardProps {
  title?: string;
  subtitle?: string;
  extra?: ReactNode;
  cover?: string;
  bordered?: boolean;
  shadow?: 'none' | 'sm' | 'md' | 'lg';
  padding?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  children?: ReactNode;
  footer?: ReactNode;
}

export default function Card({
  title,
  subtitle,
  extra,
  cover,
  bordered = false,
  shadow = 'sm',
  padding = true,
  className = '',
  style,
  onClick,
  children,
  footer,
}: CardProps) {
  const cls = `card card-shadow-${shadow}${
    bordered ? ' card-bordered' : ''
  }${padding ? '' : ' card-no-padding'}${onClick ? ' card-clickable' : ''} ${className}`;

  return (
    <View className={cls} style={style} onClick={onClick}>
      {cover && (
        <View className="card-cover">
          <View
            className="card-cover-img"
            style={{ backgroundImage: `url(${cover})` }}
          />
        </View>
      )}
      {(title || subtitle || extra) && (
        <View className="card-header">
          <View className="card-header-left">
            {title && <View className="card-title">{title}</View>}
            {subtitle && <View className="card-subtitle">{subtitle}</View>}
          </View>
          {extra && <View className="card-extra">{extra}</View>}
        </View>
      )}
      {children && <View className="card-body">{children}</View>}
      {footer && <View className="card-footer">{footer}</View>}
    </View>
  );
}
