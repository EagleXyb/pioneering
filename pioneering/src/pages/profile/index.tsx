import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useCallback } from 'react';
import { useAppStore } from '@/store';
import './index.scss';

const MENU_GROUPS = [
  {
    title: '创作',
    items: [
      { icon: '💬', label: '我的会话', value: '12', key: 'sessions' },
      { icon: '⭐', label: '收藏案例', value: '8', key: 'favorites' },
      { icon: '📝', label: '草稿箱', value: '3', key: 'drafts' },
    ],
  },
  {
    title: '设置',
    items: [
      { icon: '🔔', label: '消息通知', value: '', key: 'notifications' },
      { icon: '🎨', label: '主题设置', value: '浅色', key: 'theme' },
      { icon: '📊', label: '数据用量', value: '125MB', key: 'usage' },
      { icon: '❓', label: '帮助与反馈', value: '', key: 'help' },
      { icon: 'ℹ️', label: '关于创路', value: 'v1.0.0', key: 'about' },
    ],
  },
];

export default function Profile() {
  const userInfo = useAppStore((s) => s.userInfo);
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const logout = useAppStore((s) => s.logout);

  const handleLogin = useCallback(() => {
    Taro.navigateTo({ url: '/pages/home/index' });
  }, []);

  const handleLogout = useCallback(() => {
    Taro.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) logout();
      },
    });
  }, [logout]);

  const handleMenuTap = useCallback((key: string) => {
    // menu navigation logic
  }, []);

  return (
    <ScrollView className="profile-page" scrollY enableBackToTop>
      <View className="profile-header">
        <View className="profile-avatar">
          {isLoggedIn && userInfo?.avatar ? (
            <Text style={{ position: 'absolute' }}>👤</Text>
          ) : (
            <Text>👤</Text>
          )}
        </View>
        <View className="profile-info">
          {isLoggedIn ? (
            <>
              <View className="profile-name">{userInfo?.name || '创路用户'}</View>
              <View className="profile-email">{userInfo?.email || ''}</View>
            </>
          ) : (
            <>
              <View className="profile-name" onClick={handleLogin}>登录 / 注册</View>
              <View className="profile-email">登录解锁更多功能</View>
            </>
          )}
        </View>
      </View>

      <View className="profile-stats">
        <View className="profile-stat-item">
          <Text className="profile-stat-value">47</Text>
          <Text className="profile-stat-label">会话数</Text>
        </View>
        <View className="profile-stat-divider" />
        <View className="profile-stat-item">
          <Text className="profile-stat-value">12</Text>
          <Text className="profile-stat-label">收藏</Text>
        </View>
        <View className="profile-stat-divider" />
        <View className="profile-stat-item">
          <Text className="profile-stat-value">128</Text>
          <Text className="profile-stat-label">生成次数</Text>
        </View>
      </View>

      {MENU_GROUPS.map((group) => (
        <View className="profile-section" key={group.title}>
          <View className="profile-section-title">{group.title}</View>
          <View className="profile-menu-group">
            {group.items.map((item) => (
              <View
                className="profile-menu-item"
                key={item.key}
                onClick={() => handleMenuTap(item.key)}
              >
                <Text className="profile-menu-icon">{item.icon}</Text>
                <Text className="profile-menu-label">{item.label}</Text>
                {item.value && <Text className="profile-menu-value">{item.value}</Text>}
                <Text className="profile-menu-arrow">›</Text>
              </View>
            ))}
          </View>
        </View>
      ))}

      {isLoggedIn && (
        <View className="profile-logout" onClick={handleLogout}>
          退出登录
        </View>
      )}

      <View style={{ height: '40rpx' }} />
    </ScrollView>
  );
}
