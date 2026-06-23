/** 登录请求 — 对齐后端 LoginRequestDto */
export interface LoginRequest {
  username: string;
  password: string;
}

/** 注册请求 */
export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

/** 认证响应 — 对齐后端 generateAuthResponse 返回格式 */
export interface AuthResponse {
  token: string;
  refreshToken: string;
  expiresIn?: number;
  user: UserProfile;
}

/** 用户信息 — 对齐后端 User profile 返回字段 */
export interface UserProfile {
  id: string;
  username: string;
  nickname: string | null;
  avatar: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Refresh Token 请求 — 对齐后端 RefreshTokenRequestDto */
export interface RefreshTokenRequest {
  refreshToken: string;
}

/** 认证状态 */
export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'error';