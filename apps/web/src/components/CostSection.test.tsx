/**
 * P5 回归：设置页「用量与成本」
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/api/observability', () => ({
  getCostSummary: vi.fn(async () => ({
    range: { from: '2026-10-11T00:00:00Z', to: '2026-10-18T00:00:00Z', days: 7 },
    groupBy: 'model',
    totals: {
      key: 'total',
      requests: 12,
      promptTokens: 1000,
      completionTokens: 2000,
      totalTokens: 3000,
      costUsd: 0.000045,
    },
    groups: [
      {
        key: 'deepseek-v4-flash',
        requests: 12,
        promptTokens: 1000,
        completionTokens: 2000,
        totalTokens: 3000,
        costUsd: 0.000045,
      },
    ],
  })),
}));

import { CostSection } from './CostSection';
import { getCostSummary } from '@/api/observability';

describe('CostSection', () => {
  it('展示请求数、token、成本与分组表格', async () => {
    render(<CostSection />);
    await screen.findByText('用量与成本');
    expect(vi.mocked(getCostSummary)).toHaveBeenCalled();
    // 调试：确认数据是否落到 DOM
    // screen.debug(undefined, 4000);

    expect((await screen.findAllByText('3.0K')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$0.000045').length).toBeGreaterThan(0);
    expect(screen.getByText('deepseek-v4-flash')).toBeInTheDocument();
  });
});
