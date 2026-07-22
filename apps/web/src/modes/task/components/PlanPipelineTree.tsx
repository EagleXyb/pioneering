import { usePlanExecuteStore } from '../../../store/planExecuteStore';
import type { PlanItem } from '../../../store/planExecuteStore';
import { ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Plan-and-Execute 任务流水线主体组件（时间轴样式）
 *
 * 设计参考：apps/desktop/codewiki/08-task-pipeline-timeline-ui.md
 * 数据来源：planExecuteStore（由 usePlanExecuteChat 的 STATE_DELTA 事件驱动）
 *
 * 渲染规则：
 *   - 空态：phase='planning' 显示"正在规划任务..."，idle 显示"等待任务开始"
 *   - 有计划：时间轴列表 + 步骤折叠面板
 *   - 步骤状态：pending(灰) / running(蓝+脉冲) / done(绿+对勾) / failed(红+叉) / skipped(黄)
 *   - 默认折叠策略：running/failed 默认展开，其他默认折叠
 */

const STATUS_CONFIG: Record<
  PlanItem['status'],
  { className: string; label: string }
> = {
  pending: { className: 'timeline-item--pending', label: '等待中' },
  running: { className: 'timeline-item--running', label: '执行中' },
  done: { className: 'timeline-item--done', label: '已完成' },
  failed: { className: 'timeline-item--failed', label: '失败' },
  skipped: { className: 'timeline-item--skipped', label: '已跳过' },
};

/** 判断步骤是否应展开：用户手动设置优先，否则按默认策略 */
function isStepExpanded(
  step: PlanItem,
  userCollapsed: Record<string, boolean>,
): boolean {
  if (userCollapsed[step.step_id] !== undefined) {
    return !userCollapsed[step.step_id];
  }
  return step.status === 'running' || step.status === 'failed';
}

function StatusDot({ status }: { status: PlanItem['status'] }) {
  if (status === 'done') {
    return (
      <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 7l3 3 5-5" />
      </svg>
    );
  }
  if (status === 'failed') {
    return (
      <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 4l6 6M10 4l-6 6" />
      </svg>
    );
  }
  if (status === 'skipped') {
    return (
      <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 7h8" />
      </svg>
    );
  }
  if (status === 'running') {
    return <div className="timeline-dot-spinner" />;
  }
  return null;
}

interface TimelineItemProps {
  step: PlanItem;
  index: number;
  total: number;
  isLast: boolean;
  expanded: boolean;
  onToggle: () => void;
}

function TimelineItem({ step, index, total, isLast, expanded, onToggle }: TimelineItemProps) {
  const config = STATUS_CONFIG[step.status];
  const headerId = `timeline-header-${step.step_id}`;
  const bodyId = `timeline-body-${step.step_id}`;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <div className={`timeline-item ${config.className}${expanded ? ' is-expanded' : ''}`}>
      <div className="timeline-indicator">
        {!isLast && <div className="timeline-line timeline-line--top" />}
        <div className="timeline-dot">
          <StatusDot status={step.status} />
        </div>
        {!isLast && <div className="timeline-line timeline-line--bottom" />}
      </div>

      <div className="timeline-content">
        <div
          className="timeline-header"
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-controls={bodyId}
          id={headerId}
          onClick={onToggle}
          onKeyDown={handleKeyDown}
        >
          <span className="timeline-title">
            <span className="timeline-index">{index + 1}.</span>
            {step.title}
          </span>
          <div className="timeline-header-right">
            <span className="timeline-progress-badge">
              ({index + 1}/{total})
            </span>
            <span className="timeline-chevron">
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </div>
        </div>

        <div
          className="timeline-body"
          id={bodyId}
          aria-labelledby={headerId}
        >
          {step.description && (
            <div className="timeline-desc">{step.description}</div>
          )}
          {step.status === 'done' && step.result && (
            <div className="timeline-result">{step.result}</div>
          )}
          {step.status === 'failed' && step.error && (
            <div className="timeline-error">{step.error}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function PlanPipelineTree() {
  const items = usePlanExecuteStore((s) => s.items);
  const rootIds = usePlanExecuteStore((s) => s.rootIds);
  const phase = usePlanExecuteStore((s) => s.phase);
  const collapsedSteps = usePlanExecuteStore((s) => s.collapsedSteps);
  const toggleStep = usePlanExecuteStore((s) => s.toggleStep);

  const total = rootIds.length;
  const done = rootIds.filter((id) => items[id]?.status === 'done').length;
  const failed = rootIds.filter((id) => items[id]?.status === 'failed').length;

  if (total === 0) {
    return (
      <div className="timeline-empty">
        {phase === 'planning'
          ? '正在规划任务...'
          : phase === 'executing'
            ? '执行中...'
            : '等待任务开始'}
      </div>
    );
  }

  return (
    <div className="timeline-tree">
      <div className="timeline-summary">
        <span className="timeline-summary-text">
          已完成 <strong>{done}</strong> / {total} 步
        </span>
        {failed > 0 && (
          <span className="timeline-summary-failed">{failed} 失败</span>
        )}
      </div>

      <div className="timeline-list">
        {rootIds.map((id, idx) => {
          const step = items[id];
          if (!step) return null;
          const expanded = isStepExpanded(step, collapsedSteps);
          return (
            <TimelineItem
              key={id}
              step={step}
              index={idx}
              total={total}
              isLast={idx === rootIds.length - 1}
              expanded={expanded}
              onToggle={() => toggleStep(id)}
            />
          );
        })}
      </div>
    </div>
  );
}
