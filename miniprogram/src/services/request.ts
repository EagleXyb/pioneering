import Taro from '@tarojs/taro';
import { withRetry } from '@/utils/retry';
import { getMockHandler } from './mock';

// ====== Mock 模式开关 ======
const USE_MOCK = false;

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

declare const __API_BASE_URL__: string | undefined;
const API_BASE_URL = typeof __API_BASE_URL__ !== 'undefined' ? __API_BASE_URL__ : 'http://localhost:3000';

// ====== 默认配置 ======
const DEFAULT_CONFIG: RequestConfig = {
  baseURL: API_BASE_URL,
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

    // 指数退避重试
    return withRetry(
      async () => {
        const response = await Taro.request(finalOptions);
        const data = response.data as ApiResponse;
        if (data.code < 200 || data.code >= 300) {
          throw new Error(data.message || '请求失败');
        }
        return data.data as T;
      },
      {
        maxRetries: 3,
        baseDelay: 1000,
        onRetry: (attempt, delay) => {
          console.log(`[Request] 第 ${attempt} 次重试，等待 ${delay}ms`);
        },
      },
    );
  }

  get<T = unknown>(url: string, data?: Record<string, unknown>) {
    return this.request<T>({ url, data, method: 'GET' });
  }

  post<T = unknown>(url: string, data?: Record<string, unknown>) {
    return this.request<T>({ url, data, method: 'POST' });
  }

  delete<T = unknown>(url: string, data?: Record<string, unknown>) {
    return this.request<T>({ url, data, method: 'DELETE' });
  }
}

const request = new Request();
export default request;