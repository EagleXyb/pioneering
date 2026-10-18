/**
 * 运行时 API base（P3）
 *
 * 单独成模块的原因：测试经常 mock `api/client`（只提供 get/post/getAuthHeader），
 * 若 apiUrl 与它们同模块，mock 会漏掉 apiUrl 导致运行时 undefined。
 * 这里保持零依赖，任何模块都可以安全引用。
 *
 * 优先级：显式 setApiBaseUrl > window.__PIONEERING_CONFIG__.apiBaseUrl > '/api'。
 * 不读取 import.meta.env：构建期常量无法在同一产物里切换环境。
 */
const DEFAULT_BASE_URL = '/api';

let runtimeBaseUrl: string | null = null;

interface RuntimeConfig {
  apiBaseUrl?: string;
}

function readInjectedBaseUrl(): string | null {
  const cfg = (globalThis as { __PIONEERING_CONFIG__?: RuntimeConfig })
    .__PIONEERING_CONFIG__;
  const value = cfg?.apiBaseUrl?.trim();
  return value ? value : null;
}

/** 覆盖 API base（测试 / 嵌入场景）；传 null 恢复默认。 */
export function setApiBaseUrl(base: string | null): void {
  const next = base?.trim();
  runtimeBaseUrl = next ? next.replace(/\/$/, '') : null;
}

export function getApiBaseUrl(): string {
  return runtimeBaseUrl ?? readInjectedBaseUrl() ?? DEFAULT_BASE_URL;
}

/** 拼接 API 路径（path 以 / 开头）。 */
export function apiUrl(path: string): string {
  const base = getApiBaseUrl().replace(/\/$/, '');
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
}
