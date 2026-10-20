/**
 * Sidebar 单元测试 —— 侧边栏导航 / 分组 / 最近
 *
 * 覆盖：
 *   - 主导航行（新建对话 / AI 创作 / 任务 / 技能）与选中态底色
 *   - 「技能」入口跳转 /plugins
 *   - 「分组」区：新建分组、会话移动到分组、分组折叠
 *   - 「最近」区：折叠/展开
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const getSessionsMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/session', () => ({
  getSessions: getSessionsMock,
  createSession: vi.fn(),
  getSession: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
  generateTitle: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { username: 'tester', nickname: '测试员' },
    status: 'authenticated',
    logout: vi.fn(),
  }),
}));

vi.mock('@/store/themeContext', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

import { Sidebar } from './Sidebar';
import { useSidebarGroupsStore } from '@/store/sidebarGroupsStore';
import { useConversationStore } from '@/store/conversationStore';
import * as sessionApi from '@/api/session';

const sessionFixtures = [
  {
    id: 's1',
    title: '会话一',
    model: 'fast',
    messageCount: 1,
    agentMode: null,
    createdAt: '2026-10-20T01:00:00.000Z',
    updatedAt: '2026-10-20T01:00:00.000Z',
    isArchived: false,
  },
  {
    id: 's2',
    title: '会话二',
    model: 'fast',
    messageCount: 1,
    agentMode: null,
    createdAt: '2026-10-20T02:00:00.000Z',
    updatedAt: '2026-10-20T02:00:00.000Z',
    isArchived: false,
  },
];

/** 把当前路由路径渲染出来，便于断言跳转结果 */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

async function renderSidebar(path = '/chat') {
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
      <LocationProbe />
    </MemoryRouter>,
  );
  // 冲刷会话列表的异步 setState（fetchSessions），避免 act 警告
  await act(async () => {
    await Promise.resolve();
  });
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionsMock.mockResolvedValue({
    sessions: sessionFixtures,
    total: 2,
    nextCursor: null,
    hasMore: false,
    limit: 50,
  });
  useSidebarGroupsStore.setState({
    groups: [],
    assignments: {},
    recentCollapsed: false,
    groupsCollapsed: false,
    groupCollapsed: {},
  });
  // 会话 store 也需重置，避免上一个用例留下的 activeId 影响选中态断言
  useConversationStore.setState({
    conversations: [],
    activeId: null,
    sessionModes: {},
    loading: false,
    error: null,
    total: 0,
    nextCursor: null,
    hasMore: false,
    archivedView: false,
  });
});

describe('Sidebar 顶部入口', () => {
  it('保留模式切换器（对话 / 分析 / 任务）与两个操作入口', async () => {
    await renderSidebar();

    expect(screen.getByRole('tab', { name: '对话' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '分析' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '任务' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '新建会话' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '插件 · 技能' }),
    ).toBeInTheDocument();
  });

  it('已移除「AI 创作」入口', async () => {
    await renderSidebar();
    expect(screen.queryByText('AI 创作')).toBeNull();
  });

  it('未选中会话时高亮「新建会话」，选中会话后高亮只落在列表行', async () => {
    await renderSidebar('/chat');

    const newChat = screen.getByRole('button', { name: '新建会话' });
    const plugins = screen.getByRole('button', { name: '插件 · 技能' });

    // 尚未选中任何会话 → 入口高亮
    expect(newChat.className).toContain('is-active');
    expect(newChat).toHaveAttribute('aria-current', 'page');

    // 选中一条历史会话：入口取消高亮，只有列表行高亮
    const row = screen.getByTitle('会话一');
    fireEvent.click(row);
    expect(row.className).toContain('active');
    expect(newChat.className).not.toContain('is-active');
    expect(newChat).not.toHaveAttribute('aria-current');
    expect(plugins.className).not.toContain('is-active');
  });

  it('新建会话后不会与入口形成双高亮，并自动展开被折叠的「最近」分区', async () => {
    vi.mocked(sessionApi.createSession).mockResolvedValue({
      id: 'new1',
      title: '新会话',
      model: 'fast',
      messageCount: 0,
      agentMode: null,
      createdAt: '2026-10-20T09:00:00.000Z',
      updatedAt: '2026-10-20T09:00:00.000Z',
      isArchived: false,
    });
    useSidebarGroupsStore.setState({ recentCollapsed: true });

    await renderSidebar('/chat');
    const newChat = screen.getByRole('button', { name: '新建会话' });

    await act(async () => {
      fireEvent.click(newChat);
      await Promise.resolve();
    });

    // 高亮只落在新建出来的会话行上，入口不再高亮（避免双选中）
    const row = screen.getByTitle('新会话');
    expect(row.className).toContain('active');
    expect(newChat.className).not.toContain('is-active');
    expect(useSidebarGroupsStore.getState().recentCollapsed).toBe(false);
  });

  it('插件页下「插件 · 技能」带选中底色，「新建会话」没有', async () => {
    await renderSidebar('/plugins');

    const newChat = screen.getByRole('button', { name: '新建会话' });
    const plugins = screen.getByRole('button', { name: '插件 · 技能' });

    expect(plugins.className).toContain('is-active');
    expect(plugins).toHaveAttribute('aria-current', 'page');
    expect(newChat.className).not.toContain('is-active');
    expect(newChat).not.toHaveAttribute('aria-current');
  });

  it('点击「插件 · 技能」跳转到 /plugins', async () => {
    await renderSidebar('/chat');

    fireEvent.click(screen.getByRole('button', { name: '插件 · 技能' }));

    expect(screen.getByTestId('pathname')).toHaveTextContent('/plugins');
  });
});

describe('Sidebar 分组区', () => {
  it('渲染「分组」与「最近」两个分区标题', async () => {
    await renderSidebar();

    expect(screen.getByRole('button', { name: '分组' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最近' })).toBeInTheDocument();
  });

  it('点击 + 打开新建分组对话框，输入名称后创建分组', async () => {
    await renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: '新建分组' }));
    const input = await screen.findByLabelText('分组名称');

    fireEvent.change(input, { target: { value: '项目 A' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('项目 A')).toBeInTheDocument();
    expect(useSidebarGroupsStore.getState().groups).toHaveLength(1);
  });

  it('分组名重复时给出错误提示且不创建', async () => {
    useSidebarGroupsStore.getState().createGroup('项目 A');
    await renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: '新建分组' }));
    const input = await screen.findByLabelText('分组名称');
    fireEvent.change(input, { target: { value: '项目 A' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByText(/已存在/)).toBeInTheDocument();
    expect(useSidebarGroupsStore.getState().groups).toHaveLength(1);
  });

  it('会话归组后出现在分组下，并从「最近」移除', async () => {
    const group = useSidebarGroupsStore.getState().createGroup('项目 A').group!;
    useSidebarGroupsStore.getState().assign('s1', group.id);
    await renderSidebar();

    const groupSection = document.querySelector('.sidebar-group') as HTMLElement;
    expect(within(groupSection).getByText('会话一')).toBeInTheDocument();

    const sections = document.querySelectorAll('.sidebar-section');
    const recentSection = sections[sections.length - 1] as HTMLElement;
    expect(within(recentSection).queryByText('会话一')).toBeNull();
    expect(within(recentSection).getByText('会话二')).toBeInTheDocument();
  });

  it('置顶分组排在前面并显示书签图标', async () => {
    const a = useSidebarGroupsStore.getState().createGroup('甲').group!;
    useSidebarGroupsStore.getState().createGroup('乙');
    useSidebarGroupsStore.getState().togglePin(a.id);
    await renderSidebar();

    const names = Array.from(
      document.querySelectorAll('.sidebar-group__name'),
    ).map((el) => el.textContent);
    expect(names[0]).toBe('甲');
    expect(document.querySelector('.sidebar-group__pin')).not.toBeNull();
  });

  it('分组行提供「在分组中新建会话」按钮', async () => {
    useSidebarGroupsStore.getState().createGroup('项目 A');
    await renderSidebar();

    expect(
      screen.getByRole('button', { name: '在「项目 A」中新建会话' }),
    ).toBeInTheDocument();
  });

  it('分组超过 3 个时收起为「更多分组」，展开后可「收起分组」复原', async () => {
    const g = useSidebarGroupsStore.getState();
    ['一', '二', '三', '四', '五'].forEach((n) => g.createGroup(n));
    await renderSidebar();

    expect(document.querySelectorAll('.sidebar-group')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: '收起分组' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '更多分组' }));
    expect(document.querySelectorAll('.sidebar-group')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: '更多分组' })).toBeNull();

    // 展开后出现「收起分组」，点击后回到只显示前 3 个
    fireEvent.click(screen.getByRole('button', { name: '收起分组' }));
    expect(document.querySelectorAll('.sidebar-group')).toHaveLength(3);
    expect(
      screen.getByRole('button', { name: '更多分组' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '收起分组' })).toBeNull();
  });

  it('折叠箭头紧邻标题文字，点击标题可收起/展开', async () => {
    await renderSidebar();

    const toggle = screen.getByRole('button', { name: '分组' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle.querySelector('.sidebar-section__chevron.is-open')).not.toBeNull();

    fireEvent.click(toggle);
    expect(useSidebarGroupsStore.getState().groupsCollapsed).toBe(true);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.querySelector('.sidebar-section__chevron.is-open')).toBeNull();
  });

  it('分组区可折叠', async () => {
    await renderSidebar();

    const toggle = screen.getByRole('button', { name: '分组' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(useSidebarGroupsStore.getState().groupsCollapsed).toBe(true);
  });
});

describe('Sidebar 最近区', () => {
  it('「最近」可折叠/展开', async () => {
    await renderSidebar();

    const toggle = screen.getByRole('button', { name: '最近' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(useSidebarGroupsStore.getState().recentCollapsed).toBe(true);
  });
});
