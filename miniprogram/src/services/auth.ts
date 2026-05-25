import Taro from '@tarojs/taro';
import request from './request';

const TOKEN_KEY = 'token';
const REFRESH_TOKEN_KEY = 'refresh_token';

export interface LoginResponse {
  token: string;
  refreshToken: string;
}

class AuthService {
  private _token: string | null = null;
  private _refreshToken: string | null = null;

  constructor() {
    this._token = Taro.getStorageSync(TOKEN_KEY) || null;
    this._refreshToken = Taro.getStorageSync(REFRESH_TOKEN_KEY) || null;
  }

  get token(): string {
    return this._token || '';
  }

  get isLoggedIn(): boolean {
    return !!this._token;
  }

  /** 微信小程序登录 */
  async login(): Promise<LoginResponse> {
    // 1. 获取微信 code
    const wxLoginResult = await Taro.login();
    if (!wxLoginResult.code) {
      throw new Error('获取微信授权码失败');
    }

    // 2. 发送 code 到后端换取 token
    const data = await request.post<LoginResponse>('/auth/wechat/miniprogram', {
      code: wxLoginResult.code,
    });

    this._token = data.token;
    this._refreshToken = data.refreshToken;

    // 3. 持久化存储
    Taro.setStorageSync(TOKEN_KEY, data.token);
    Taro.setStorageSync(REFRESH_TOKEN_KEY, data.refreshToken);

    return data;
  }

  /** 刷新 token */
  async refreshToken(): Promise<string> {
    if (!this._refreshToken) {
      throw new Error('无 refreshToken，请重新登录');
    }

    const data = await request.post<{ token: string; refreshToken: string }>(
      '/auth/refresh',
      { refreshToken: this._refreshToken },
    );

    this._token = data.token;
    this._refreshToken = data.refreshToken;
    Taro.setStorageSync(TOKEN_KEY, data.token);
    Taro.setStorageSync(REFRESH_TOKEN_KEY, data.refreshToken);

    return data.token;
  }

  /** 退出登录 */
  logout() {
    this._token = null;
    this._refreshToken = null;
    Taro.removeStorageSync(TOKEN_KEY);
    Taro.removeStorageSync(REFRESH_TOKEN_KEY);
  }
}

export const authService = new AuthService();