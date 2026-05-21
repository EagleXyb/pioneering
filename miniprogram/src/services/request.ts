import Taro from '@tarojs/taro';
import { getMockHandler } from './mock';

// ====== Mock 模式开关 ======
const USE_MOCK = true;

// ====== 类型定义 ======
export interface RequestConfig {
  baseURL: string;
  timeout: number;
  header?: Record<string, string>;
}

export interface ApiResponse<T = unknown> {
  code: number;
  data: T;
  message: string;
}

// ====== 默认配置 ======
const DEFAULT_CONFIG: RequestConfig = {
  baseURL: '',
  timeout: 15000,
  header: {
    'Content-Type': 'application/json',
  },
};

// ====== 请求类 ======
class Request {
  private config: RequestConfig;

  constructor(config?: Partial<RequestConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setConfig(config: Partial<RequestConfig>) {
    this.config = { ...this.config, ...config };
  }

  private getToken(): string {
    return Taro.getStorageSync('token') || '';
  }

  private buildOptions(options: Taro.request.Option): Taro.request.Option {
    const token = this.getToken();
    const header: Record<string, string> = {
      ...this.config.header,
      ...options.header,
    };
    if (token) {
      header.Authorization = `Bearer ${token}`;
    }

    return {
      ...this.config,
      ...options,
      url: this.config.baseURL + options.url,
      header,
    };
  }

  async request<T = unknown>(options: Taro.request.Option): Promise<T> {
    // Mock 模式
    if (USE_MOCK) {
      const mockHandler = getMockHandler(options.url || '');
      if (mockHandler) {
        const mockData = (options.data as Record<string, unknown>) || {};
        const response = await mockHandler(mockData);
        if (response.code !== 0 && response.code !== 200) {
          throw new Error(response.message || '请求失败');
        }
        return response.data as T;
      }
    }

    const finalOptions = this.buildOptions(options);

    try {
      const response = await Taro.request(finalOptions);
      const data = response.data as ApiResponse;
      if (data.code !== 0 && data.code !== 200) {
        throw new Error(data.message || '请求失败');
      }
      return data.data as T;
    } catch (error) {
      this.handleError(error as { statusCode?: number });
      throw error;
    }
  }

  private handleError(error: { statusCode?: number }) {
    const statusMessages: Record<number, string> = {
      400: '请求参数错误',
      401: '登录已过期',
      403: '没有访问权限',
      404: '请求资源不存在',
      500: '服务器内部错误',
    };
    const statusCode = error.statusCode || 0;
    const message = statusMessages[statusCode] || '网络异常，请稍后重试';
    Taro.showToast({ title: message, icon: 'none', duration: 2000 });
  }

  get<T = unknown>(url: string, data?: Record<string, unknown>) {
    return this.request<T>({ url, data, method: 'GET' });
  }

  post<T = unknown>(url: string, data?: Record<string, unknown>) {
    return this.request<T>({ url, data, method: 'POST' });
  }
}

const request = new Request();
export default request;
