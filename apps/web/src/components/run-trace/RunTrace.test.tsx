import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { AgentRunData } from '../../api/agent';
import { RunTrace } from './RunTrace';

// mock 懒加载 API（vi.hoisted 避免 hoist 导致的 TDZ）
const { getAgentRun } = vi.hoisted(() => ({ getAgentRun: vi.fn() }))
vi.mock('../../api/agent', async () => {
  const actual = await vi.importActual<typeof import('../../api/agent')>(
    '../../api/agent',
  );
  return { ...actual, getAgentRun };
});

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
  vi.clearAllMocks();
});

describe('RunTrace', () => {
  it('折叠态显示标题 / 状态徽章 / 事件数 / 耗时', () => {
    render(<RunTrace runId="run-1" initialRun={makeRun()} />);

    expect(screen.getByText('执行轨迹')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('2 个事件')).toBeInTheDocument();
    expect(screen.getByText('42 ms')).toBeInTheDocument();
    // 时间轴未展开
    expect(screen.queryByText('运行开始')).not.toBeInTheDocument();
  });

  it('有 initialRun：展开直接渲染中文化事件，不触发请求', () => {
    render(<RunTrace runId="run-1" initialRun={makeRun()} />)

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('运行开始')).toBeInTheDocument()
    expect(screen.getByText(/调用工具/)).toBeInTheDocument()
    expect(screen.getByText(/search_engine/)).toBeInTheDocument()
    expect(getAgentRun).not.toHaveBeenCalled()
  })

  it('无 initialRun：展开时按 runId 懒加载', async () => {
    getAgentRun.mockResolvedValue(makeRun())
    render(<RunTrace runId="run-1" />)

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(getAgentRun).toHaveBeenCalledWith('run-1'))
    expect(await screen.findByText('运行开始')).toBeInTheDocument()
  })

  it('懒加载失败显示错误信息', async () => {
    getAgentRun.mockRejectedValue(new Error('网络错误'))
    render(<RunTrace runId="run-1" />)

    fireEvent.click(screen.getByRole('button'))

    expect(await screen.findByText('网络错误')).toBeInTheDocument()
  })
})
