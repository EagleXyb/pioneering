/**
 * P0 回归：模型标识单一事实源
 *
 * 覆盖三件事：
 *   1. 默认模型 / 推理模型必须真实存在于可用目录中；
 *   2. 目录中不得再出现"可选但必然失败"的跨厂商模型；
 *   3. 别名（fast / reasoning）解析与 Agent 请求 schema 的 model 字段。
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MODEL,
  REASONING_MODEL,
  MODEL_ALIASES,
  AVAILABLE_MODELS,
  resolveModelAlias,
  toModelAlias,
} from '../src/config/models.ts';
import { AgentChatRequestSchema } from '../src/schemas/agent.ts';

describe('config/models — 模型单一事实源', () => {
  it('默认模型与推理模型都出现在可用目录中', () => {
    const ids = AVAILABLE_MODELS.map((m) => m.id);
    expect(ids).toContain(DEFAULT_MODEL);
    expect(ids).toContain(REASONING_MODEL);
  });

  it('不再包含跨厂商但无对应端点的模型', () => {
    const ids = AVAILABLE_MODELS.map((m) => m.id);
    for (const legacy of [
      'gpt-4o',
      'gpt-4o-mini',
      'glm-5.3',
      'glm-5.3-flash',
      'minimax-m3',
    ]) {
      expect(ids).not.toContain(legacy);
    }
  });

  it('别名 fast / reasoning 解析为真实模型 ID', () => {
    expect(resolveModelAlias('fast')).toBe(MODEL_ALIASES.fast);
    expect(resolveModelAlias('reasoning')).toBe(MODEL_ALIASES.reasoning);
    expect(resolveModelAlias('fast')).toBe(DEFAULT_MODEL);
    expect(resolveModelAlias('reasoning')).toBe(REASONING_MODEL);
  });

  it('历史模型 ID 解析为当前模型，避免旧缓存/旧用量失效', () => {
    expect(resolveModelAlias('deepseek-v4-flash')).toBe(DEFAULT_MODEL);
    expect(toModelAlias('deepseek-v4-flash')).toBe('fast');
  });

  it('未知值原样透传，空值返回 undefined', () => {
    expect(resolveModelAlias('deepseek-v4-pro')).toBe('deepseek-v4-pro');
    expect(resolveModelAlias('some-vendor-model')).toBe('some-vendor-model');
    expect(resolveModelAlias(null)).toBeUndefined();
    expect(resolveModelAlias(undefined)).toBeUndefined();
    expect(resolveModelAlias('')).toBeUndefined();
  });
});

describe('AgentChatRequestSchema — 模型透传字段', () => {
  it('接受真实模型 ID 与别名', () => {
    expect(
      AgentChatRequestSchema.safeParse({ message: 'hi', model: 'reasoning' }).success,
    ).toBe(true);
    expect(
      AgentChatRequestSchema.safeParse({ message: 'hi', model: DEFAULT_MODEL }).success,
    ).toBe(true);
  });

  it('省略 model 仍然合法（回退后端默认）', () => {
    const parsed = AgentChatRequestSchema.safeParse({ message: 'hi' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.model).toBeUndefined();
  });
});
