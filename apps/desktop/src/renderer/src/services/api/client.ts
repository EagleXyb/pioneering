// ============================================================
// HTTP Client — 封装的 API 请求客户端
// ============================================================

import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
  type AxiosResponse
} from 'axios'
import type { ApiResponse, AuthTokens } from '@shared/types'

const DEFAULT_BASE_URL = 'http://localhost:9000'

class ApiClient {
  private instance: AxiosInstance
  private accessToken: string | null = null
  private refreshToken: string | null = null
  private onTokenChange?: (tokens: AuthTokens | null) => void

  constructor(baseURL: string = DEFAULT_BASE_URL) {
    this.instance = axios.create({
      baseURL,
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json'
      }
    })

    // 请求拦截器 — 自动附加 Token
    this.instance.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        if (this.accessToken && config.headers) {
          config.headers.Authorization = `Bearer ${this.accessToken}`
        }
        return config
      },
      (error) => Promise.reject(error)
    )

    // 响应拦截器 — 统一错误处理 + Token 刷新
    this.instance.interceptors.response.use(
      (response: AxiosResponse<ApiResponse>) => {
        return response
      },
      async (error) => {
        const originalRequest = error.config

        // 401 自动刷新 Token
        if (
          error.response?.status === 401 &&
          !originalRequest._retry &&
          this.refreshToken
        ) {
          originalRequest._retry = true
          try {
            const res = await this.instance.post<ApiResponse<AuthTokens>>(
              '/auth/refresh',
              { refresh_token: this.refreshToken }
            )
            const tokens = res.data.data
            this.setTokens(tokens)
            originalRequest.headers.Authorization = `Bearer ${tokens.token}`
            return this.instance(originalRequest)
          } catch {
            this.clearTokens()
            throw error
          }
        }

        return Promise.reject(error)
      }
    )
  }

  // ---- Token 管理 ----
  setTokens(tokens: AuthTokens | null): void {
    if (tokens) {
      this.accessToken = tokens.token
      this.refreshToken = tokens.refreshToken
    } else {
      this.accessToken = null
      this.refreshToken = null
    }
    this.onTokenChange?.(tokens)
  }

  clearTokens(): void {
    this.setTokens(null)
  }

  getAccessToken(): string | null {
    return this.accessToken
  }

  onTokensChange(callback: (tokens: AuthTokens | null) => void): void {
    this.onTokenChange = callback
  }

  // ---- 请求方法 ----
  async get<T = unknown>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    const res = await this.instance.get<ApiResponse<T>>(url, config)
    return res.data
  }

  async post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    const res = await this.instance.post<ApiResponse<T>>(url, data, config)
    return res.data
  }

  async put<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    const res = await this.instance.put<ApiResponse<T>>(url, data, config)
    return res.data
  }

  async delete<T = unknown>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    const res = await this.instance.delete<ApiResponse<T>>(url, config)
    return res.data
  }

  // 获取底层 axios 实例（用于 SSE 流等特殊场景）
  getAxiosInstance(): AxiosInstance {
    return this.instance
  }

  getBaseURL(): string {
    return this.instance.defaults.baseURL ?? DEFAULT_BASE_URL
  }
}

// 全局单例
export const apiClient = new ApiClient()
export default apiClient
