import Taro from '@tarojs/taro';

// ====== 类型定义 ======
export interface RequestConfig {
  baseURL: string;
  timeout: number;
  header?: Record<string, string>;
  retry: RetryConfig;
}

export interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  retryableStatusCodes: number[];
}

export interface RequestInterceptor {
  (config: Taro.request.Option): Taro.request.Option;
}

export interface ResponseInterceptor {
  (response: Taro.request.SuccessCallbackResult): unknown;
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
  retry: {
    maxRetries: 2,
    retryDelay: 1000,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  },
};

// ====== 请求去重缓存 ======
const pendingRequests = new Map<string, Promise<unknown>>();

function generateRequestKey(options: Taro.request.Option): string {
  return `${options.method || 'GET'}:${options.url}:${JSON.stringify(options.data || '')}`;
}

// ====== 延迟工具 ======
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ====== 错误类型 ======
interface RequestError {
  statusCode?: number;
  errMsg?: string;
  data?: unknown;
}

// ====== 请求类 ======
class Request {
  private config: RequestConfig;
  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];
  private abortControllers = new Map<string, ReturnType<typeof Taro.request>>();

  constructor(config?: Partial<RequestConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setConfig(config: Partial<RequestConfig>) {
    this.config = { ...this.config, ...config };
  }

  addRequestInterceptor(interceptor: RequestInterceptor) {
    this.requestInterceptors.push(interceptor);
  }

  addResponseInterceptor(interceptor: ResponseInterceptor) {
    this.responseInterceptors.push(interceptor);
  }

  private getToken(): string {
    return Taro.getStorageSync('token') || '';
  }

  private buildOptions(options: Taro.request.Option): Taro.request.Option {
    let merged: Taro.request.Option = {
      ...this.config,
      ...options,
      url: this.config.baseURL + options.url,
      header: {
        ...this.config.header,
        ...options.header,
      },
    };

    // 自动注入 token
    const token = this.getToken();
    if (token) {
      merged.header = { ...merged.header, Authorization: `Bearer ${token}` };
    }

    // 执行请求拦截器
    for (const interceptor of this.requestInterceptors) {
      merged = interceptor(merged);
    }

    return merged;
  }

  /** 带重试的请求核心方法 */
  private async requestWithRetry(
    options: Taro.request.Option,
    retriesLeft = this.config.retry.maxRetries,
  ): Promise<Taro.request.SuccessCallbackResult> {
    try {
      const task = Taro.request(options);

      // 保存 RequestTask 以支持取消
      const key = generateRequestKey(options);
      this.abortControllers.set(key, task);

      const response = await task;

      // 请求完成后移除
      this.abortControllers.delete(key);

      return response;
    } catch (error) {
      const err = error as RequestError;
      const statusCode = err.statusCode || 0;
      const isRetryable = this.config.retry.retryableStatusCodes.includes(statusCode);

      if (retriesLeft > 0 && isRetryable) {
        // 指数退避：基础延迟 * 2^(已重试次数)
        const retryCount = this.config.retry.maxRetries - retriesLeft;
        const backoffDelay = this.config.retry.retryDelay * Math.pow(2, retryCount);
        await delay(backoffDelay);
        return this.requestWithRetry(options, retriesLeft - 1);
      }

      throw error;
    }
  }

  /** 带请求去重的请求方法 */
  async request<T = unknown>(options: Taro.request.Option): Promise<T> {
    const finalOptions = this.buildOptions(options);
    const requestKey = generateRequestKey(finalOptions);

    // 请求去重：相同请求在 pending 期间复用 Promise
    const existingPending = pendingRequests.get(requestKey);
    if (existingPending) {
      return existingPending as Promise<T>;
    }

    const requestPromise = this._executeRequest<T>(finalOptions, requestKey);
    pendingRequests.set(requestKey, requestPromise);

    try {
      const result = await requestPromise;
      return result;
    } finally {
      pendingRequests.delete(requestKey);
    }
  }

  private async _executeRequest<T>(finalOptions: Taro.request.Option, requestKey: string): Promise<T> {
    try {
      const response = await this.requestWithRetry(finalOptions);

      // 执行响应拦截器
      let result: unknown = response;
      for (const interceptor of this.responseInterceptors) {
        result = interceptor(response as Taro.request.SuccessCallbackResult);
      }

      return result as T;
    } catch (error) {
      this.abortControllers.delete(requestKey);
      this.handleError(error as RequestError);
      throw error;
    }
  }

  /** 取消指定请求 */
  abort(url: string, method = 'GET', data?: Record<string, unknown>) {
    const key = generateRequestKey({ url, method, data } as Taro.request.Option);
    const task = this.abortControllers.get(key);
    if (task) {
      task.abort();
      this.abortControllers.delete(key);
    }
  }

  /** 取消所有进行中的请求 */
  abortAll() {
    for (const [, task] of this.abortControllers) {
      task.abort();
    }
    this.abortControllers.clear();
    pendingRequests.clear();
  }

  private handleError(error: RequestError) {
    const statusMessages: Record<number, string> = {
      400: '请求参数错误',
      401: '登录已过期，请重新登录',
      403: '没有访问权限',
      404: '请求资源不存在',
      408: '请求超时，请重试',
      429: '请求过于频繁，请稍后',
      500: '服务器内部错误',
      502: '网关错误',
      503: '服务不可用',
      504: '网关超时',
    };

    const statusCode = error.statusCode || 0;
    const message = statusMessages[statusCode] || '网络异常，请稍后重试';

    if (statusCode === 401) {
      Taro.removeStorageSync('token');
      Taro.showToast({ title: message, icon: 'none' });
      setTimeout(() => {
        Taro.reLaunch({ url: '/pages/home/index' });
      }, 1500);
      return;
    }

    Taro.showToast({ title: message, icon: 'none', duration: 2000 });
  }

  get<T = unknown>(url: string, data?: Record<string, unknown>, options?: Partial<Taro.request.Option>) {
    return this.request<T>({ url, data, method: 'GET', ...options });
  }

  post<T = unknown>(url: string, data?: Record<string, unknown>, options?: Partial<Taro.request.Option>) {
    return this.request<T>({ url, data, method: 'POST', ...options });
  }

  put<T = unknown>(url: string, data?: Record<string, unknown>, options?: Partial<Taro.request.Option>) {
    return this.request<T>({ url, data, method: 'PUT', ...options });
  }

  del<T = unknown>(url: string, data?: Record<string, unknown>, options?: Partial<Taro.request.Option>) {
    return this.request<T>({ url, data, method: 'DELETE', ...options });
  }
}

// ====== 导出实例 ======
const request = new Request();

// 默认响应拦截器：解包业务数据
request.addResponseInterceptor((response) => {
  const data = response.data as ApiResponse;
  if (data.code !== 0 && data.code !== 200) {
    const error = new Error(data.message || '请求失败') as Error & { code?: number };
    error.code = data.code;
    throw error;
  }
  return data.data;
});

export { Request };
export default request;
