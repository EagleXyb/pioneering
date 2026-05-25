import { Component } from 'react';
import Taro from '@tarojs/taro';
import { View, Text } from '@tarojs/components';
import { authService } from '@/services/auth';
import styles from './login.module.scss';

export default class LoginPage extends Component {
  state = {
    loading: true,
    error: '',
  };

  componentDidMount() {
    this.doLogin();
  }

  async doLogin() {
    // 已登录则直接跳转
    if (authService.isLoggedIn) {
      Taro.redirectTo({ url: '/pages/chat/chat' });
      return;
    }

    try {
      await authService.login();
      Taro.redirectTo({ url: '/pages/chat/chat' });
    } catch (err: any) {
      this.setState({ loading: false, error: err.message || '登录失败，请重试' });
    }
  }

  handleRetry = () => {
    this.setState({ loading: true, error: '' });
    this.doLogin();
  };

  render() {
    const { loading, error } = this.state;

    return (
      <View className={styles.container}>
        {loading ? (
          <View className={styles.content}>
            <Text className={styles.title}>创路 Agent</Text>
            <Text className={styles.subtitle}>正在登录...</Text>
          </View>
        ) : (
          <View className={styles.content}>
            <Text className={styles.title}>创路 Agent</Text>
            <Text className={styles.error}>{error}</Text>
            <View className={styles.retryBtn} onClick={this.handleRetry}>
              <Text>重新登录</Text>
            </View>
          </View>
        )}
      </View>
    );
  }
}