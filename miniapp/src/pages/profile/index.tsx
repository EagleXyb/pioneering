import { View, Text, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '@/store';
import { uploadAvatar } from '@/services';
import './index.scss';

export default function Profile() {
  const { userInfo } = useAppStore();

  const onChooseAvatar = () => {
    Taro.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: async (res) => {
        const filePath = res.tempFiles[0].tempFilePath;
        const email = userInfo?.email;
        if (email) {
          try {
            const result = await uploadAvatar(email, filePath);
            useAppStore.setState({ userInfo: { ...userInfo, avatar: (result as any).avatar } });
          } catch {
            Taro.showToast({ title: '上传失败', icon: 'none' });
          }
        }
      },
    });
  };

  return (
    <View className='page'>
      <View className='profile-header'>
        <View className='avatar-wrap' onClick={onChooseAvatar}>
          {userInfo?.avatar ? (
            <Image
              className='avatar'
              src={userInfo.avatar}
              mode='aspectFill'
            />
          ) : (
            <View className='avatar-placeholder'>
              <Text className='avatar-text'>{userInfo?.name?.charAt(0) || 'U'}</Text>
            </View>
          )}
        </View>
        <Text className='user-name'>{userInfo?.name || '未登录'}</Text>
        <Text className='user-email'>{userInfo?.email || ''}</Text>
      </View>

      <View className='profile-section'>
        <View className='section-item'>
          <Text className='item-label'>公司</Text>
          <Text className='item-value'>{userInfo?.company || '未设置'}</Text>
        </View>
        <View className='section-item'>
          <Text className='item-label'>职位</Text>
          <Text className='item-value'>{userInfo?.position || '未设置'}</Text>
        </View>
        <View className='section-item'>
          <Text className='item-label'>地区</Text>
          <Text className='item-value'>{userInfo?.location || '未设置'}</Text>
        </View>
      </View>
    </View>
  );
}
