import type { AgentRunEvent } from '../../api/agent';

/** run 状态 → 中文标签（消息内入口 / 右栏轨迹面板共用） */
export const RUN_STATUS_LABEL: Record<string, string> = {
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

interface Props {
  events: AgentRunEvent[];
  /** run 仍在执行：事件在收尾时才写入库，运行中列表通常为空 */
  running?: boolean;
}

/** run 事件时间轴（右栏「执行轨迹」面板）。 */
export function RunTraceTimeline({ events, running }: Props) {
  if (events.length === 0) {
    return (
      <div className="run-trace-hint">
        {running ? '执行中，事件将在本轮结束后记录' : '暂无事件记录'}
      </div>
    );
  }

  return (
    <ol className="run-trace-timeline">
      {events.map((ev) => {
        const meta = eventMeta(ev);
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
        );
      })}
    </ol>
  );
}
