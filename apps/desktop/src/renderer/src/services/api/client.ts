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

// 默认后端地址。
// 关键 1：使用 127.0.0.1 而非 localhost。
//   Windows 上 localhost 优先解析到 IPv6 ::1，但 Fastify 默认 host（0.0.0.0）仅监听 IPv4，
//   Chromium/Electron 的 fetch 优先走 IPv6 → 连接被拒 → "Failed to fetch"。
//   显式 127.0.0.1 强制走 IPv4，绕开 IPv6 解析不一致问题。
// 关键 2：端口必须避开 Chromium 不安全端口黑名单。
//   6000 是 X11 协议端口，被 Chromium 内核直接拦截（net::ERR_UNSAFE_PORT），
//   改用 8088（不在黑名单）。
const DEFAULT_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://127.0.0.1:8088'

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
            // M4: 复用统一的 single-flight 刷新（与 fetch 流共享同一 refreshPromise），
            // 避免多路并发 401 各自刷新导致 refresh token 被并发轮换、相互失效。
            await this.performTokenRefresh()
            originalRequest.headers.Authorization = `Bearer ${this.accessToken}`
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

  // M4: 统一的 Token 刷新（single-flight）。fetch 流式与 axios 拦截器共用，
  // 并发 401 只真正刷新一次，避免 refresh token 被并发轮换而相互失效。
  private async performTokenRefresh(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = (async () => {
        const res = await this.instance.post<ApiResponse<AuthTokens>>(
          '/auth/refresh',
          { refresh_token: this.refreshToken }
        )
        this.setTokens(res.data.data)
      })()
    }
    try {
      await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  getAccessToken(): string | null {
    return this.accessToken
  }

  getRefreshToken(): string | null {
    return this.refreshToken
  }

  onTokensChange(callback: (tokens: AuthTokens | null) => void): void {
    this.onTokenChange = callback
  }

  // S5 修复：Token 原仅内存存储，刷新页面即登出。
  // 提供 restoreTokens 方法，应用启动时从主进程 storeApi 恢复已持久化的 token，
  // 避免刷新即登出。注意 storeApi 当前为内存存储（主进程 Map），应用完全重启仍会丢失；
  // 若需跨重启持久化，需在主进程接入 electron-store（见 codewiki M3）。
  async restoreTokens(getStoredTokens: () => Promise<AuthTokens | null | undefined>): Promise<boolean> {
    try {
      const tokens = await getStoredTokens()
      if (tokens && tokens.token && tokens.refreshToken) {
        this.accessToken = tokens.token
        this.refreshToken = tokens.refreshToken
        return true
      }
    } catch {
      // 恢复失败静默处理，保持未登录态
    }
    return false
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

    // M4: fetch 流 401 时复用统一的 single-flight 刷新（与 axios 拦截器一致），
    // 刷新成功后对「原请求」重试一次；刷新失败才 clearTokens（不再静默丢失这条流）。
    if (response.status === 401 && this.refreshToken) {
      try {
        await this.performTokenRefresh()
        headers.Authorization = `Bearer ${this.accessToken}`
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
