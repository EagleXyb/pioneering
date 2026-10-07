/**
 * HitlInlineCard 组件交互测试（T1.1 验收）
 *
 * 在 web 的 jsdom + React 19 环境中验证共享协议包的卡片渲染与交互。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HitlInlineCard } from '@pioneering/agent-protocol';

describe('HitlInlineCard — clarifying 分支', () => {
  it('输入文本并提交 → onAnswer 收到文本', () => {
    const onAnswer = vi.fn();
    render(<HitlInlineCard kind="clarifying" question="你想做什么？" onAnswer={onAnswer} />);

    const input = screen.getByLabelText('澄清回答');
    fireEvent.change(input, { target: { value: '季度销售总结' } });
    fireEvent.click(screen.getByRole('button', { name: '提交回答' }));

    expect(onAnswer).toHaveBeenCalledWith('季度销售总结');
  });

  it('空文本时提交按钮禁用', () => {
    render(<HitlInlineCard kind="clarifying" question="q" onAnswer={() => {}} />);
    expect(screen.getByRole('button', { name: '提交回答' })).toBeDisabled();
  });

  it('点击「跳过」→ onSkip 触发', () => {
    const onSkip = vi.fn();
    render(<HitlInlineCard kind="clarifying" question="q" onSkip={onSkip} />);
    fireEvent.click(screen.getByRole('button', { name: '跳过' }));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('未提供 onSkip 时不渲染跳过按钮', () => {
    render(<HitlInlineCard kind="clarifying" question="q" />);
    expect(screen.queryByRole('button', { name: '跳过' })).toBeNull();
  });
});

describe('HitlInlineCard — choice 分支', () => {
  const options = [
    { id: 'o1', label: '网页', description: '做一个网页' },
    { id: 'o2', label: '分析文档' },
  ];

  it('渲染选项，点击即答 → onSelectOption 收到 id', () => {
    const onSelectOption = vi.fn();
    render(
      <HitlInlineCard kind="choice" question="选择方向" options={options} onSelectOption={onSelectOption} />,
    );

    expect(screen.getByRole('listbox', { name: '候选方向' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /网页/ }));
    expect(onSelectOption).toHaveBeenCalledWith('o1');
  });

  it('choice 分支不渲染文本输入', () => {
    render(<HitlInlineCard kind="choice" options={options} />);
    expect(screen.queryByLabelText('澄清回答')).toBeNull();
  });
});

describe('HitlInlineCard — tool_confirm 约束（T1.2 前）', () => {
  it('不显示跳过按钮与文本输入', () => {
    render(<HitlInlineCard kind="tool_confirm" />);
    expect(screen.queryByRole('button', { name: '跳过' })).toBeNull();
    expect(screen.queryByLabelText('澄清回答')).toBeNull();
    expect(screen.getByText('需要你的确认')).toBeInTheDocument();
  });
});

describe('HitlInlineCard — 通用状态', () => {
  it('busy=true 时全部交互禁用并显示 loading', () => {
    render(
      <HitlInlineCard
        kind="clarifying"
        question="q"
        busy
        onAnswer={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByLabelText('澄清回答')).toBeDisabled();
    expect(screen.getByRole('button', { name: '提交回答' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消并中止本次执行' })).toBeDisabled();
  });

  it('显示队列序号 index/total', () => {
    render(<HitlInlineCard kind="clarifying" index={1} total={2} />);
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('error 文本展示', () => {
    render(<HitlInlineCard kind="clarifying" error="恢复失败，请重试" />);
    expect(screen.getByText('恢复失败，请重试')).toBeInTheDocument();
  });

  it('点击 X → onDismiss 触发', () => {
    const onDismiss = vi.fn();
    render(<HitlInlineCard kind="clarifying" question="q" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: '取消并中止本次执行' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe('HitlInlineCard — tool_confirm 审批分支（T1.2）', () => {
  const toolCalls = [
    { id: 'c1', name: 'code_executor', args: { cmd: 'ls' } },
    { id: 'c2', name: 'datetime_tool', args: {} },
  ];

  it('展开工具查看格式化参数', () => {
    render(<HitlInlineCard kind="tool_confirm" toolCalls={toolCalls} />);
    fireEvent.click(screen.getByRole('button', { name: /code_executor/ }));
    expect(screen.getByText(/"cmd": "ls"/)).toBeInTheDocument();
  });

  it('无改参批准 → onApprove(null)', async () => {
    const onApprove = vi.fn().mockResolvedValue(true);
    render(<HitlInlineCard kind="tool_confirm" toolCalls={toolCalls} onApprove={onApprove} />);

    fireEvent.click(screen.getByRole('button', { name: '批准并继续' }));
    expect(onApprove).toHaveBeenCalledWith(null);
  });

  it('改参后批准 → onApprove 携带按 tool_call_id 索引的 modifiedArgs', () => {
    const onApprove = vi.fn().mockResolvedValue(true);
    render(<HitlInlineCard kind="tool_confirm" toolCalls={toolCalls} onApprove={onApprove} />);

    // 展开工具 → 切换改参 → 修改 JSON
    fireEvent.click(screen.getByRole('button', { name: /code_executor/ }));
    fireEvent.click(screen.getByRole('button', { name: '修改参数' }));
    const edit = screen.getByLabelText('code_executor 修改后参数（JSON）');
    fireEvent.change(edit, { target: { value: JSON.stringify({ cmd: 'pwd' }) } });

    fireEvent.click(screen.getByRole('button', { name: '批准并继续' }));
    expect(onApprove).toHaveBeenCalledWith({ c1: { cmd: 'pwd' } });
  });

  it('JSON 非法时红字提示且禁用批准', () => {
    render(<HitlInlineCard kind="tool_confirm" toolCalls={toolCalls} />);
    fireEvent.click(screen.getByRole('button', { name: /code_executor/ }));
    fireEvent.click(screen.getByRole('button', { name: '修改参数' }));
    fireEvent.change(screen.getByLabelText('code_executor 修改后参数（JSON）'), {
      target: { value: '{not json' },
    });

    expect(screen.getByText('JSON 格式非法，请修正后再批准')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批准并继续' })).toBeDisabled();
  });

  it('拒绝：首次点击展开说明，再次点击 → onReject(feedback)', async () => {
    const onReject = vi.fn().mockResolvedValue(true);
    render(<HitlInlineCard kind="tool_confirm" toolCalls={toolCalls} onReject={onReject} />);

    fireEvent.click(screen.getByRole('button', { name: '拒绝并说明' }));
    expect(onReject).not.toHaveBeenCalled();
    const feedbackInput = await screen.findByLabelText('拒绝原因说明');
    fireEvent.change(feedbackInput, { target: { value: '参数有风险' } });
    fireEvent.click(screen.getByRole('button', { name: '拒绝并说明' }));
    expect(onReject).toHaveBeenCalledWith('参数有风险');
  });

  it('敏感工具显示高危徽标', () => {
    render(<HitlInlineCard kind="tool_confirm" toolCalls={toolCalls} sensitive />);
    expect(screen.getByText('高危操作')).toBeInTheDocument();
  });
});
