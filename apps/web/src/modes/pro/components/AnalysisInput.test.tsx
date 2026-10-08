/**
 * AnalysisInput —— 发送拦截时的输入保留回归测试
 *
 * 缺陷（修复前）：dispatchSend 在「附件仍在上传」时提前 return，但
 * useTaskInput.handleSend 仍无条件 setValue('') + 删除草稿，
 * 导致用户按 Enter 后 toast 提示了、消息没发出去、已输入的文本却被静默清空。
 *
 * 修复：onSend 返回 false 表示发送被拦截，useTaskInput 保留输入与草稿。
 * 本测试同时锁定「正常路径行为不变」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnalysisInput } from './AnalysisInput';

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

// ModelSelect 挂载即请求 /system/models，与本用例无关，替换为占位组件
vi.mock('@/components/ModelSelect/ModelSelect', () => ({
  ModelSelect: () => <div data-testid="model-select" />,
}));

function getTextarea(): HTMLTextAreaElement {
  return screen.getByLabelText('分析输入框') as HTMLTextAreaElement;
}

describe('AnalysisInput 发送拦截时的输入保留', () => {
  beforeEach(() => {
    attachState.hasPending = false;
    toastError.mockClear();
  });

  it('附件仍在上传时按 Enter：不发送、不清空输入，并给出提示', () => {
    attachState.hasPending = true;
    const onSend = vi.fn();
    render(<AnalysisInput chatId="s1" status="idle" onSend={onSend} onStop={vi.fn()} />);

    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: '帮我分析这段内容' } });
    fireEvent.keyDown(ta, { key: 'Enter', keyCode: 13 });

    expect(toastError).toHaveBeenCalledWith('附件仍在上传，请稍候');
    expect(onSend).not.toHaveBeenCalled();
    expect(ta.value).toBe('帮我分析这段内容');
  });

  it('无附件时按 Enter：正常发送并清空输入（原有行为不变）', () => {
    const onSend = vi.fn();
    render(<AnalysisInput chatId="s2" status="idle" onSend={onSend} onStop={vi.fn()} />);

    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: '分析一下' } });
    fireEvent.keyDown(ta, { key: 'Enter', keyCode: 13 });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('分析一下');
    expect(ta.value).toBe('');
  });

  it('附件仍在上传时点击发送按钮：同样不发送、不清空输入', () => {
    attachState.hasPending = true;
    const onSend = vi.fn();
    render(<AnalysisInput chatId="s3" status="idle" onSend={onSend} onStop={vi.fn()} />);

    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: '按钮路径' } });
    fireEvent.click(screen.getByLabelText('发送消息'));

    expect(onSend).not.toHaveBeenCalled();
    expect(ta.value).toBe('按钮路径');
  });
});