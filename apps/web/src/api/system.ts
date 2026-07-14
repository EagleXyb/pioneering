/**
 * 系统相关接口 —— 对齐后端 system 路由
 */
import { get } from './client';

/** 健康检查返回结构（对应 GET /system/health 或 /health） */
export interface HealthInfo {
  status: string;
  version: string;
  timestamp: string;
}

/** 获取后端健康状态与版本号 */
export function getHealth(): Promise<HealthInfo> {
  return get<HealthInfo>('/health');
}
