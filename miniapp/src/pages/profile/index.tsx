import { View, Text, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '@/store';
import { uploadAvatar } from '@/services';
import './index.scss';

const menuList1 = [
  { id: 'courses', title: '我的课程', icon: require('@/assets/wode/MyCourses.png') },
  { id: 'history', title: '会话历史', icon: require('@/assets/wode/History.png') },
  { id: 'favorites', title: '我的收藏', icon: require('@/assets/wode/Favorite.png') },
  { id: 'memory', title: '记忆库', icon: require('@/assets/wode/Memory.png') },
];

const menuList2 = [
  { id: 'help', title: '帮助中心', icon: require('@/assets/wode/Help.png') },
  { id: 'settings', title: '设置', icon: require('@/assets/wode/Settings.png') },
];

const quickActions = [
  { id: 1, icon: '📚' },
  { id: 2, icon: '💬' },
  { id: 3, icon: '⭐' },
  { id: 4, icon: '🧠' },
];

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

  const handleMenuClick = (id: string) => {
    console.log('点击菜单:', id);
  };

  const handleLogout = () => {
    Taro.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          useAppStore.setState({ userInfo: null });
          Taro.reLaunch({ url: '/pages/login/index' });
        }
      },
    });
  };

  return (
    <View className='page'>
      <View className='user-card' onClick={onChooseAvatar}>
        <View className='avatar-wrap'>
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
        <View className='user-info'>
          <Text className='user-name'>{userInfo?.name || 'Eagle'}</Text>
          <Text className='user-bio'>这个人有点懒，什么都没写~</Text>
        </View>
        <Text className='arrow'>{'>'}</Text>
      </View>

      <View className='quick-actions'>
        {quickActions.map((item) => (
          <View key={item.id} className='quick-item'>
            <View className='quick-icon'>
              <Text className='quick-icon-text'>{item.icon}</Text>
            </View>
          </View>
        ))}
      </View>

      <View className='menu-list'>
        {menuList1.map((item) => (
          <View
            key={item.id}
            className='menu-item'
            onClick={() => handleMenuClick(item.id)}
          >
            <View className='menu-left'>
              <Image className='menu-icon' src={item.icon} mode='aspectFit' />
              <Text className='menu-title'>{item.title}</Text>
            </View>
            <Text className='menu-arrow'>{'>'}</Text>
          </View>
        ))}
      </View>

      <View className='menu-list'>
        {menuList2.map((item) => (
          <View
            key={item.id}
            className='menu-item'
            onClick={() => handleMenuClick(item.id)}
          >
            <View className='menu-left'>
              <Image className='menu-icon' src={item.icon} mode='aspectFit' />
              <Text className='menu-title'>{item.title}</Text>
            </View>
            <Text className='menu-arrow'>{'>'}</Text>
          </View>
        ))}
      </View>

      <View className='logout-wrap'>
        <View className='logout-btn' onClick={handleLogout}>
          <Text className='logout-text'>退出登录</Text>
        </View>
      </View>
    </View>
  );
}
