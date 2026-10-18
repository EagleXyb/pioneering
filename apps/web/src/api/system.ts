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
  /** P4：上下文窗口（新字段，替代旧 max_tokens 元数据语义） */
  context_window?: number;
  /** @deprecated 旧字段，仅为兼容保留；新代码用 context_window */
  max_tokens?: number;
  pricing?: { input_price?: number; output_price?: number };
  /** ── P3：来自 /capabilities 的能力字段（/system/models 不返回） ── */
  alias?: string;
  model_id?: string;
  provider?: string;
  capabilities?: string[];
  status?: 'active' | 'degraded' | 'sunset';
  disable_reason?: string;
}

/** 获取后端支持的模型列表 */
export function getModels(): Promise<ModelInfo[]> {
  return get<ModelInfo[]>('/system/models');
}
