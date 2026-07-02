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
  logout(): void {
    apiClient.clearTokens()
  },

  /** 是否已认证 */
  isAuthenticated(): boolean {
    return apiClient.getAccessToken() !== null
  }
}
