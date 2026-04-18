import Taro from '@tarojs/taro';
import { useAppStore } from '@/store';

const API_BASE_URL = useAppStore.getState().apiBaseUrl;

interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  data?: any;
  header?: Record<string, string>;
}

function request<T = any>(options: RequestOptions): Promise<T> {
  const token = Taro.getStorageSync('token');
  return new Promise((resolve, reject) => {
    Taro.request({
      url: `${API_BASE_URL}${options.url}`,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.header,
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
        } else if (res.statusCode === 401) {
          Taro.removeStorageSync('token');
          Taro.removeStorageSync('userInfo');
          useAppStore.getState().logout();
          Taro.redirectTo({ url: '/pages/login/index' });
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

export function uploadFile(url: string, filePath: string, name: string = 'file') {
  return new Promise((resolve, reject) => {
    const token = Taro.getStorageSync('token');
    Taro.uploadFile({
      url: `${API_BASE_URL}${url}`,
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

export { API_BASE_URL };
