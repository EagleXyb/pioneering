import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProcessPanel } from './ProcessPanel';
import { useAppStore } from '../../../store/appStore';

beforeEach(() => {
  useAppStore.setState({
    pipelineOpen: true,
    pipelineTab: 'process',
    activeRunId: null,
    pipelineUserDismissed: false,
  });
});

describe('ProcessPanel（pro 右栏）', () => {
  it('默认展示推理过程 tab（空态）', () => {
    render(<ProcessPanel stateMap={{}} currentStateKey={null} runs={[]} />);

    expect(screen.getByRole('tab', { name: '推理过程' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('等待分析开始')).toBeInTheDocument();
  });

  it('stateMap 步骤渲染为时间线', () => {
    render(
      <ProcessPanel
        stateMap={{ step1: { type: 'tool', label: '检索资料' } }}
        currentStateKey={null}
        runs={[]}
      />,
    );

    expect(screen.getByText('检索资料')).toBeInTheDocument();
  });

  it('切到执行轨迹 tab：写入 store 并渲染 RunTracePanel', () => {
    render(<ProcessPanel stateMap={{}} currentStateKey={null} runs={[]} />);

    fireEvent.click(screen.getByRole('tab', { name: '执行轨迹' }));

    expect(useAppStore.getState().pipelineTab).toBe('trace');
    expect(screen.getByText('暂无执行记录')).toBeInTheDocument();
    expect(screen.queryByText('等待分析开始')).not.toBeInTheDocument();
  });

  it('折叠按钮切换 pipelineOpen', () => {
    render(<ProcessPanel stateMap={{}} currentStateKey={null} runs={[]} />);

    fireEvent.click(screen.getByRole('button', { name: '收起推理面板' }));

    expect(useAppStore.getState().pipelineOpen).toBe(false);
  });
});
