import { describe, it, expect } from 'vitest';
import type { ModelInfo } from '@/api/system';
import {
  buildModelFacts,
  formatContextWindow,
  formatPriceMultiplier,
  maxInputPrice,
} from './modelFacts';

/** 后端 /system/models 的真实取值（用于锁定实际呈现口径） */
const BACKEND_MODELS: ModelInfo[] = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    max_tokens: 128000,
    pricing: { input_price: 0.14, output_price: 0.28 },
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    max_tokens: 128000,
    pricing: { input_price: 0.28, output_price: 0.56 },
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    max_tokens: 128000,
    pricing: { input_price: 0.15, output_price: 0.6 },
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    max_tokens: 128000,
    pricing: { input_price: 2.5, output_price: 10 },
  },
];

describe('maxInputPrice', () => {
  it('取列表内最高输入单价作为倍率基准', () => {
    expect(maxInputPrice(BACKEND_MODELS)).toBe(2.5);
  });

  it('空列表 / 无价格时返回 0', () => {
    expect(maxInputPrice([])).toBe(0);
    expect(maxInputPrice([{ id: 'a', name: 'A' }])).toBe(0);
  });
});

describe('formatPriceMultiplier', () => {
  it('相对最高价换算为两位小数倍率', () => {
    const base = maxInputPrice(BACKEND_MODELS);
    expect(formatPriceMultiplier(BACKEND_MODELS[0], base)).toBe('0.06x'); // 0.14
    expect(formatPriceMultiplier(BACKEND_MODELS[1], base)).toBe('0.11x'); // 0.28
    expect(formatPriceMultiplier(BACKEND_MODELS[3], base)).toBe('1.00x'); // 2.50
  });

  it('缺价格 / 零价格 / 基准为 0 时返回 null（不显示占位）', () => {
    expect(formatPriceMultiplier({ id: 'a', name: 'A' }, 2.5)).toBeNull();
    expect(
      formatPriceMultiplier({ id: 'a', name: 'A', pricing: { input_price: 0 } }, 2.5),
    ).toBeNull();
    expect(
      formatPriceMultiplier({ id: 'a', name: 'A', pricing: { input_price: 1 } }, 0),
    ).toBeNull();
  });
});

describe('formatContextWindow', () => {
  it('按量级换算为 K / M', () => {
    expect(formatContextWindow(128000)).toBe('128K');
    expect(formatContextWindow(1000000)).toBe('1M');
    expect(formatContextWindow(200000)).toBe('200K');
  });

  it('不足千位原样输出；非法值返回 null', () => {
    expect(formatContextWindow(999)).toBe('999');
    expect(formatContextWindow(0)).toBeNull();
    expect(formatContextWindow(undefined)).toBeNull();
  });
});

describe('buildModelFacts', () => {
  it('按固定顺序输出消耗速度与上下文窗口', () => {
    expect(buildModelFacts(BACKEND_MODELS[0], BACKEND_MODELS)).toEqual([
      { label: '消耗速度', value: '0.06x 倍率' },
      { label: '上下文窗口', value: '128K' },
    ]);
  });

  it('缺字段的模型不产生空行', () => {
    expect(buildModelFacts({ id: 'a', name: 'A' }, BACKEND_MODELS)).toEqual([]);
    expect(
      buildModelFacts({ id: 'a', name: 'A', max_tokens: 128000 }, BACKEND_MODELS),
    ).toEqual([{ label: '上下文窗口', value: '128K' }]);
  });
});
