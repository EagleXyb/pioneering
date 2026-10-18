/**
 * P3 回归：能力清单 → 选择器模型信息
 */
import { describe, it, expect } from 'vitest';
import { toModelInfo, type CapabilityModel } from './capabilities';

describe('toModelInfo', () => {
  it('id 使用别名，保留真实 model_id 与状态', () => {
    const cap: CapabilityModel = {
      alias: 'fast',
      model_id: 'deepseek-v4-flash',
      display_name: 'DeepSeek-V4-Flash',
      description: '标准对话模型',
      provider: 'deepseek',
      capabilities: ['tools', 'json_mode'],
      context_window: 128000,
      max_output: null,
      pricing: { input_price: 0.14, output_price: 0.28 },
      status: 'active',
      disable_reason: null,
    };

    expect(toModelInfo(cap)).toMatchObject({
      id: 'fast',
      model_id: 'deepseek-v4-flash',
      name: 'DeepSeek-V4-Flash',
      max_tokens: 128000,
      status: 'active',
      provider: 'deepseek',
      capabilities: ['tools', 'json_mode'],
    });
  });

  it('下线模型保留原因', () => {
    const cap: CapabilityModel = {
      alias: 'legacy',
      model_id: 'legacy-model',
      display_name: 'Legacy',
      provider: 'deepseek',
      capabilities: [],
      context_window: null,
      max_output: null,
      status: 'sunset',
      disable_reason: '已由 fast 替代',
    };
    expect(toModelInfo(cap)).toMatchObject({
      status: 'sunset',
      disable_reason: '已由 fast 替代',
    });
  });
});
