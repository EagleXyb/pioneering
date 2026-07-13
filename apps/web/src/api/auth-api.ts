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

/** 获取当前用户信息 GET /user/profile */
export function getProfileApi(): Promise<UserProfile> {
  return get<UserProfile>('/user/profile');
}