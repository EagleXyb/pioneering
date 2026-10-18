/**
 * 模型事实行 —— 悬停详情卡里的「标签 : 值」行
 *
 * 只使用 GET /system/models 已返回的字段，不做推测性字段：
 * - 消耗速度：由 pricing.input_price 换算成相对列表内最高价的倍率。后端只提供
 *   绝对单价，倍率是相对口径，因此在这里换算（最高价模型记为 1.00x）。
 * - 上下文窗口：context_window 的人类可读格式（128000 → 128K）。
 *   P4 起后端元数据字段由 max_tokens 更名为 context_window，旧字段仅作回退。
 *
 * 缺字段的模型对应行直接省略，不显示占位符。
 */
import type { ModelInfo } from '@/api/system';

export interface ModelFact {
  label: string;
  value: string;
}

/** 列表内最高输入单价（倍率基准） */
export function maxInputPrice(models: readonly ModelInfo[]): number {
  return models.reduce((max, m) => {
    const price = m.pricing?.input_price;
    return typeof price === 'number' && price > max ? price : max;
  }, 0);
}

/** 输入单价 → 相对倍率文案（如 "0.11x"）；缺价格或基准为 0 时返回 null */
export function formatPriceMultiplier(
  model: ModelInfo,
  basePrice: number,
): string | null {
  const price = model.pricing?.input_price;
  if (typeof price !== 'number' || price <= 0 || basePrice <= 0) return null;
  return `${(price / basePrice).toFixed(2)}x`;
}

/** token 数 → 上下文窗口文案（128000 → "128K"，1000000 → "1M"） */
export function formatContextWindow(maxTokens?: number): string | null {
  if (typeof maxTokens !== 'number' || maxTokens <= 0) return null;
  if (maxTokens >= 1_000_000) return `${Math.round(maxTokens / 1_000_000)}M`;
  if (maxTokens >= 1_000) return `${Math.round(maxTokens / 1_000)}K`;
  return String(maxTokens);
}

/** 组装详情卡的事实行（固定顺序，缺数据则跳过） */
export function buildModelFacts(
  model: ModelInfo,
  models: readonly ModelInfo[],
): ModelFact[] {
  const facts: ModelFact[] = [];

  // P3：状态行优先展示（不可用模型需要给出原因）
  if (model.status && model.status !== 'active') {
    const label = model.status === 'sunset' ? '已下线' : '服务受限';
    facts.push({
      label: '状态',
      value: model.disable_reason ? `${label}（${model.disable_reason}）` : label,
    });
  }

  const multiplier = formatPriceMultiplier(model, maxInputPrice(models));
  if (multiplier) facts.push({ label: '消耗速度', value: `${multiplier} 倍率` });

  // P4：优先新字段 context_window；旧接口仍返回 max_tokens 时兼容回退
  const context = formatContextWindow(model.context_window ?? model.max_tokens);
  if (context) facts.push({ label: '上下文窗口', value: context });

  return facts;
}
