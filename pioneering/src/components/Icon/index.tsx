import { Image } from '@tarojs/components';
import type { CSSProperties } from 'react';
import './index.scss';

interface IconProps {
  name: string;
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}

export default function Icon({
  name,
  size = 40,
  className = '',
  style,
  onClick,
}: IconProps) {
  const cls = `icon ${className}`;
  const iconStyle: CSSProperties = {
    width: `${size}rpx`,
    height: `${size}rpx`,
    ...style,
  };

  return (
    <Image
      className={cls}
      src={name}
      style={iconStyle}
      mode="aspectFit"
      onClick={onClick}
    />
  );
}
