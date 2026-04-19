import { View, Text, Image } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useAppStore } from '@/store';
import './index.scss';

const TRAINING_FEATURES = [
  { id: 'assessment', title: '创新能力测评', desc: 'AI驱动的创新能力测评', icon: '📊', status: 'coming' },
  { id: 'basic-assessment', title: '创意评估', desc: '多维度创意价值评估体系', icon: '📋', status: 'coming' },
  { id: 'incubation', title: '创意孵化', desc: '从创意到落地的全流程孵化', icon: '🚀' },
  { id: 'experience', title: '创新体验', desc: '沉浸式创新工具集', icon: '✨', status: 'coming' },
];

const ROUTE_MAP: Record<string, string> = {
  assessment: '/pages/training/assessment/index',
  'basic-assessment': '/pages/training/basic-assessment/index',
  incubation: '/pages/training/incubation/index',
  experience: '/pages/training/experience/index',
};

export default function Training() {
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

  const onFeatureTap = (id: string, status?: string) => {
    if (status === 'coming') {
      Taro.showToast({ title: '功能开发中，敬请期待', icon: 'none' });
      return;
    }
    const url = ROUTE_MAP[id];
    if (url) {
      Taro.navigateTo({ url });
    }
  };

  const onProfileTap = () => {
    if (!isLoggedIn) {
      Taro.navigateTo({ url: '/pages/login/index' });
    } else {
      Taro.switchTab({ url: '/pages/profile/index' });
    }
  };

  return (
    <View className='page'>
      <View className='header'>
        <View className='greeting'>
          <Text className='greeting-text'>训练中心</Text>
          <Text className='app-name'>系统化创新能力提升</Text>
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
        {TRAINING_FEATURES.map((feature) => (
          <View
            key={feature.id}
            className={`feature-card ${feature.status === 'coming' ? 'disabled' : ''}`}
            onClick={() => onFeatureTap(feature.id, feature.status)}
          >
            <Text className='feature-icon'>{feature.icon}</Text>
            <View className='feature-info'>
              <View className='feature-title-row'>
                <Text className='feature-title'>{feature.title}</Text>
                {feature.status === 'coming' && (
                  <Text className='coming-tag'>待开发</Text>
                )}
              </View>
              <Text className='feature-desc'>{feature.desc}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}