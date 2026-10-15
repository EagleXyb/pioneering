/**
 * 认证 API 封装
 * 对齐后端 Fastify /auth 路由（apps/backend-ts/src/routes/auth.ts）
 *
 * 说明：/auth/login 与 /auth/register 均声明 skipAuthRetry——
 * 这两个入口的 401/409 是业务语义（凭证错误 / 账号冲突），
 * 不应触发 client.ts 的 401 自动刷新重试。
 *
 * Token 刷新不在本文件封装：client.ts 内部用 /auth/refresh 完成
 * 「401 → 刷新 → 重试原请求」的闭环（响应体字段为 refresh_token，snake_case）。
 */
import { post, get } from './client';
import type { LoginRequest, RegisterRequest, AuthResponse, UserProfile } from '../types/auth';

/** 登录 POST /auth/login */
export function loginApi(data: LoginRequest): Promise<AuthResponse> {
  return post<AuthResponse>('/auth/login', data, { skipAuthRetry: true });
}

/** 注册 POST /auth/register */
export function registerApi(data: RegisterRequest): Promise<AuthResponse> {
  return post<AuthResponse>('/auth/register', data, { skipAuthRetry: true });
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
