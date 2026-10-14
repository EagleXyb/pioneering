import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AgentRunData } from '../../../api/agent';
import { TaskPipeline } from './TaskPipeline';
import { useAppStore } from '../../../store/appStore';

function makeRun(over: Partial<AgentRunData> = {}): AgentRunData {
  return {
    id: 'run-1',
    sessionId: 'sess-1',
    messageId: 'msg-1',
    agentMode: 'plan_execute',
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
  useAppStore.setState({
    pipelineOpen: true,
    pipelineTab: 'process',
    activeRunId: null,
    pipelineUserDismissed: false,
  });
});

describe('TaskPipeline 右栏 tab', () => {
  it('默认任务流水线 tab，badge 可见', () => {
    render(<TaskPipeline runs={[]} />);

    expect(screen.getByRole('tab', { name: '任务流水线' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('待机')).toBeInTheDocument();
  });

  it('切到执行轨迹 tab：写入 store、展示轨迹面板并隐藏流水线 badge', () => {
    render(<TaskPipeline runs={[]} />);

    fireEvent.click(screen.getByRole('tab', { name: '执行轨迹' }));

    expect(useAppStore.getState().pipelineTab).toBe('trace');
    expect(screen.getByText('暂无执行记录')).toBeInTheDocument();
    expect(screen.queryByText('待机')).not.toBeInTheDocument();
  });

  it('执行轨迹 tab 展示传入的 runs', () => {
    useAppStore.setState({ pipelineTab: 'trace' });

    render(<TaskPipeline runs={[makeRun()]} />);

    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('2 个事件')).toBeInTheDocument();
  });
});
