import type { AgentRunData } from '../../api/agent';
import { useAppStore } from '../../store/appStore';
import { RUN_STATUS_LABEL } from './RunTraceTimeline';
import './RunTrace.css';

interface Props {
  runId: string;
  initialRun?: AgentRunData;
}

/**
 * 消息操作栏内的「执行轨迹」胶囊入口（pro / task 共用）：
 * 对齐 chat 模式「N 篇来源」的呈现范式（状态点 + 文案 + 数量，行内右端靠齐）。
 * 点击后在右侧面板展开并切到「执行轨迹」tab 聚焦该 run 的事件时间轴；
 * 状态与耗时收进 hover 提示（chat-tooltip，不用原生 title）。
 */
export function RunTrace({ runId, initialRun }: Props) {
  const openRunTrace = useAppStore((s) => s.openRunTrace);

  const status = initialRun?.status ?? 'running';
  const events = initialRun?.events ?? [];
  const statusLabel = RUN_STATUS_LABEL[status] ?? status;
  const tooltip =
    `在右侧面板查看执行轨迹（${statusLabel}` +
    (initialRun?.durationMs != null ? `，耗时 ${initialRun.durationMs} ms` : '') +
    '）';

  return (
    <button
      type="button"
      className="run-trace chat-tooltip"
      data-tooltip={tooltip}
      onClick={() => openRunTrace(runId)}
    >
      <span
        className={`run-trace-status-dot run-trace-status-dot--${status}`}
        aria-hidden="true"
      />
      <span className="run-trace-label">执行轨迹</span>
      <span className="run-trace-count">{events.length} 个事件</span>
    </button>
  );
}
