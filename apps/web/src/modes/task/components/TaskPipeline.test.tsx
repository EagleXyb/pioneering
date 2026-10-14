import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AgentRunData } from '../../../api/agent';
import { TaskPipeline } from './TaskPipeline';
import { useAppStore } from '../../../store/appStore';
import { usePlanExecuteStore } from '../../../store/planExecuteStore';

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
  usePlanExecuteStore.getState().reset();
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

  it('P0：phase=incomplete 时 badge 显示"未完成"而非"已完成"', () => {
    usePlanExecuteStore.setState({
      phase: 'incomplete',
      items: {
        s1: { step_id: 's1', title: '梳理知识框架与输出大纲', description: '', status: 'running' },
      },
      rootIds: ['s1'],
    });

    render(<TaskPipeline runs={[]} />);

    // badge（精确文本"未完成"）；汇总"已完成 0 / 1 步"不应被误认为完成徽章
    expect(screen.getByText('未完成')).toBeInTheDocument();
    expect(screen.queryByText('已完成')).not.toBeInTheDocument();
    // 面板内应出现未完成提示条
    expect(screen.getByText(/任务未执行完成/)).toBeInTheDocument();
  });

  /**
   * P0-1 回归：后端步骤级重试下发 `status: 'retrying'`。
   * 修复前 STATUS_CONFIG 无该键 → `config.className` 抛 TypeError，
   * 整个任务面板（右侧流水线）崩溃白屏。
   */
  it('P0-1：retrying 状态渲染不崩溃且展示"重试中 n/m"', () => {
    usePlanExecuteStore.setState({
      phase: 'executing',
      items: {
        s1: {
          step_id: 's1',
          title: '检索资料',
          description: '调用搜索工具获取一手资料',
          status: 'retrying',
          retry_count: 2,
          max_attempts: 3,
          error: 'search_engine 超时',
        },
      },
      rootIds: ['s1'],
    });

    render(<TaskPipeline runs={[]} />);

    expect(screen.getByText('重试中 2/3')).toBeInTheDocument();
    expect(screen.getByText('检索资料')).toBeInTheDocument();
  });

  it('P0-1：白名单外的未知状态不会击穿渲染（防御性兜底）', () => {
    usePlanExecuteStore.setState({
      phase: 'executing',
      items: {
        s1: {
          step_id: 's1',
          title: '未知状态步骤',
          description: '',
          status: 'brand-new-status' as never,
        },
      },
      rootIds: ['s1'],
    });

    expect(() => render(<TaskPipeline runs={[]} />)).not.toThrow();
    expect(screen.getByText('未知状态步骤')).toBeInTheDocument();
  });
});
