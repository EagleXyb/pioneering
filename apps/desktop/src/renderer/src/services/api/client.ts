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

const DEFAULT_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:9000'

class ApiClient {
  private instance: AxiosInstance
  private accessToken: string | null = null
  private refreshToken: string | null = null
  private onTokenChange?: (tokens: AuthTokens | null) => void
  private refreshPromise: Promise<void> | null = null

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
        const originalRequest = error.config as
          | (InternalAxiosRequestConfig & { _retry?: boolean })
          | undefined

        // 401 自动刷新 Token（single-flight：并发 401 共享同一次刷新，避免 refresh token 被多次轮换）
        if (
          error.response?.status === 401 &&
          originalRequest &&
          !originalRequest._retry &&
          this.refreshToken
        ) {
          originalRequest._retry = true
          try {
            if (!this.refreshPromise) {
              this.refreshPromise = (async () => {
                const res = await this.instance.post<ApiResponse<AuthTokens>>(
                  '/auth/refresh',
                  { refresh_token: this.refreshToken }
                )
                this.setTokens(res.data.data)
              })()
            }
            await this.refreshPromise
            originalRequest.headers.Authorization = `Bearer ${this.accessToken}`
            return this.instance(originalRequest)
          } catch {
            this.clearTokens()
            throw error
          } finally {
            this.refreshPromise = null
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

  getAxiosInstance(): AxiosInstance {
    return this.instance
  }

  async stream(
    url: string,
    body: unknown,
    options: {
      signal?: AbortSignal
      headers?: Record<string, string>
    } = {}
  ): Promise<Response> {
    const baseUrl = this.instance.defaults.baseURL ?? DEFAULT_BASE_URL
    const fullUrl = `${baseUrl}${url.startsWith('/') ? url : '/' + url}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers ?? {})
    }
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`
    }

    const response = await fetch(fullUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...(body as Record<string, unknown>), stream: true }),
      signal: options.signal
    })

    if (response.status === 401 && this.refreshToken) {
      try {
        const res = await this.instance.post<ApiResponse<AuthTokens>>(
          '/auth/refresh',
          { refresh_token: this.refreshToken }
        )
        const tokens = res.data.data
        this.setTokens(tokens)
        headers.Authorization = `Bearer ${tokens.token}`
        return fetch(fullUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...(body as Record<string, unknown>), stream: true }),
          signal: options.signal
        })
      } catch {
        this.clearTokens()
      }
    }

    return response
  }

  setBaseURL(url: string): void {
    this.instance.defaults.baseURL = url
  }

  getBaseURL(): string {
    return this.instance.defaults.baseURL ?? DEFAULT_BASE_URL
  }
}

// 全局单例
export const apiClient = new ApiClient()
export default apiClient
