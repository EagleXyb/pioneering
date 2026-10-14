/**
 * TaskInput 发送后清空输入框 —— 回归测试（2026-10-14）
 *
 * 缺陷（修复前）：发送按钮 onClick 直接调用 composeSend(value)，绕过了
 * useTaskInput.handleSend 中唯一的 setValue('') 清空逻辑——消息成功发出后
 * 输入框文本残留，用户误以为"消息没发出去"（截图反馈）。
 * 对照：chat 模式 dispatchSend / pro 模式 dispatchSend 均包含 setValue('')。
 *
 * 修复：composeSend 返回发送结果；按钮路径发送成功后才清空输入框。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskInput } from './TaskInput';

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({
  toast: { error: toastError },
}));

const attachState = vi.hoisted(() => ({ hasPending: false }));
vi.mock('@/hooks/useAttachments', () => ({
  useAttachments: () => ({
    attachments: [],
    hasPending: attachState.hasPending,
    addFiles: vi.fn(),
    removeAttachment: vi.fn(),
    takeMessageSuffix: () => '',
  }),
}));

// 与本用例无关的重组件替换为占位（避免挂载即请求/渲染开销）
vi.mock('@/components/ModelSelect/ModelSelect', () => ({
  ModelSelect: () => <div data-testid="model-select" />,
}));
vi.mock('@/components/CapabilityBar/CapabilityBar', () => ({
  CapabilityBar: () => <div data-testid="capability-bar" />,
}));

function getTextarea(): HTMLTextAreaElement {
  return screen.getByLabelText('任务输入框') as HTMLTextAreaElement;
}

describe('TaskInput 发送后清空输入框', () => {
  beforeEach(() => {
    attachState.hasPending = false;
    toastError.mockClear();
  });

  it('点击发送按钮：消息发出且输入框清空（修复点）', () => {
    const onSend = vi.fn();
    render(<TaskInput chatId="s1" status="idle" onSend={onSend} onStop={vi.fn()} />);

    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: '生成一份报告' } });
    fireEvent.click(screen.getByLabelText('发送'));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('生成一份报告');
    expect(ta.value).toBe('');
  });

  it('按 Enter：发送并清空（原有行为不回归）', () => {
    const onSend = vi.fn();
    render(<TaskInput chatId="s2" status="idle" onSend={onSend} onStop={vi.fn()} />);

    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: '按回车发送' } });
    fireEvent.keyDown(ta, { key: 'Enter', keyCode: 13 });

    expect(onSend).toHaveBeenCalledWith('按回车发送');
    expect(ta.value).toBe('');
  });

  it('附件仍在上传时点击发送：不发送、保留输入并提示', () => {
    attachState.hasPending = true;
    const onSend = vi.fn();
    render(<TaskInput chatId="s3" status="idle" onSend={onSend} onStop={vi.fn()} />);

    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: '按钮路径' } });
    fireEvent.click(screen.getByLabelText('发送'));

    expect(toastError).toHaveBeenCalledWith('附件仍在上传，请稍候');
    expect(onSend).not.toHaveBeenCalled();
    expect(ta.value).toBe('按钮路径');
  });
});
