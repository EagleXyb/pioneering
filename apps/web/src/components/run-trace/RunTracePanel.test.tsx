import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AgentRunData } from '../../api/agent';
import { RunTracePanel } from './RunTracePanel';
import { useAppStore } from '../../store/appStore';

function makeRun(over: Partial<AgentRunData> = {}): AgentRunData {
  return {
    id: 'run-1',
    sessionId: 'sess-1',
    messageId: 'msg-1',
    agentMode: 'react_agent',
    status: 'completed',
    traceId: 'run-1',
    events: [
      { seq: 1, type: 'RUN_STARTED', ts: 1 },
      { seq: 2, type: 'RUN_FINISHED', ts: 2 },
    ],
    usage: null,
    errorCode: null,
    errorMessage: null,
    startedAt: new Date(0).toISOString(),
    endedAt: null,
    durationMs: 42,
    ...over,
  };
}

beforeEach(() => {
  useAppStore.setState({ activeRunId: null });
});

describe('RunTracePanel', () => {
  it('无 run 时显示空态', () => {
    render(<RunTracePanel runs={[]} />);

    expect(screen.getByText('暂无执行记录')).toBeInTheDocument();
  });

  it('自动跟随最新一条（runs 按 startedAt desc）', () => {
    const latest = makeRun({
      id: 'run-2',
      events: [{ seq: 1, type: 'RUN_FINISHED', ts: 2 }],
    });
    const older = makeRun({ id: 'run-1' });

    render(<RunTracePanel runs={[latest, older]} />);

    expect(screen.getByText('运行完成')).toBeInTheDocument();
    expect(screen.queryByText('运行开始')).not.toBeInTheDocument();
  });

  it('存在 running 的 run 时优先跟随（即使不是列表首条）', () => {
    const done = makeRun({ id: 'run-2', status: 'completed' });
    const running = makeRun({ id: 'run-1', status: 'running', events: [] });

    render(<RunTracePanel runs={[done, running]} />);

    expect(screen.getByText('进行中')).toBeInTheDocument();
    expect(screen.getByText('执行中，事件将在本轮结束后记录')).toBeInTheDocument();
  });

  it('activeRunId 命中时锁定展示指定 run', () => {
    useAppStore.setState({ activeRunId: 'run-1' });
    const latest = makeRun({ id: 'run-2', events: [{ seq: 1, type: 'RUN_FINISHED', ts: 2 }] });
    const old = makeRun({
      id: 'run-1',
      events: [
        { seq: 1, type: 'TOOL_CALL_START', ts: 1, toolCallName: 'kb_search' },
      ],
    });

    render(<RunTracePanel runs={[latest, old]} />);

    expect(screen.getByText(/调用工具/)).toBeInTheDocument();
    expect(screen.getByText(/kb_search/)).toBeInTheDocument();
    expect(screen.queryByText('运行完成')).not.toBeInTheDocument();
  });

  it('activeRunId 未命中（已被清理 / 跨会话残留）时回退到跟随', () => {
    useAppStore.setState({ activeRunId: 'missing' });

    render(<RunTracePanel runs={[makeRun()]} />);

    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('2 个事件')).toBeInTheDocument();
  });

  it('展示概要行：状态徽章 / 事件数 / 耗时', () => {
    render(<RunTracePanel runs={[makeRun({ durationMs: 15275 })]} />);

    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('2 个事件')).toBeInTheDocument();
    expect(screen.getByText('15275 ms')).toBeInTheDocument();
  });
});
