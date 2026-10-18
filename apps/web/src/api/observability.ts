/**
 * 可观测性 / 成本汇总客户端（P4）
 *
 * 后端：GET /observability/costs?days=7&groupBy=model|user|session
 */
import { get } from './client';

export type CostGroupBy = 'model' | 'user' | 'session';

export interface CostGroup {
  key: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface CostSummary {
  range: { from: string; to: string; days: number };
  groupBy: CostGroupBy;
  totals: CostGroup;
  groups: CostGroup[];
}

export function getCostSummary(
  days = 7,
  groupBy: CostGroupBy = 'model',
): Promise<CostSummary> {
  return get<CostSummary>(
    `/observability/costs?days=${encodeURIComponent(days)}&groupBy=${groupBy}`,
  );
}
