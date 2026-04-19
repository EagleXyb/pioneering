import { View, Text, Input, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '@/store';
import './index.scss';

export default function Login() {
  const { setLoggedIn, setUserInfo } = useAppStore();

  const onWxLogin = () => {
    Taro.getUserProfile({
      desc: '用于完善用户资料',
      success: (res) => {
        const { nickName, avatarUrl } = res.userInfo;
        setLoggedIn(true);
        setUserInfo({ name: nickName, avatar: avatarUrl });
        Taro.setStorageSync('userInfo', JSON.stringify({ name: nickName, avatar: avatarUrl }));
        Taro.switchTab({ url: '/pages/iac/index' });
      },
      fail: () => {
        Taro.showToast({ title: '登录取消', icon: 'none' });
      },
    });
  };

  return (
    <View className='page'>
      <View className='login-card'>
        <Text className='title'>IAC 创新孵化</Text>
        <Text className='subtitle'>AI驱动的创新实践平台</Text>

        <View className='form'>
          <Input className='input' placeholder='请输入邮箱' type='text' />
          <Input className='input' placeholder='请输入姓名' type='text' />
        </View>

        <Button className='wx-login-btn' onClick={onWxLogin}>
          微信一键登录
        </Button>
      </View>
    </View>
  );
}
