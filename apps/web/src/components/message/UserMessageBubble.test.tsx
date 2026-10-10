/**
 * UserMessageBubble 交互测试（chat / pro / task 共享组件）
 *
 * 覆盖：只读态渲染（时间/复制/编辑入口显隐）、编辑态进出、提交与取消、
 * 空内容禁用、Enter/Shift+Enter、IME 保护、submitting 态、缺失时间降级。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { toast } from 'sonner';
import { UserMessageBubble } from './UserMessageBubble';
import type { ChatMessageData } from '@/api/converter';

const writeText = vi.fn().mockResolvedValue(undefined);

/** 构造用户消息；`over` 用宽松类型，避免 ChatMessagesData 联合类型在 spread 时收窄失败 */
function makeMessage(over: Record<string, unknown> = {}): ChatMessageData {
  return {
    id: 'u_1',
    role: 'user',
    content: [{ type: 'text', data: '你好，帮我写个方案' }],
    datetime: new Date().toISOString(),
    ...over,
  } as unknown as ChatMessageData;
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('UserMessageBubble — 只读态', () => {
  it('渲染正文、悬停元信息行与外层 data-message-id', () => {
    const { container } = render(<UserMessageBubble message={makeMessage()} />);

    expect(container.querySelector('[data-message-id="u_1"]')).not.toBeNull();
    expect(container.querySelector('.chat-msg-user-bubble')?.textContent).toBe(
      '你好，帮我写个方案',
    );
    expect(container.querySelector('.chat-user-meta')).not.toBeNull();
    // 时间节点存在且为 H:MM / HH:MM 形式
    const time = container.querySelector('.chat-user-meta-time');
    expect(time?.textContent).toMatch(/^\d{2}:\d{2}$/);
  });

  it('复制按钮把正文写入剪贴板', async () => {
    render(<UserMessageBubble message={makeMessage()} />);

    fireEvent.click(screen.getByRole('button', { name: '复制' }));

    expect(writeText).toHaveBeenCalledWith('你好，帮我写个方案');
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('已复制'));
  });

  it('editable=false 时不渲染编辑入口', () => {
    render(<UserMessageBubble message={makeMessage()} editable={false} />);
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull();
  });

  it('editable=true 时渲染编辑入口并回调 onStartEdit', () => {
    const onStartEdit = vi.fn();
    render(<UserMessageBubble message={makeMessage()} editable onStartEdit={onStartEdit} />);

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));

    expect(onStartEdit).toHaveBeenCalledTimes(1);
  });

  it('缺少 datetime 时不渲染时间节点（不出现空占位）', () => {
    const { container } = render(
      <UserMessageBubble message={makeMessage({ datetime: undefined })} />,
    );
    expect(container.querySelector('.chat-user-meta-time')).toBeNull();
  });

  it('含附件 Markdown 的正文交给 Markdown 渲染（渲染出链接）', () => {
    const { container } = render(
      <UserMessageBubble
        message={makeMessage({
          content: [
            { type: 'text', data: '看这张图 [报告](https://cdn.example.com/a.png)' },
          ] as ChatMessageData['content'],
        })}
      />,
    );
    expect(container.querySelector('.chat-msg-user-bubble .chat-markdown')).not.toBeNull();
    expect(container.querySelector('a[href="https://cdn.example.com/a.png"]')).not.toBeNull();
  });
});

describe('UserMessageBubble — 悬停提示（自定义，替代原生 title）', () => {
  it('编辑/复制按钮不带原生 title，改用 data-tooltip + chat-tooltip', () => {
    const { container } = render(
      <UserMessageBubble message={makeMessage()} editable />,
    );

    const edit = screen.getByRole('button', { name: '编辑' });
    const copy = screen.getByRole('button', { name: '复制' });

    expect(edit).not.toHaveAttribute('title');
    expect(copy).not.toHaveAttribute('title');
    expect(edit).toHaveAttribute('data-tooltip', '编辑');
    expect(copy).toHaveAttribute('data-tooltip', '复制');
    expect(edit).toHaveClass('chat-tooltip');
    expect(copy).toHaveClass('chat-tooltip');
    // 组件内不应再残留任何原生 title 提示
    expect(container.querySelectorAll('[title]')).toHaveLength(0);
  });

  it('编辑态发送按钮同样改用 data-tooltip（提示含快捷键）', () => {
    render(
      <UserMessageBubble
        message={makeMessage()}
        editable
        editing
        onSubmitEdit={() => {}}
        onCancelEdit={() => {}}
      />,
    );

    const send = screen.getByRole('button', { name: /发送/ });
    expect(send).not.toHaveAttribute('title');
    expect(send).toHaveClass('chat-tooltip');
    expect(send.getAttribute('data-tooltip')).toMatch(/^发送（.+）$/);
  });
});

describe('UserMessageBubble — 编辑态', () => {
  it('渲染文本框、提示语与取消/发送按钮', () => {
    const { container } = render(
      <UserMessageBubble
        message={makeMessage()}
        editable
        editing
        onSubmitEdit={() => {}}
        onCancelEdit={() => {}}
      />,
    );

    expect(container.querySelector('.chat-user-editor')).not.toBeNull();
    expect(container.querySelector('.chat-msg-user-bubble')).toBeNull();
    expect(screen.getByLabelText('编辑消息')).toHaveValue('你好，帮我写个方案');
    expect(screen.getByText(/编辑后将从此处重新开始对话/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /发送/ })).toBeInTheDocument();
  });

  it('修改文本后点击发送 → onSubmitEdit 收到新文本（已 trim）', () => {
    const onSubmitEdit = vi.fn();
    render(
      <UserMessageBubble
        message={makeMessage()}
        editable
        editing
        onSubmitEdit={onSubmitEdit}
        onCancelEdit={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText('编辑消息'), {
      target: { value: '  改过的内容  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /发送/ }));

    expect(onSubmitEdit).toHaveBeenCalledWith('改过的内容');
  });

  it('清空文本后发送按钮禁用', () => {
    render(
      <UserMessageBubble
        message={makeMessage()}
        editable
        editing
        onSubmitEdit={() => {}}
        onCancelEdit={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText('编辑消息'), { target: { value: '   ' } });

    expect(screen.getByRole('button', { name: /发送/ })).toBeDisabled();
  });

  it('Enter 提交（默认 enterToSend=true），但不触发 onCancelEdit', () => {
    const onSubmitEdit = vi.fn();
    const onCancelEdit = vi.fn();
    render(
      <UserMessageBubble
        message={makeMessage()}
        editable
        editing
        onSubmitEdit={onSubmitEdit}
        onCancelEdit={onCancelEdit}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText('编辑消息'), { key: 'Enter' });

    expect(onSubmitEdit).toHaveBeenCalledWith('你好，帮我写个方案');
    expect(onCancelEdit).not.toHaveBeenCalled();
  });

  it('Shift+Enter 换行不提交', () => {
    const onSubmitEdit = vi.fn();
    render(
      <UserMessageBubble
        message={makeMessage()}
        editable
        editing
        onSubmitEdit={onSubmitEdit}
        onCancelEdit={() => {}}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText('编辑消息'), {
      key: 'Enter',
      shiftKey: true,
    });

    expect(onSubmitEdit).not.toHaveBeenCalled();
  });

  it('IME 合成中的 Enter 不提交', () => {
    const onSubmitEdit = vi.fn();
    render(
      <UserMessageBubble
        message={makeMessage()}
        editable
        editing
        onSubmitEdit={onSubmitEdit}
        onCancelEdit={() => {}}
      />,
    );

    const textarea = screen.getByLabelText('编辑消息');
    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 13 });

    expect(onSubmitEdit).not.toHaveBeenCalled();
  });

  it('Esc 取消编辑', () => {
    const onCancelEdit = vi.fn();
    render(
      <UserMessageBubble
        message={makeMessage()}
        editable
        editing
        onSubmitEdit={() => {}}
        onCancelEdit={onCancelEdit}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText('编辑消息'), { key: 'Escape' });

    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it('点击取消 → onCancelEdit', () => {
    const onCancelEdit = vi.fn();
    render(
      <UserMessageBubble
        message={makeMessage()}
        editable
        editing
        onSubmitEdit={() => {}}
        onCancelEdit={onCancelEdit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it('submitting=true：发送按钮禁用、取消禁用、文案变为"发送中…"', () => {
    const { container } = render(
      <UserMessageBubble
        message={makeMessage()}
        editable
        editing
        submitting
        onSubmitEdit={() => {}}
        onCancelEdit={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: /发送中/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(container.querySelector('.chat-user-editor')).toHaveAttribute('aria-busy', 'true');
  });

  it('submitting 时的 Esc 不取消（避免请求中状态错乱）', () => {
    const onCancelEdit = vi.fn();
    render(
      <UserMessageBubble
        message={makeMessage()}
        editable
        editing
        submitting
        onSubmitEdit={() => {}}
        onCancelEdit={onCancelEdit}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText('编辑消息'), { key: 'Escape' });

    expect(onCancelEdit).not.toHaveBeenCalled();
  });
});
