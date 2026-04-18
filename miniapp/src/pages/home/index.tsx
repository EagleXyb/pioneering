import { View, Text, Image } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useAppStore } from '@/store';
import './index.scss';

const FEATURES = [
  { id: 'assessment', title: '创新评估', desc: 'AI驱动的创新能力测评', icon: '📊' },
  { id: 'training', title: '创新训练', desc: '系统化的创新能力提升', icon: '🎯' },
  { id: 'incubation', title: '创意孵化', desc: '从创意到落地的全流程', icon: '🚀' },
  { id: 'experience', title: '创新体验', desc: '沉浸式创新工具集', icon: '✨' },
];

const ROUTE_MAP: Record<string, { type: 'navigateTo' | 'switchTab'; url: string }> = {
  assessment: { type: 'navigateTo', url: '/pages/assessment/index' },
  training: { type: 'switchTab', url: '/pages/training/index' },
  incubation: { type: 'navigateTo', url: '/pages/incubation/index' },
  experience: { type: 'navigateTo', url: '/pages/experience/index' },
};

export default function Home() {
  const { isLoggedIn, userInfo } = useAppStore();

  useDidShow(() => {
    const token = Taro.getStorageSync('token');
    const store = useAppStore.getState();
    if (token && !store.isLoggedIn) {
      store.setLoggedIn(true);
      const userInfoStr = Taro.getStorageSync('userInfo');
      if (userInfoStr) {
        try {
          store.setUserInfo(JSON.parse(userInfoStr));
        } catch {
          // ignore
        }
      }
    }
  });

  const onFeatureTap = (id: string) => {
    const route = ROUTE_MAP[id];
    if (route) {
      if (route.type === 'switchTab') {
        Taro.switchTab({ url: route.url });
      } else {
        Taro.navigateTo({ url: route.url });
      }
    }
  };

  const onProfileTap = () => {
    Taro.switchTab({ url: '/pages/profile/index' });
  };

  return (
    <View className='page'>
      <View className='header'>
        <View className='greeting'>
          <Text className='greeting-text'>欢迎使用</Text>
          <Text className='app-name'>IAC 创新孵化平台</Text>
        </View>
        <View className='avatar-wrap' onClick={onProfileTap}>
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
      </View>

      <View className='features'>
        {FEATURES.map((feature) => (
          <View
            key={feature.id}
            className='feature-card'
            onClick={() => onFeatureTap(feature.id)}
          >
            <Text className='feature-icon'>{feature.icon}</Text>
            <View className='feature-info'>
              <Text className='feature-title'>{feature.title}</Text>
              <Text className='feature-desc'>{feature.desc}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
