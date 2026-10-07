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

/** 后端支持的模型信息（对齐 GET /system/models 返回项） */
export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  max_tokens?: number;
  pricing?: { input_price?: number; output_price?: number };
}

/** 获取后端支持的模型列表 */
export function getModels(): Promise<ModelInfo[]> {
  return get<ModelInfo[]>('/system/models');
}
