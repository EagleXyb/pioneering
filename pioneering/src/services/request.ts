import Taro from '@tarojs/taro';
import { useAppStore } from '@/store';
import { STORAGE_KEYS } from '@/constants';

const baseUrl = useAppStore.getState().apiBaseUrl;

export interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  data?: any;
  header?: Record<string, string>;
}

export interface RequestResult<T = any> {
  success: boolean;
  data: T;
  message: string;
  code: number;
}

function request<T = any>(options: RequestOptions): Promise<T> {
  const token = Taro.getStorageSync(STORAGE_KEYS.TOKEN);
  return new Promise((resolve, reject) => {
    Taro.request({
      url: `${baseUrl}${options.url}`,
      method: options.method || 'GET',
      data: options.data,
      timeout: 30000,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.header,
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
        } else if (res.statusCode === 401) {
          Taro.removeStorageSync(STORAGE_KEYS.TOKEN);
          Taro.removeStorageSync(STORAGE_KEYS.USER_INFO);
          useAppStore.getState().logout();
          Taro.reLaunch({ url: '/pages/home/index' });
          reject(new Error('未授权，请重新登录'));
        } else {
          reject(new Error(`请求失败: ${res.statusCode}`));
        }
      },
      fail: (err) => {
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
  });
}

export function get<T = any>(url: string, data?: any) {
  return request<T>({ url, method: 'GET', data });
}

export function post<T = any>(url: string, data?: any) {
  return request<T>({ url, method: 'POST', data });
}

export function put<T = any>(url: string, data?: any) {
  return request<T>({ url, method: 'PUT', data });
}

export function del<T = any>(url: string) {
  return request<T>({ url, method: 'DELETE' });
}

export function patch<T = any>(url: string, data?: any) {
  return request<T>({ url, method: 'PATCH', data });
}

export function upload(url: string, filePath: string, name = 'file') {
  return new Promise((resolve, reject) => {
    const token = Taro.getStorageSync(STORAGE_KEYS.TOKEN);
    Taro.uploadFile({
      url: `${baseUrl}${url}`,
      filePath,
      name,
      header: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(res.data));
        } else {
          reject(new Error(`上传失败: ${res.statusCode}`));
        }
      },
      fail: (err) => {
        reject(new Error(err.errMsg || '上传失败'));
      },
    });
  });
}
