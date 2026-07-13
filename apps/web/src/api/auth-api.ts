/**
 * 认证 API 封装
 * 对齐后端 FastAPI /auth 路由
 */
import { post, get } from './client';
import type { LoginRequest, RegisterRequest, AuthResponse, RefreshTokenRequest, UserProfile } from '../types/auth';

/** 登录 POST /auth/login */
export function loginApi(data: LoginRequest): Promise<AuthResponse> {
  return post<AuthResponse>('/auth/login', data);
}

/** 注册 POST /auth/register */
export function registerApi(data: RegisterRequest): Promise<AuthResponse> {
  return post<AuthResponse>('/auth/register', data);
}

/** 刷新 Token POST /auth/refresh */
export function refreshTokenApi(data: RefreshTokenRequest): Promise<AuthResponse> {
  return post<AuthResponse>('/auth/refresh', data);
}

/** 退出登录 POST /auth/logout —— 通知后端撤销 refresh token
 * @param refreshToken 当前设备的 refresh token，未提供时后端将撤销该用户全部 token
 */
export function logoutApi(refreshToken?: string): Promise<void> {
  return post<void>('/auth/logout', refreshToken ? { refresh_token: refreshToken } : undefined);
}

/** 获取当前用户信息 GET /user/profile */
export function getProfileApi(): Promise<UserProfile> {
  return get<UserProfile>('/user/profile');
}