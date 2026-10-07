import { useState } from 'react';
import type { AgentRunData, AgentRunEvent } from '../../api/agent';
import { getAgentRun } from '../../api/agent';
import './RunTrace.css';

interface Props {
  runId: string;
  initialRun?: AgentRunData;
}

const STATUS_LABEL: Record<AgentRunData['status'], string> = {
  running: '进行中',
  completed: '已完成',
  error: '出错',
  cancelled: '已取消',
  paused: '待审批',
};

/** 事件 → 中文标签 / 细节 / 色调 */
function eventMeta(ev: AgentRunEvent): {
  label: string;
  detail?: string;
  tone: string;
} {
  switch (ev.type) {
    case 'RUN_STARTED':
      return { label: '运行开始', tone: 'neutral' };
    case 'RUN_FINISHED':
      return { label: '运行完成', tone: 'ok' };
    case 'RUN_ERROR':
      return {
        label: `运行错误${ev.code ? ` · ${ev.code}` : ''}`,
        detail: ev.message,
        tone: 'err',
      };
    case 'RUN_PAUSED':
      return { label: '暂停，等待审批', tone: 'warn' };
    case 'HITL_ABORTED':
      return {
        label: `已中止${ev.reason ? ` · ${ev.reason}` : ''}`,
        tone: 'warn',
      };
    case 'TEXT_MESSAGE_START':
      return { label: '开始生成回复', tone: 'neutral' };
    case 'TEXT_MESSAGE_END':
      return { label: '回复生成结束', tone: 'neutral' };
    case 'THINKING_START':
      return { label: '开始思考', tone: 'think' };
    case 'THINKING_END':
      return { label: '思考结束', tone: 'think' };
    case 'TOOL_CALL_START':
      return {
        label: `调用工具${ev.toolCallName ? ` · ${ev.toolCallName}` : ''}`,
        detail: ev.toolCallArgs ?? ev.args,
        tone: 'tool',
      };
    case 'TOOL_CALL_RESULT':
      return { label: '工具返回', detail: ev.content, tone: 'tool' };
    case 'STATE_DELTA': {
      const extra =
        ev.phase === 'plan'
          ? `计划${ev.planCount ? ` · ${ev.planCount} 步` : ''}`
          : ev.phase === 'execute'
            ? '执行步骤更新'
            : ev.phase ?? '';
      return {
        label: `状态更新${extra ? ` · ${extra}` : ''}`,
        tone: 'state',
      };
    }
    case 'STEP_FINISHED':
      return { label: '步骤完成', detail: ev.content, tone: 'state' };
    default:
      return { label: ev.type, tone: 'neutral' };
  }
}

/** 可折叠的 Agent 执行轨迹（事件时间轴），pro / task 共用。 */
export function RunTrace({ runId, initialRun }: Props) {
  const [open, setOpen] = useState(false);
  const [run, setRun] = useState<AgentRunData | undefined>(initialRun);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && (!run || run.events.length === 0)) {
      setLoading(true);
      setLoadError(null);
      try {
        setRun(await getAgentRun(runId));
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    }
  };

  const status = run?.status ?? 'running';
  const events = run?.events ?? [];

  return (
    <div className={`run-trace run-trace-${status}`}>
      <button
        type="button"
        className="run-trace-toggle"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="run-trace-chevron">{open ? '▾' : '▸'}</span>
        <span className="run-trace-title">执行轨迹</span>
        <span className={`run-trace-badge run-trace-badge-${status}`}>
          {STATUS_LABEL[status]}
        </span>
        <span className="run-trace-count">{events.length} 个事件</span>
        {run?.durationMs != null && (
          <span className="run-trace-duration">{run.durationMs} ms</span>
        )}
      </button>

      {open && (
        <div className="run-trace-body">
          {loading && <div className="run-trace-hint">加载中…</div>}
          {loadError && (
            <div className="run-trace-hint run-trace-hint-err">
              {loadError}
            </div>
          )}
          {!loading && events.length === 0 && (
            <div className="run-trace-hint">暂无事件记录</div>
          )}
          <ol className="run-trace-timeline">
            {events.map((ev) => {
              const meta = eventMeta(ev)
              return (
                <li key={ev.seq} className="run-trace-item">
                  <span className={`run-trace-dot run-trace-dot-${meta.tone}`} />
                  <div className="run-trace-item-body">
                    <span className="run-trace-item-label">
                      <span className="run-trace-seq">#{ev.seq}</span>
                      {meta.label}
                    </span>
                    {meta.detail && (
                      <code className="run-trace-item-detail">{meta.detail}</code>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
