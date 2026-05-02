import { View, Text, Image, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useCallback } from 'react';
import { useAppStore } from '@/store';
import { uploadAvatar } from '@/services';
import UserAvatar from '@/components/UserAvatar';
import './index.scss';

interface MenuItem {
  id: string;
  title: string;
  icon: string;
}

const menuList1: MenuItem[] = [
  { id: 'courses', title: '我的课程', icon: require('@/assets/wode/MyCourses.png') },
  { id: 'history', title: '会话历史', icon: require('@/assets/wode/History.png') },
  { id: 'favorites', title: '我的收藏', icon: require('@/assets/wode/Favorite.png') },
  { id: 'memory', title: '记忆库', icon: require('@/assets/wode/Memory.png') },
];

const menuList2: MenuItem[] = [
  { id: 'help', title: '帮助中心', icon: require('@/assets/wode/Help.png') },
  { id: 'settings', title: '设置', icon: require('@/assets/wode/Settings.png') },
];

export default function Profile() {
  const { userInfo } = useAppStore();

  const onChooseAvatar = useCallback(() => {
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
            Taro.showToast({ title: '更新成功', icon: 'success' });
          } catch {
            Taro.showToast({ title: '上传失败', icon: 'none' });
          }
        }
      },
    });
  }, [userInfo]);

  const handleMenuClick = useCallback((id: string) => {
    console.log('点击菜单:', id);
  }, []);

  const handleLogout = useCallback(() => {
    Taro.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          useAppStore.getState().logout();
          Taro.reLaunch({ url: '/pages/login/index' });
        }
      },
    });
  }, []);

  return (
    <ScrollView className='page' scrollY>
      {/* 用户信息卡片 */}
      <View className='user-card' onClick={onChooseAvatar} hoverClass='user-card--hover'>
        <UserAvatar avatar={userInfo?.avatar} name={userInfo?.name} size={120} />
        <View className='user-info'>
          <Text className='user-name'>{userInfo?.name || 'Eagle'}</Text>
          <Text className='user-bio'>这个人有点懒，什么都没写~</Text>
        </View>
        <View className='arrow-icon' />
      </View>

      {/* 功能菜单组 1 */}
      <View className='menu-group'>
        {menuList1.map((item) => (
          <View
            key={item.id}
            className='menu-item'
            onClick={() => handleMenuClick(item.id)}
            hoverClass='menu-item--hover'
          >
            <Image className='menu-icon' src={item.icon} mode='aspectFit' />
            <Text className='menu-title'>{item.title}</Text>
            <View className='menu-arrow' />
          </View>
        ))}
      </View>

      {/* 功能菜单组 2 */}
      <View className='menu-group'>
        {menuList2.map((item) => (
          <View
            key={item.id}
            className='menu-item'
            onClick={() => handleMenuClick(item.id)}
            hoverClass='menu-item--hover'
          >
            <Image className='menu-icon' src={item.icon} mode='aspectFit' />
            <Text className='menu-title'>{item.title}</Text>
            <View className='menu-arrow' />
          </View>
        ))}
      </View>

      {/* 退出登录 */}
      <View className='logout-wrap'>
        <View className='logout-btn' onClick={handleLogout} hoverClass='logout-btn--hover'>
          <Text className='logout-text'>退出登录</Text>
        </View>
      </View>
    </ScrollView>
  );
}
