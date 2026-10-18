/**
 * 用量与成本（P5）
 *
 * 数据来自 GET /observability/costs（服务端已按当前用户过滤）。
 * 支持按模型 / 会话切换聚合维度，默认近 7 天。
 */
import { useEffect, useState } from 'react';
import {
  getCostSummary,
  type CostGroupBy,
  type CostSummary,
} from '@/api/observability';

const GROUP_TABS: ReadonlyArray<{ key: CostGroupBy; label: string }> = [
  { key: 'model', label: '按模型' },
  { key: 'session', label: '按会话' },
  { key: 'user', label: '按账号' },
];

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatCost(value: number): string {
  if (value > 0 && value < 0.000001) return '<$0.000001';
  return `$${value.toFixed(6)}`;
}

export function CostSection() {
  const [groupBy, setGroupBy] = useState<CostGroupBy>('model');
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');

    getCostSummary(7, groupBy)
      .then((data) => {
        if (alive) setSummary(data);
      })
      .catch((e: unknown) => {
        if (alive) {
          setSummary(null);
          setError((e as { message?: string })?.message || '请求失败');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [groupBy]);

  return (
    <div className="cost-section">
      <div className="setting-row">
        <div className="setting-row-text">
          <div className="setting-row-title">用量与成本</div>
          <div className="setting-row-desc">
            近 7 天模型调用统计（按目录单价估算，仅本人数据）
          </div>
        </div>
        <div className="cost-tabs" role="tablist" aria-label="成本聚合维度">
          {GROUP_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={groupBy === tab.key}
              className="cost-tab"
              data-active={groupBy === tab.key || undefined}
              onClick={() => setGroupBy(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="setting-row-desc">加载中…</div>}
      {!loading && error && (
        <div className="setting-row-desc">成本数据暂不可用：{error}</div>
      )}

      {!loading && summary && (
        <>
          <div className="cost-cards">
            <div className="cost-card">
              <span className="cost-card-label">请求数</span>
              <strong className="cost-card-value">
                {summary.totals.requests.toLocaleString()}
              </strong>
            </div>
            <div className="cost-card">
              <span className="cost-card-label">Token</span>
              <strong className="cost-card-value">
                {formatTokens(summary.totals.totalTokens)}
              </strong>
            </div>
            <div className="cost-card">
              <span className="cost-card-label">估算成本</span>
              <strong className="cost-card-value">
                {formatCost(summary.totals.costUsd)}
              </strong>
            </div>
          </div>

          {summary.groups.length === 0 ? (
            <div className="setting-row-desc">近 7 天暂无用量记录</div>
          ) : (
            <div className="cost-table-wrap">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th>{GROUP_TABS.find((t) => t.key === groupBy)?.label ?? '分组'}</th>
                    <th>请求</th>
                    <th>Token</th>
                    <th>成本</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.groups.map((g) => (
                    <tr key={g.key}>
                      <td className="cost-table-key" title={g.key}>
                        {g.key}
                      </td>
                      <td>{g.requests.toLocaleString()}</td>
                      <td>{formatTokens(g.totalTokens)}</td>
                      <td>{formatCost(g.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
