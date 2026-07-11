// ============================================================
// Auth Service — 认证相关 API
// ============================================================

import apiClient from './client'
import type {
  AuthTokens,
  LoginRequest,
  RegisterRequest,
  UserProfile,
  ApiResponse
} from '@shared/types'

export const authService = {
  /** 用户名密码登录 */
  async login(req: LoginRequest): Promise<AuthTokens> {
    const res = await apiClient.post<AuthTokens>('/auth/login', req)
    apiClient.setTokens(res.data)
    return res.data
  },

  /** 用户注册 */
  async register(req: RegisterRequest): Promise<AuthTokens> {
    const res = await apiClient.post<AuthTokens>('/auth/register', req)
    apiClient.setTokens(res.data)
    return res.data
  },

  /** 刷新 Token */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const res = await apiClient.post<AuthTokens>('/auth/refresh', {
      refresh_token: refreshToken
    })
    apiClient.setTokens(res.data)
    return res.data
  },

  /** 获取当前用户资料 */
  async getProfile(): Promise<UserProfile> {
    const res = await apiClient.get<UserProfile>('/auth/profile')
    return res.data
  },

  /** 更新用户资料 */
  async updateProfile(
    data: Partial<Pick<UserProfile, 'nickname' | 'avatar'>>
  ): Promise<UserProfile> {
    const res = await apiClient.put<UserProfile>('/auth/profile', data)
    return res.data
  },

  /** 登出 */
  // S7 修复：原实现仅前端 clearTokens()，未通知后端撤销 token。
  // 若 token 在别处被截获，仍可在有效期内使用。改为 best-effort 调用后端撤销端点，
  // 无论后端是否成功都清除本地 token（避免后端不可用时用户无法登出）。
  async logout(): Promise<void> {
    try {
      await apiClient.post('/auth/logout')
    } catch {
      // 后端不可用或已失效时忽略，仍继续清除本地 token
    } finally {
      apiClient.clearTokens()
    }
  },

  /** 是否已认证 */
  isAuthenticated(): boolean {
    return apiClient.getAccessToken() !== null
  }
}
