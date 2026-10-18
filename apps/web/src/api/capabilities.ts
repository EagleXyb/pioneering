/**
 * 能力清单接口（P3）—— 对齐后端 GET /capabilities
 *
 * 与 /system/models 的区别：
 *   - 这里给的是接入层视角：alias / provider / capabilities / status
 *   - 不含密钥与端点
 *   - 客户端应以此决定"哪些模型可选、是否可用"
 */
import { get } from './client';
import type { ModelInfo } from './system';

export interface CapabilityModel {
  alias: string;
  model_id: string;
  display_name: string;
  description?: string;
  provider: string;
  capabilities: string[];
  context_window: number | null;
  max_output: number | null;
  pricing?: ModelInfo['pricing'];
  status: string;
  disable_reason: string | null;
}

export interface CapabilitiesResponse {
  version: number;
  models: CapabilityModel[];
}

export function getCapabilities(): Promise<CapabilitiesResponse> {
  return get<CapabilitiesResponse>('/capabilities');
}

/** 能力项 → 选择器使用的 ModelInfo（id 使用别名，旧 model_id 仍可被后端解析）。 */
export function toModelInfo(m: CapabilityModel): ModelInfo {
  return {
    id: m.alias,
    name: m.display_name,
    description: m.description,
    context_window: m.context_window ?? undefined,
    max_tokens: m.context_window ?? undefined,
    pricing: m.pricing,
    alias: m.alias,
    model_id: m.model_id,
    provider: m.provider,
    capabilities: m.capabilities,
    status: (m.status as ModelInfo['status']) ?? 'active',
    disable_reason: m.disable_reason ?? undefined,
  };
}
