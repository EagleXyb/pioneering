/**
 * HTTP 客户端封装
 * 统一处理请求头、Token 注入、错误拦截
 */

const BASE_URL = '/api';

/** 从 localStorage 或 sessionStorage 获取 Token */
export function getToken(): string | null {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  return token && token.trim() ? token : null;
}

/** 存储 Token
 * @param persistent true（默认）存 localStorage，浏览器关闭后仍保留；false 存 sessionStorage，关闭后清除
 */
export function setToken(token: string, refreshToken?: string, persistent = true): void {
  const storage = persistent ? localStorage : sessionStorage;
  const other = persistent ? sessionStorage : localStorage;
  storage.setItem('token', token);
  if (refreshToken) {
    storage.setItem('refreshToken', refreshToken);
  }
  // 清除另一侧存储，避免两处同时存在造成混淆
  other.removeItem('token');
  other.removeItem('refreshToken');
}

/** 获取 Authorization 请求头（Token 为空时返回空对象） */
export function getAuthHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
export function clearToken(): void {
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('refreshToken');
}

/** 通用错误响应 */
export interface ApiError {
  code: number;
  message: string;
  details?: string;
  requestId?: string;
}

/** 获取 refreshToken */
function getRefreshToken(): string | null {
  return localStorage.getItem('refreshToken') || sessionStorage.getItem('refreshToken');
}

/** token 刷新状态：防止并发请求同时触发多次刷新 */
let refreshPromise: Promise<boolean> | null = null;

/** 尝试用 refreshToken 刷新 accessToken
 * @returns true 刷新成功，false 刷新失败（需重新登录）
 */
async function tryRefreshToken(): Promise<boolean> {
  // 防止并发刷新：多个 401 请求共享同一个刷新 Promise
  if (refreshPromise) return refreshPromise;

  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  refreshPromise = (async () => {
    try {
      const resp = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!resp.ok) return false;
      const data = await resp.json().catch(() => null);
      // 解包 { code, data, message } 格式
      const authData = data?.data ?? data;
      if (!authData?.token) return false;
      // 存新 token（保持原有存储位置）
      const wasPersistent = !!localStorage.getItem('token');
      setToken(authData.token, authData.refreshToken, wasPersistent);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/** 统一请求方法
 * 401 时先尝试 token 刷新，刷新成功则重试原请求，刷新失败再清除 token
 */
async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const doRequest = async (): Promise<Response> => {
    const url = `${BASE_URL}${path}`;
    const token = getToken();

    const hasBody = options.method && options.method !== 'GET' && options.method !== 'DELETE' && options.body != null

    const headers: Record<string, string> = {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...((options.headers as Record<string, string>) || {}),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return fetch(url, { ...options, headers });
  };

  let response = await doRequest();

  // 204 无内容（删除/归档操作）
  if (response.status === 204) {
    return undefined as T;
  }

  // 401 未授权 — 先尝试刷新 token，刷新成功则重试原请求
  if (response.status === 401) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      // 刷新成功，用新 token 重试原请求
      response = await doRequest();
      if (response.status === 204) {
        return undefined as T;
      }
      if (response.status !== 401) {
        // 重试成功（非 401），继续正常解析
      } else {
        // 重试仍然 401，说明新 token 也无效，清除并抛错
        clearToken();
        throw { code: 401, message: '未认证或 Token 已过期，请重新登录' } as ApiError;
      }
    } else {
      // 刷新失败，清除 token 并抛错
      clearToken();
      throw { code: 401, message: '未认证或 Token 已过期，请重新登录' } as ApiError;
    }
  }

  // 解析响应体
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error: ApiError = data || {
      code: response.status,
      message: response.statusText,
    };
    throw error;
  }

  // 解包 ResponseInterceptor 的 { code, data, message } 格式
  if (data !== null && typeof data === 'object' && 'data' in data && 'code' in data && 'message' in data) {
    return (data as any).data as T;
  }

  return data as T;
}

/** GET 请求 */
export function get<T>(path: string, params?: Record<string, any>): Promise<T> {
  const search = params
    ? '?' + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : '';
  return request<T>(`${path}${search}`);
}

/** POST 请求 */
export function post<T>(path: string, body?: any): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** PUT 请求 */
export function put<T>(path: string, body?: any): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** DELETE 请求 */
export function del<T>(path: string, params?: Record<string, any>): Promise<T> {
  const search = params
    ? '?' + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : '';
  return request<T>(`${path}${search}`, {
    method: 'DELETE',
  });
}
