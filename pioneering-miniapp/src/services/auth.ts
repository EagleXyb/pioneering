import Taro from '@tarojs/taro';
import { userApi } from '@/services';
import { useAppStore } from '@/store';

const TOKEN_KEY = 'token';
const OPENID_KEY = 'openid';

/** 静默登录：wx.login → 后端换 token */
export async function silentLogin(): Promise<boolean> {
  try {
    const { code } = await Taro.login();
    const res = await userApi.login(code);

    Taro.setStorageSync(TOKEN_KEY, res.token);
    Taro.setStorageSync(OPENID_KEY, res.openid);

    const store = useAppStore.getState();
    store.setAuth(res.token, res.openid);

    return true;
  } catch {
    return false;
  }
}

/** 检查登录态，未登录则自动静默登录 */
export async function ensureLogin(): Promise<boolean> {
  const store = useAppStore.getState();

  // 优先从 store 判断
  if (store.isLoggedIn && store.token) {
    return true;
  }

  // 尝试从 Storage 恢复
  const cachedToken = Taro.getStorageSync(TOKEN_KEY);
  const cachedOpenid = Taro.getStorageSync(OPENID_KEY);
  if (cachedToken && cachedOpenid) {
    store.setAuth(cachedToken, cachedOpenid);
    return true;
  }

  // 执行静默登录
  return silentLogin();
}

/** 退出登录 */
export async function logout(): Promise<void> {
  Taro.removeStorageSync(TOKEN_KEY);
  Taro.removeStorageSync(OPENID_KEY);

  const store = useAppStore.getState();
  store.clearAuth();

  await Taro.reLaunch({ url: '/pages/home/index' });
}

/** 需要登录的页面路由守卫 */
export async function requireAuth(): Promise<boolean> {
  const loggedIn = await ensureLogin();
  if (!loggedIn) {
    Taro.showToast({ title: '登录失败，请重试', icon: 'none' });
  }
  return loggedIn;
}
