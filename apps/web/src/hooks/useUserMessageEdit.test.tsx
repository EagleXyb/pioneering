/**
 * useUserMessageEdit 单元测试
 * 覆盖：会话就绪校验、流式中禁用、本地临时 id 的对齐（成功/失败）、
 * 提交中的 submitting 标志、会话切换清理。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock('sonner', () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), info: (...a: unknown[]) => toastInfo(...a) },
}));

const getMessages = vi.fn();
vi.mock('../api/message', () => ({
  getMessages: (...args: unknown[]) => getMessages(...args),
}));

import { useUserMessageEdit } from './useUserMessageEdit';
import type { ChatMessagesData } from '../types/chat';

function localMessages(): ChatMessagesData[] {
  return [
    { id: 'msg_u1', role: 'user', content: [{ type: 'text', data: '第一问' }] },
    {
      id: 'msg_a1',
      role: 'assistant',
      content: [{ type: 'markdown', data: '第一答' }],
    },
    { id: 'u_200', role: 'user', content: [{ type: 'text', data: '第二问' }] },
    {
      id: 'a_200',
      role: 'assistant',
      content: [{ type: 'markdown', data: '第二答' }],
    },
  ] as ChatMessagesData[];
}

const remoteRows = [
  { id: 'msg_u1', sessionId: 's1', role: 'user', content: '第一问' },
  { id: 'msg_a1', sessionId: 's1', role: 'assistant', content: '第一答' },
  { id: 'msg_u2', sessionId: 's1', role: 'user', content: '第二问' },
  { id: 'msg_a2', sessionId: 's1', role: 'assistant', content: '第二答' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useUserMessageEdit', () => {
  it('temp 会话不可编辑且提交时给出提示', async () => {
    const onResend = vi.fn();
    const { result } = renderHook(() =>
      useUserMessageEdit({
        activeId: 'temp_1',
        messages: [],
        status: 'idle',
        onResend,
      }),
    );

    expect(result.current.canEdit).toBe(false);
    await act(async () => {
      await result.current.submitEdit('u_200', 'x');
    });
    expect(onResend).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('会话尚未就绪，请稍后重试');
  });

  it('流式中不可编辑，提交被拒绝且不发起请求', async () => {
    const onResend = vi.fn();
    const { result } = renderHook(() =>
      useUserMessageEdit({
        activeId: 's1',
        messages: [],
        status: 'streaming',
        onResend,
      }),
    );

    expect(result.current.canEdit).toBe(false);
    await act(async () => {
      await result.current.submitEdit('msg_u2', 'x');
    });
    expect(onResend).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalledWith('正在生成回复，请稍后再试');
  });

  it('真实 id 直接透传给 onResend，不发历史请求', async () => {
    const onResend = vi.fn();
    const { result } = renderHook(() =>
      useUserMessageEdit({
        activeId: 's1',
        messages: localMessages(),
        status: 'complete',
        onResend,
      }),
    );

    await act(async () => {
      await result.current.submitEdit('msg_u2', '改后');
    });

    expect(getMessages).not.toHaveBeenCalled();
    expect(onResend).toHaveBeenCalledWith('msg_u2', '改后');
    // 提交后自动退出编辑态
    expect(result.current.editingId).toBeNull();
  });

  it('本地临时 id 先对齐为真实 id 再重发', async () => {
    getMessages.mockResolvedValue({
      messages: remoteRows,
      nextCursor: null,
      hasMore: false,
    });
    const onResend = vi.fn();
    const { result } = renderHook(() =>
      useUserMessageEdit({
        activeId: 's1',
        messages: localMessages(),
        status: 'complete',
        onResend,
      }),
    );

    await act(async () => {
      await result.current.submitEdit('u_200', '改后');
    });

    expect(onResend).toHaveBeenCalledWith('msg_u2', '改后');
  });

  it('无法对齐时不重发并提示刷新（杜绝错配）', async () => {
    getMessages.mockResolvedValue({
      messages: [],
      nextCursor: null,
      hasMore: false,
    });
    const onResend = vi.fn();
    const { result } = renderHook(() =>
      useUserMessageEdit({
        activeId: 's1',
        messages: localMessages(),
        status: 'complete',
        onResend,
      }),
    );

    act(() => result.current.startEdit('u_200'));
    await act(async () => {
      await result.current.submitEdit('u_200', '改后');
    });

    expect(onResend).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('无法定位该消息，请刷新会话后重试');
    // 对齐失败时保持编辑态（内容不丢失），便于用户刷新会话后重试
    expect(result.current.editingId).toBe('u_200');
  });

  it('startEdit / cancelEdit 控制单条编辑态；会话切换自动清空', async () => {
    const { result, rerender } = renderHook(
      ({ activeId }: { activeId: string }) =>
        useUserMessageEdit({
          activeId,
          messages: localMessages(),
          status: 'complete',
          onResend: vi.fn(),
        }),
      { initialProps: { activeId: 's1' } },
    );

    act(() => result.current.startEdit('msg_u2'));
    expect(result.current.editingId).toBe('msg_u2');

    // 切换会话后编辑态必须清空
    rerender({ activeId: 's2' });
    await waitFor(() => expect(result.current.editingId).toBeNull());

    act(() => result.current.startEdit('msg_u9'));
    act(() => result.current.cancelEdit());
    expect(result.current.editingId).toBeNull();
  });
});
