import { usePlanExecuteStore } from '../../../store/planExecuteStore';
import type { PlanItem } from '../../../store/planExecuteStore';
import { AlertTriangle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { StepStatusGlyph } from '@/components/icons/customIcons';

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
 *   - 折叠策略：
 *       1. 用户手动折叠/展开优先级最高（存储在 collapsedSteps 中）
 *       2. 执行中（存在 running 步骤）：仅 running / failed 步骤展开，已完成的自动折叠
 *       3. 全部完成后：仅第一步保持展开，其余折叠
 */

const STATUS_CONFIG: Record<
  PlanItem['status'],
  { className: string; label: string }
> = {
  pending: { className: 'timeline-item--pending', label: '等待中' },
  running: { className: 'timeline-item--running', label: '执行中' },
  // P0-1：步骤级重试的中间态（后端 step_finalize retry 分支下发），
  // 此前未登记导致 STATUS_CONFIG 查表落空 → config.className 抛 TypeError 面板崩溃
  retrying: { className: 'timeline-item--retrying', label: '重试中' },
  done: { className: 'timeline-item--done', label: '已完成' },
  failed: { className: 'timeline-item--failed', label: '失败' },
  skipped: { className: 'timeline-item--skipped', label: '已跳过' },
};

/** 兜底配置：store 已做状态归一化，这里再兜一层，确保任何意外状态都不会击穿渲染 */
const STATUS_FALLBACK = STATUS_CONFIG.pending;

/**
 * 判断步骤是否应展开。
 *
 * 优先级：用户手动折叠/展开 > 阶段自动策略
 *
 * 自动策略分两种模式：
 *   - 执行中（存在 running 步骤）：仅 running / failed 步骤展开，已完成步骤自动折叠
 *   - 全部完成（无 running 步骤）：仅第一步展开，其余折叠
 */
function isStepExpanded(
  step: PlanItem,
  userCollapsed: Record<string, boolean>,
  index: number,
  allCompleted: boolean,
): boolean {
  if (userCollapsed[step.step_id] !== undefined) {
    return !userCollapsed[step.step_id];
  }
  if (allCompleted) {
    return index === 0;
  }
  return step.status === 'running' || step.status === 'retrying' || step.status === 'failed';
}

/**
 * 从 step.result 字符串中提取人类可读的结果摘要。
 *
 * 后端 step_update.result 可能是：
 *   - 纯文本（直接展示）
 *   - JSON 对象字符串（如 {"action":"step_1","result":"..."}，需提取 result 字段）
 *   - JSON 数组（工具调用结果数组）
 *
 * 策略：尝试 JSON.parse，成功则提取有意义字段，失败则原样返回。
 */
function extractStepResult(raw: string): string {
  if (!raw) return '';
  // 短文本直接返回
  if (raw.length < 20 && !raw.startsWith('{') && !raw.startsWith('[')) {
    return raw;
  }
  try {
    const parsed = JSON.parse(raw);
    // 对象：优先提取 result / output / content / text 字段
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, any>;
      const candidates = ['result', 'output', 'content', 'text', 'answer', 'summary', 'description'];
      for (const key of candidates) {
        if (typeof obj[key] === 'string' && obj[key].trim()) {
          return obj[key];
        }
      }
      // fallback：如果只有一个字符串值字段，用它
      const strValues = Object.values(obj).filter(
        (v) => typeof v === 'string' && v.length > 5 && !v.startsWith('step_'),
      ) as string[];
      if (strValues.length > 0) {
        return strValues[0];
      }
      return raw;
    }
    // 数组：拼接各元素的 result/content 字段
    if (Array.isArray(parsed)) {
      const parts: string[] = [];
      for (const item of parsed) {
        if (typeof item === 'string') {
          parts.push(item);
        } else if (item && typeof item === 'object') {
          const obj = item as Record<string, any>;
          if (typeof obj.result === 'string') parts.push(obj.result);
          else if (typeof obj.content === 'string') parts.push(obj.content);
          else if (typeof obj.text === 'string') parts.push(obj.text);
          else if (typeof obj.output === 'string') parts.push(obj.output);
        }
      }
      return parts.join('\n') || raw;
    }
    return raw;
  } catch {
    return raw;
  }
}

function StatusDot({ status }: { status: PlanItem['status'] }) {
  // P0-1：retrying（步骤级重试中间态）同样是"进行中"，复用 spinner 形态，
  // 颜色由 .timeline-item--retrying 区分（琥珀 vs 蓝）
  if (status === 'running' || status === 'retrying') {
    return <div className="timeline-dot-spinner" />;
  }
  if (status === 'pending') {
    return null;
  }
  return <StepStatusGlyph status={status} />;
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
  const config = STATUS_CONFIG[step.status] ?? STATUS_FALLBACK;
  const headerId = `timeline-header-${step.step_id}`;
  const bodyId = `timeline-body-${step.step_id}`;
  // 首步不画上半段连线，末项不画下半段连线，中间项上下都画
  const showTopLine = index !== 0;
  const showBottomLine = !isLast;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <div className={`timeline-item ${config.className}${expanded ? ' is-expanded' : ''}`}>
      <div className="timeline-indicator">
        {showTopLine && <div className="timeline-line timeline-line--top" />}
        <div className="timeline-dot">
          <StatusDot status={step.status} />
        </div>
        {showBottomLine && <div className="timeline-line timeline-line--bottom" />}
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
            <span className="timeline-title-text">{step.title}</span>
          </span>
          <div className="timeline-header-right">
            {/* P0-1：重试中间态展示"重试中 n/m"，让用户知道步骤在重试而非卡死 */}
            {step.status === 'retrying' && (
              <span className="timeline-progress-badge">
                重试中
                {typeof step.retry_count === 'number' && step.retry_count > 0
                  ? ` ${step.retry_count}/${step.max_attempts ?? step.retry_count}`
                  : ''}
              </span>
            )}
            {/* P3 修复：原 "(n/N)" 形似进度且易被读作"已完成 n 项"，改为中性的步骤序号文案 */}
            <span className="timeline-progress-badge">
              第 {index + 1} / {total} 步
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
          {/* P0-3：skipped 步骤同样展示原因（后端把跳过理由放在 result 字段） */}
          {(step.status === 'done' || step.status === 'skipped') && step.result && (
            <div className="timeline-result">{extractStepResult(step.result)}</div>
          )}
          {step.status === 'failed' && step.error && (
            <div className="timeline-error">{step.error}</div>
          )}
          {/* P2-4：输出被模型长度上限截断 → 提示内容可能不完整 */}
          {step.truncated && (
            <div className="timeline-error">
              ⚠ 本步输出因模型单次长度上限被截断，内容可能不完整（可缩小步骤范围后重试）
            </div>
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
  const error = usePlanExecuteStore((s) => s.error);
  // P1-4：计划级提示（如计划被步骤上限截断）
  const planWarning = usePlanExecuteStore((s) => s.planWarning);
  const collapsedSteps = usePlanExecuteStore((s) => s.collapsedSteps);
  const toggleStep = usePlanExecuteStore((s) => s.toggleStep);
  // 数据来源标记：history 时禁用 running 脉冲动画，保证历史展示与初次生成像素级一致
  const source = usePlanExecuteStore((s) => s.source);

  const total = rootIds.length;
  const done = rootIds.filter((id) => items[id]?.status === 'done').length;
  const failed = rootIds.filter((id) => items[id]?.status === 'failed').length;

  const allCompleted =
    total > 0 &&
    rootIds.every((id) => {
      const s = items[id];
      return s && (s.status === 'done' || s.status === 'failed' || s.status === 'skipped');
    });

  if (total === 0) {
    // 失败状态优先显示错误信息
    if (phase === 'error') {
      return (
        <div className="timeline-empty timeline-empty--error">
          {/* strokeWidth 3：对齐原粗体 ✕ 字形的视觉重量（字号 14px / font-weight 700） */}
          <div className="timeline-empty-icon">
            <X size={16} strokeWidth={3} />
          </div>
          <div className="timeline-empty-title">任务失败</div>
          {error && <div className="timeline-empty-detail">{error}</div>}
        </div>
      );
    }
    // P2-3：规划失败降级为直答时，面板需说清"为什么没有步骤"
    if (planWarning) {
      return (
        <div className="timeline-empty timeline-empty--warning">
          <div className="timeline-empty-icon">
            <AlertTriangle size={16} />
          </div>
          <div className="timeline-empty-title">未按计划执行</div>
          <div className="timeline-empty-detail">{planWarning}</div>
        </div>
      );
    }
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
    <div className="timeline-tree" data-source={source}>
      <div className="timeline-summary">
        <span className="timeline-summary-text">
          已完成 <strong>{done}</strong> / {total} 步
        </span>
        {failed > 0 && (
          <span className="timeline-summary-failed">{failed} 失败</span>
        )}
      </div>

      {/* P0 修复：流结束但仍有未完成步骤——显式提示，避免"已完成"假成功 */}
      {phase === 'incomplete' && (
        <div className="timeline-global-warning">
          <AlertTriangle
            size={14}
            className="timeline-global-warning-icon"
            aria-hidden="true"
          />
          <span className="timeline-global-warning-text">
            任务未执行完成（流程已结束，仍有步骤未执行）
          </span>
        </div>
      )}

      {/* 全局错误信息（plan 已收到但后续执行失败） */}
      {phase === 'error' && error && (
        <div className="timeline-global-error">
          <X size={14} strokeWidth={3} className="timeline-global-error-icon" />
          <span className="timeline-global-error-text">{error}</span>
        </div>
      )}

      {/* P1-4：计划被步骤上限截断的提示（此前静默丢步，用户无从得知） */}
      {planWarning && (
        <div className="timeline-global-warning">
          <AlertTriangle
            size={14}
            className="timeline-global-warning-icon"
            aria-hidden="true"
          />
          <span className="timeline-global-warning-text">{planWarning}</span>
        </div>
      )}

      <div className="timeline-list">
        {rootIds.map((id, idx) => {
          const step = items[id];
          if (!step) return null;
          const expanded = isStepExpanded(step, collapsedSteps, idx, allCompleted);
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
