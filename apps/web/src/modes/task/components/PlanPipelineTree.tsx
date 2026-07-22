import { usePlanExecuteStore } from '../../../store/planExecuteStore';
import type { PlanItem } from '../../../store/planExecuteStore';

/**
 * Plan-and-Execute 任务流水线主体组件
 *
 * 设计参考：apps/web/docs/Plan-and-Execute面板对接分析.md §3
 * 数据来源：planExecuteStore（由 usePlanExecuteChat 的 STATE_DELTA 事件驱动）
 *
 * 渲染规则：
 *   - 空态：phase='planning' 显示"正在规划任务..."，idle 显示"等待任务开始"
 *   - 有计划：渲染步骤列表 + 进度条
 *   - 步骤状态：pending(灰) / running(蓝+spinner) / done(绿+对勾) / failed(红+叉) / skipped(黄)
 */

const STATUS_CONFIG: Record<
  PlanItem['status'],
  { icon: string; className: string; label: string }
> = {
  pending: { icon: '○', className: 'plan-step--pending', label: '等待中' },
  running: { icon: '◐', className: 'plan-step--running', label: '执行中' },
  done: { icon: '✓', className: 'plan-step--done', label: '已完成' },
  failed: { icon: '✕', className: 'plan-step--failed', label: '失败' },
  skipped: { icon: '—', className: 'plan-step--skipped', label: '已跳过' },
};

export function PlanPipelineTree() {
  const items = usePlanExecuteStore((s) => s.items);
  const rootIds = usePlanExecuteStore((s) => s.rootIds);
  const phase = usePlanExecuteStore((s) => s.phase);

  const total = rootIds.length;
  const done = rootIds.filter((id) => items[id]?.status === 'done').length;
  const failed = rootIds.filter((id) => items[id]?.status === 'failed').length;
  const progress = total === 0 ? 0 : Math.round((done / total) * 100);

  // 空态
  if (total === 0) {
    return (
      <div className="plan-tree-empty">
        {phase === 'planning'
          ? '正在规划任务...'
          : phase === 'executing'
            ? '执行中...'
            : '等待任务开始'}
      </div>
    );
  }

  return (
    <div className="plan-tree">
      {/* 进度概览 */}
      <div className="plan-progress">
        <div className="plan-progress-info">
          <span className="plan-progress-count">
            {done}/{total}
          </span>
          {failed > 0 && (
            <span className="plan-progress-failed">{failed} 失败</span>
          )}
        </div>
        <div className="plan-progress-bar-bg">
          <div
            className="plan-progress-bar-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* 步骤列表 */}
      <div className="plan-steps">
        {rootIds.map((id, idx) => {
          const step = items[id];
          if (!step) return null;
          const config = STATUS_CONFIG[step.status];
          return (
            <div key={id} className={`plan-step ${config.className}`}>
              <div className="plan-step-indicator">
                <span className="plan-step-index">{idx + 1}</span>
                <span className="plan-step-icon">{config.icon}</span>
              </div>
              <div className="plan-step-content">
                <div className="plan-step-header">
                  <span className="plan-step-title">{step.title}</span>
                  <span className={`plan-step-status ${config.className}`}>
                    {config.label}
                  </span>
                </div>
                {step.description && (
                  <div className="plan-step-desc">{step.description}</div>
                )}
                {step.status === 'done' && step.result && (
                  <div className="plan-step-result">{step.result}</div>
                )}
                {step.status === 'failed' && step.error && (
                  <div className="plan-step-error">{step.error}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
