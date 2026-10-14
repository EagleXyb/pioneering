import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AgentRunData } from '../../api/agent';
import { RunTrace } from './RunTrace';
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
      {
        seq: 2,
        type: 'TOOL_CALL_START',
        ts: 2,
        toolCallName: 'search_engine',
        toolCallArgs: '{}',
      },
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
  // 重置右栏状态，避免用例间串扰
  useAppStore.setState({
    pipelineOpen: false,
    pipelineTab: 'process',
    activeRunId: null,
    pipelineUserDismissed: false,
  });
});

describe('RunTrace 操作栏轨迹胶囊', () => {
  it('展示「执行轨迹」+ 事件数与状态点，且使用 data-tooltip（无原生 title）', () => {
    const { container } = render(<RunTrace runId="run-1" initialRun={makeRun()} />);

    const btn = screen.getByRole('button');
    expect(screen.getByText('执行轨迹')).toBeInTheDocument();
    expect(screen.getByText('2 个事件')).toBeInTheDocument();
    expect(btn).toHaveClass('run-trace');
    expect(btn).toHaveClass('chat-tooltip');
    // 状态 / 耗时收进 hover 提示；不用原生 title（与操作栏其余按钮一致）
    expect(btn.getAttribute('data-tooltip')).toContain('在右侧面板查看执行轨迹');
    expect(btn.getAttribute('data-tooltip')).toContain('已完成');
    expect(btn.getAttribute('data-tooltip')).toContain('42 ms');
    expect(btn).not.toHaveAttribute('title');
    expect(container.querySelector('.run-trace-status-dot--completed')).not.toBeNull();
    // 时间轴不再内联渲染
    expect(screen.queryByText('运行开始')).not.toBeInTheDocument();
  });

  it('点击后展开右栏、切到轨迹 tab 并聚焦该 run', () => {
    render(<RunTrace runId="run-1" initialRun={makeRun()} />);

    fireEvent.click(screen.getByRole('button'));

    const s = useAppStore.getState();
    expect(s.pipelineOpen).toBe(true);
    expect(s.pipelineTab).toBe('trace');
    expect(s.activeRunId).toBe('run-1');
    // 消息内不再内联渲染时间轴
    expect(screen.queryByText('运行开始')).not.toBeInTheDocument();
  });

  it('缺失 initialRun 时按运行中缺省展示', () => {
    const { container } = render(<RunTrace runId="run-9" />);

    expect(screen.getByText('0 个事件')).toBeInTheDocument();
    expect(screen.getByRole('button').getAttribute('data-tooltip')).toContain('进行中');
    expect(container.querySelector('.run-trace-status-dot--running')).not.toBeNull();
  });
});
