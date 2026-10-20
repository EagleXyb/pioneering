/**
 * SettingsDialog 冒烟测试（布局重构后回归）
 *
 * 覆盖：默认分区渲染、侧栏切换分区、偏好开关持久化、关闭交互。
 * 依赖模块（主题 / 认证 / 后端接口）全部打桩，避免 router 与网络依赖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';

const setThemeMock = vi.fn();
const logoutMock = vi.fn();
const updateUserMock = vi.fn();

vi.mock('../store/themeContext', () => ({
  useTheme: () => ({
    theme: 'light',
    resolvedTheme: 'light',
    setTheme: setThemeMock,
  }),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: 'u_1001',
      username: 'tester',
      nickname: '测试用户',
      email: 'tester@example.com',
      phone: '22644212509',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    logout: logoutMock,
    updateUser: updateUserMock,
  }),
}));

vi.mock('../api/system', () => ({
  getHealth: vi.fn(async () => ({ version: '9.9.9' })),
}));

vi.mock('../api/auth-api', () => ({
  getProfileApi: vi.fn(async () => ({})),
}));

// 数据管理分区（ArchivedSessionsSection）按 archived=true 拉取列表
vi.mock('@/api/session', () => ({
  getSessions: vi.fn(async () => ({
    sessions: [
      {
        id: 'sess_a',
        title: '已归档会话A',
        model: 'deepseek-v4',
        messageCount: 1,
        createdAt: '2026-10-10T09:00:00',
        updatedAt: '2026-10-13T11:27:00',
        isArchived: true,
      },
    ],
    total: 1,
    nextCursor: null,
    hasMore: false,
    limit: 50,
  })),
  updateSession: vi.fn(async () => ({})),
  deleteSession: vi.fn(async () => undefined),
}));

import SettingsDialog from './SettingsDialog';

/** 异步 act 包裹渲染：冲刷挂载 effect 中的 getHealth 等 Promise，
 *  避免「An update to SettingsDialog inside a test was not wrapped in act」噪音 */
async function renderDialog(props: Partial<{ initialSection: string }> = {}) {
  const onClose = vi.fn();
  await act(async () => {
    render(<SettingsDialog visible onClose={onClose} {...props} />);
  });
  return { onClose };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('SettingsDialog', () => {
  it('默认渲染「通用」分区（外观并入通用）', async () => {
    await renderDialog();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // 标题与侧栏同名，取全部匹配
    expect(screen.getAllByText('通用').length).toBeGreaterThan(0);
    // 外观组（原独立分区并入）与基础设置组同页渲染
    expect(screen.getByText('外观')).toBeInTheDocument();
    expect(screen.getByText('基础设置')).toBeInTheDocument();
    // 主题分段器展示当前值，密度与字号行存在
    expect(screen.getByRole('radiogroup', { name: '主题' })).toBeInTheDocument();
    expect(screen.getByText('界面密度')).toBeInTheDocument();
    expect(screen.getByText(/当前 16px/)).toBeInTheDocument();
    // 通知组（原独立分区并入）同页渲染
    expect(screen.getByText('桌面通知')).toBeInTheDocument();
    expect(screen.getByText('提示音')).toBeInTheDocument();
    // 未接通项打「开发中」徽标（语言 / 桌面通知 / 提示音等多处）
    expect(screen.getAllByText('开发中').length).toBeGreaterThan(0);
  });

  it('侧栏点击切换分区并渲染对应内容', async () => {
    await renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    // 版本号来自异步 getHealth，用 findBy 等待Promise 落定
    expect(await screen.findByText(/v9\.9\.9/)).toBeInTheDocument();
  });

  it('Enter 发送开关可切换并持久化到 localStorage', async () => {
    await renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '对话' }));
    const sw = screen.getByRole('switch', { name: 'Enter 发送消息' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'false');
    const stored = JSON.parse(localStorage.getItem('app:preferences') || '{}');
    expect(stored.enterToSend).toBe(false);
  });

  it('账户分区渲染个人资料明细', async () => {
    await renderDialog({ initialSection: 'account' });
    expect(screen.getByText('个人资料')).toBeInTheDocument();
    expect(screen.getByText('u_1001')).toBeInTheDocument();
    expect(screen.getByText('测试用户')).toBeInTheDocument();
    expect(screen.getByText('退出登录')).toBeInTheDocument();
  });

  it('数据管理分区渲染已归档会话列表（原侧边栏迁移项）', async () => {
    await renderDialog({ initialSection: 'data' });
    expect(screen.getByText('已归档的会话')).toBeInTheDocument();
    expect(await screen.findByText('已归档会话A')).toBeInTheDocument();
    expect(screen.getByText('2026/10/13 11:27')).toBeInTheDocument();
    // 行内删除 / 取消归档操作
    expect(screen.getByRole('button', { name: '删除会话 已归档会话A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消归档 已归档会话A' })).toBeInTheDocument();
  });

  it('关闭按钮与 Escape 均触发 onClose', async () => {
    const { onClose } = await renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
