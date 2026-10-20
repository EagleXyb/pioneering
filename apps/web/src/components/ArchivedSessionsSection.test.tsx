/**
 * ArchivedSessionsSection 回归：数据管理分区已归档会话列表
 * 覆盖：列表渲染（标题 + 日期）、取消归档、删除（二次确认）、空态、加载更多。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const getSessionsMock = vi.fn();
const updateSessionMock = vi.fn();
const deleteSessionMock = vi.fn();
const fetchSessionsMock = vi.fn(async () => {});
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock('@/api/session', () => ({
  getSessions: (...args: unknown[]) => getSessionsMock(...args),
  updateSession: (...args: unknown[]) => updateSessionMock(...args),
  deleteSession: (...args: unknown[]) => deleteSessionMock(...args),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
    info: vi.fn(),
  },
}));

// 组件仅在变更后调用 getState().fetchSessions() 同步侧边栏
vi.mock('../store/conversationStore', () => ({
  useConversationStore: {
    getState: () => ({ fetchSessions: fetchSessionsMock }),
  },
}));

import { ArchivedSessionsSection } from './ArchivedSessionsSection';

const ARCHIVED_SESSIONS = [
  {
    id: 'sess_a',
    title: 'Harness Engineering AI Native产品设计',
    model: 'deepseek-v4',
    messageCount: 3,
    createdAt: '2026-10-10T09:00:00',
    updatedAt: '2026-10-13T11:27:00',
    isArchived: true,
  },
  {
    id: 'sess_b',
    title: '旧版归档会话',
    model: 'deepseek-v4',
    messageCount: 1,
    createdAt: '2026-10-01T09:00:00',
    updatedAt: '2026-10-02T08:05:00',
    isArchived: true,
  },
];

async function renderSection() {
  await act(async () => {
    render(<ArchivedSessionsSection />);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionsMock.mockResolvedValue({
    sessions: ARCHIVED_SESSIONS,
    total: 2,
    nextCursor: null,
    hasMore: false,
    limit: 50,
  });
  updateSessionMock.mockResolvedValue({});
  deleteSessionMock.mockResolvedValue(undefined);
});

describe('ArchivedSessionsSection', () => {
  it('按 archived=true 拉取并渲染列表（标题 + YYYY/MM/DD HH:mm 日期）', async () => {
    await renderSection();
    expect(getSessionsMock).toHaveBeenCalledWith(undefined, 50, true);
    expect(
      await screen.findByText('Harness Engineering AI Native产品设计'),
    ).toBeInTheDocument();
    expect(screen.getByText('旧版归档会话')).toBeInTheDocument();
    // 本地时区格式化（与 formatDateTime 的 getFullYear/getMonth 一致）
    expect(screen.getByText('2026/10/13 11:27')).toBeInTheDocument();
    expect(screen.getByText('2026/10/02 08:05')).toBeInTheDocument();
  });

  it('空态展示提示', async () => {
    getSessionsMock.mockResolvedValue({
      sessions: [],
      total: 0,
      nextCursor: null,
      hasMore: false,
      limit: 50,
    });
    await renderSection();
    expect(await screen.findByText('暂无归档的会话')).toBeInTheDocument();
  });

  it('取消归档：更新 isArchived=false 后从列表移除并同步侧边栏', async () => {
    await renderSection();
    const btn = await screen.findByRole('button', {
      name: '取消归档 Harness Engineering AI Native产品设计',
    });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(updateSessionMock).toHaveBeenCalledWith('sess_a', {
        isArchived: false,
      });
    });
    await waitFor(() => {
      expect(
        screen.queryByText('Harness Engineering AI Native产品设计'),
      ).not.toBeInTheDocument();
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('已恢复为活跃会话');
    expect(fetchSessionsMock).toHaveBeenCalled();
  });

  it('删除：二次确认后物理删除（archive=false）并同步侧边栏', async () => {
    await renderSection();
    fireEvent.click(
      await screen.findByRole('button', { name: '删除会话 旧版归档会话' }),
    );
    // 确认弹框出现
    const confirmBtn = await screen.findByRole('button', { name: '确认删除' });
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(deleteSessionMock).toHaveBeenCalledWith('sess_b', false);
    });
    await waitFor(() => {
      expect(screen.queryByText('旧版归档会话')).not.toBeInTheDocument();
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('已删除');
    expect(fetchSessionsMock).toHaveBeenCalled();
  });

  it('删除确认可取消（不调用接口）', async () => {
    await renderSection();
    fireEvent.click(
      await screen.findByRole('button', { name: '删除会话 旧版归档会话' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '确认删除' })).not.toBeInTheDocument();
    });
    expect(deleteSessionMock).not.toHaveBeenCalled();
  });

  it('hasMore 时展示加载更多，点击拉取下一页并去重拼接', async () => {
    getSessionsMock.mockResolvedValueOnce({
      sessions: [ARCHIVED_SESSIONS[0]],
      total: 2,
      nextCursor: 'cursor_1',
      hasMore: true,
      limit: 50,
    });
    getSessionsMock.mockResolvedValueOnce({
      sessions: [ARCHIVED_SESSIONS[0], ARCHIVED_SESSIONS[1]],
      total: 2,
      nextCursor: null,
      hasMore: false,
      limit: 50,
    });
    await renderSection();
    const moreBtn = await screen.findByRole('button', { name: '加载更多' });
    fireEvent.click(moreBtn);
    await waitFor(() => {
      expect(getSessionsMock).toHaveBeenCalledWith('cursor_1', 50, true);
    });
    // 去重：sess_a 不重复，sess_b 追加
    await waitFor(() => {
      expect(screen.getByText('旧版归档会话')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Harness Engineering AI Native产品设计')).toHaveLength(1);
    // 无更多后按钮消失
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
    });
  });
});
