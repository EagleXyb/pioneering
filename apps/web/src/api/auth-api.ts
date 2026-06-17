/**
 * 认证 API 封装
 * 对齐后端 NestJS AuthController 实际路由
 */
import { post, get } from './client';
import type { LoginRequest, AuthResponse, RefreshTokenRequest, UserProfile } from '../types/auth';

/** 登录 POST /auth/login */
export function loginApi(data: LoginRequest): Promise<AuthResponse> {
  return post<AuthResponse>('/auth/login', data);
}

/** 刷新 Token POST /auth/refresh */
export function refreshTokenApi(data: RefreshTokenRequest): Promise<AuthResponse> {
  return post<AuthResponse>('/auth/refresh', data);
}

/** 获取当前用户信息 GET /user/profile（注意：非 /auth/profile） */
export function getProfileApi(): Promise<UserProfile> {
  return get<UserProfile>('/user/profile');
}