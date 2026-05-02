import { View, Text, Image } from '@tarojs/components';
import './index.scss';

interface UserAvatarProps {
  avatar?: string;
  name?: string;
  size?: number;
  onClick?: () => void;
}

export default function UserAvatar({ avatar, name, size = 120, onClick }: UserAvatarProps) {
  const sizeStyle = { width: `${size}rpx`, height: `${size}rpx` };

  const content = avatar ? (
    <Image className='ua-image' src={avatar} mode='aspectFill' style={sizeStyle} />
  ) : (
    <View className='ua-placeholder' style={sizeStyle}>
      <Text className='ua-text'>{name?.charAt(0) || 'U'}</Text>
    </View>
  );

  if (onClick) {
    return (
      <View className='ua-wrapper' style={sizeStyle} onClick={onClick} hoverClass='ua-wrapper--hover'>
        {content}
      </View>
    );
  }

  return <View className='ua-wrapper' style={sizeStyle}>{content}</View>;
}
