import { useMemo } from 'react';
import type { AgentRunData } from '../../api/agent';
import { useAppStore } from '../../store/appStore';
import { formatMessageTime } from '../../lib/formatTime';
import { EmptyStateGlyph } from '../icons/emptyStateGlyph';
import { RUN_STATUS_LABEL, RunTraceTimeline } from './RunTraceTimeline';
import './RunTrace.css';

interface Props {
  /** 当前会话全部 runs（listAgentRuns 数据，按 startedAt desc） */
  runs: AgentRunData[];
}

/**
 * 右侧面板「执行轨迹」tab 内容（pro / task 共用）。
 *
 * 聚焦规则：
 * - activeRunId（点击消息内入口锁定）存在且命中 → 展示该条；
 * - 否则自动跟随：正在执行的 run 优先，其次最新一条（runs 已按 startedAt desc）；
 * - 新一轮开始 / 会话切换时 appStore 清除锁定（resetPipelineForSession），回到跟随。
 */
export function RunTracePanel({ runs }: Props) {
  const activeRunId = useAppStore((s) => s.activeRunId);

  const focus = useMemo(() => {
    if (activeRunId) {
      const locked = runs.find((r) => r.id === activeRunId);
      if (locked) return locked;
    }
    return runs.find((r) => r.status === 'running') ?? runs[0] ?? null;
  }, [runs, activeRunId]);

  if (!focus) {
    return (
      <div className="run-trace-panel">
        <div className="run-trace-empty">
          <EmptyStateGlyph variant="process" size={32} />
          <div className="run-trace-empty-text">暂无执行记录</div>
          <div className="run-trace-empty-desc">Agent 每次执行后，事件时间轴将在这里展示</div>
        </div>
      </div>
    );
  }

  const startedAt = formatMessageTime(focus.startedAt);

  return (
    <div className="run-trace-panel">
      <div className="run-trace-panel-meta">
        <span className={`run-trace-badge run-trace-badge-${focus.status}`}>
          {RUN_STATUS_LABEL[focus.status] ?? focus.status}
        </span>
        {startedAt && <span className="run-trace-panel-time">{startedAt}</span>}
        <span className="run-trace-panel-stats">
          <span className="run-trace-count">{focus.events.length} 个事件</span>
          {focus.durationMs != null && (
            <span className="run-trace-duration">{focus.durationMs} ms</span>
          )}
        </span>
      </div>
      <div className="run-trace-panel-body">
        <RunTraceTimeline
          events={focus.events}
          running={focus.status === 'running'}
        />
      </div>
    </div>
  );
}
