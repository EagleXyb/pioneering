/**
 * CapabilityBar 单元测试 —— 输入框底部「技能 / 插件」选择
 *
 * 覆盖：chip 渲染、菜单打开、列表/空态、搜索过滤、勾选与徽标、
 * 插件启停调用与 toast 反馈。
 * hooks 数据流见 useSkillOptions.test.ts / useMcpPlugins.test.ts。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const skillMock = vi.hoisted(() => ({
  state: {
    skills: [] as Array<Record<string, unknown>>,
    loading: false,
    error: null as string | null,
  },
  reload: vi.fn(),
}));

vi.mock('@/hooks/useSkillOptions', async () => {
  const React = await import('react');
  return {
    useSkillOptions: () => {
      const [selected, setSelected] = React.useState<string[]>([]);
      const s = skillMock.state;
      return {
        skills: s.skills,
        loading: s.loading,
        error: s.error,
        selected,
        isSelected: (name: string) => selected.includes(name),
        toggleSkill: (name: string) =>
          setSelected((prev: string[]) =>
            prev.includes(name)
              ? prev.filter((n: string) => n !== name)
              : [...prev, name],
          ),
        reload: skillMock.reload,
      };
    },
  };
});

const pluginMock = vi.hoisted(() => ({
  state: {
    plugins: [] as Array<Record<string, unknown>>,
    loading: false,
    error: null as string | null,
    busyName: null as string | null,
  },
  refresh: vi.fn(),
  togglePlugin: vi.fn(),
}));

vi.mock('@/hooks/useMcpPlugins', () => ({
  useMcpPlugins: () => ({
    plugins: pluginMock.state.plugins,
    loading: pluginMock.state.loading,
    error: pluginMock.state.error,
    busyName: pluginMock.state.busyName,
    refresh: pluginMock.refresh,
    togglePlugin: pluginMock.togglePlugin,
  }),
}));

import { CapabilityBar } from './CapabilityBar';

const skillFixtures = [
  {
    name: 'math',
    description: '数学计算与表达式求值能力',
    version: '1.0.0',
    tags: ['math'],
    toolCount: 1,
    active: true,
  },
  {
    name: 'writer',
    description: '长文写作能力',
    version: '0.1.0',
    tags: [],
    toolCount: 0,
    active: false,
  },
];

const pluginFixtures = [
  {
    name: 'github',
    enabled: true,
    transport: 'stdio',
    connected: false,
    toolCount: 0,
    tools: [],
  },
  {
    name: 'slack',
    enabled: true,
    transport: 'sse',
    connected: true,
    toolCount: 2,
    tools: [
      { name: 'post_message', description: '发消息' },
      { name: 'list_channels', description: '列频道' },
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  skillMock.state.skills = skillFixtures;
  skillMock.state.loading = false;
  skillMock.state.error = null;
  pluginMock.state.plugins = pluginFixtures;
  pluginMock.state.loading = false;
  pluginMock.state.error = null;
  pluginMock.state.busyName = null;
  pluginMock.togglePlugin.mockResolvedValue({ ok: true, message: '已启用插件 github' });
});

describe('CapabilityBar 技能选择', () => {
  it('渲染「技能 / 插件」两个 chip', () => {
    render(<CapabilityBar mode="pro" />);
    expect(screen.getByRole('button', { name: /^选择技能/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^选择插件/ })).toBeInTheDocument();
  });

  it('点击技能 chip 打开菜单，展示技能名称与描述', async () => {
    render(<CapabilityBar mode="pro" />);
    fireEvent.click(screen.getByRole('button', { name: /^选择技能/ }));

    await screen.findByText('math');
    expect(screen.getByText('数学计算与表达式求值能力')).toBeInTheDocument();
    expect(screen.getByText('writer')).toBeInTheDocument();
    // 已注册激活的技能带「已加载」标记
    expect(screen.getByText('已加载')).toBeInTheDocument();
  });

  it('勾选技能后 chip 显示选中数量徽标', async () => {
    render(<CapabilityBar mode="task" />);
    fireEvent.click(screen.getByRole('button', { name: /^选择技能/ }));

    const item = await screen.findByText('math');
    fireEvent.click(item.closest('button') as HTMLElement);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '选择技能，已选 1 个' }),
      ).toBeInTheDocument(),
    );
    expect(
      within(
        screen.getByRole('button', { name: '选择技能，已选 1 个' }),
      ).getByText('1'),
    ).toBeInTheDocument();

    // 再次点击取消勾选
    fireEvent.click(screen.getByText('math').closest('button') as HTMLElement);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^选择技能/ })).toBeInTheDocument(),
    );
  });

  it('搜索框按名称/描述过滤技能', async () => {
    render(<CapabilityBar mode="pro" />);
    fireEvent.click(screen.getByRole('button', { name: /^选择技能/ }));
    await screen.findByText('math');

    fireEvent.change(screen.getByLabelText('搜索技能'), {
      target: { value: '写作' },
    });
    expect(screen.queryByText('math')).not.toBeInTheDocument();
    expect(screen.getByText('writer')).toBeInTheDocument();

    // 无匹配时给出空态
    fireEvent.change(screen.getByLabelText('搜索技能'), {
      target: { value: '不存在的技能' },
    });
    expect(screen.getByText('未找到匹配的技能')).toBeInTheDocument();
  });

  it('无技能时展示接入引导空态', async () => {
    skillMock.state.skills = [];
    render(<CapabilityBar mode="pro" />);
    fireEvent.click(screen.getByRole('button', { name: /^选择技能/ }));

    expect(
      await screen.findByText(/暂无可用技能/),
    ).toBeInTheDocument();
  });

  it('加载失败展示错误与重试入口', async () => {
    skillMock.state.skills = [];
    skillMock.state.error = '技能列表加载失败';
    render(<CapabilityBar mode="pro" />);
    fireEvent.click(screen.getByRole('button', { name: /^选择技能/ }));

    expect(await screen.findByText('技能列表加载失败')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(skillMock.reload).toHaveBeenCalledTimes(1);
  });
});

describe('CapabilityBar 插件选择', () => {
  it('点击插件 chip 打开菜单，展示连接状态与工具数', async () => {
    render(<CapabilityBar mode="task" />);
    fireEvent.click(screen.getByRole('button', { name: /^选择插件/ }));

    await screen.findByText('github');
    expect(screen.getByText('slack')).toBeInTheDocument();
    expect(screen.getByText('已连接')).toBeInTheDocument();
    expect(screen.getByText('sse · 2 个工具')).toBeInTheDocument();
  });

  it('点击未连接插件调用启用并 toast 成功', async () => {
    render(<CapabilityBar mode="task" />);
    fireEvent.click(screen.getByRole('button', { name: /^选择插件/ }));

    const item = await screen.findByRole('button', { name: '启用插件 github' });
    fireEvent.click(item);

    await waitFor(() =>
      expect(pluginMock.togglePlugin).toHaveBeenCalledTimes(1),
    );
    expect(pluginMock.togglePlugin.mock.calls[0][0]).toMatchObject({
      name: 'github',
      connected: false,
    });
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('已启用插件 github'),
    );
  });

  it('启停失败时 toast 错误信息', async () => {
    pluginMock.togglePlugin.mockResolvedValue({
      ok: false,
      message: '连接超时',
    });
    render(<CapabilityBar mode="task" />);
    fireEvent.click(screen.getByRole('button', { name: /^选择插件/ }));

    const item = await screen.findByRole('button', { name: '停用插件 slack' });
    fireEvent.click(item);

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('操作失败：连接超时'),
    );
  });

  it('无插件时展示接入引导空态', async () => {
    pluginMock.state.plugins = [];
    render(<CapabilityBar mode="task" />);
    fireEvent.click(screen.getByRole('button', { name: /^选择插件/ }));

    expect(await screen.findByText(/暂无可用插件/)).toBeInTheDocument();
  });
});

// 菜单为 portal 渲染，within(document.body) 保证查询范围覆盖
describe('CapabilityBar 菜单可访问性', () => {
  it('技能菜单项为可聚焦按钮且带选中态语义', async () => {
    render(<CapabilityBar mode="pro" />);
    fireEvent.click(screen.getByRole('button', { name: /^选择技能/ }));

    const mathItem = (await screen.findByText('math')).closest('button');
    expect(mathItem).not.toBeNull();
    expect(within(document.body).getByRole('button', { name: 'math' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.click(mathItem as HTMLElement);
    await waitFor(() =>
      expect(
        within(document.body).getByRole('button', { name: 'math' }),
      ).toHaveAttribute('aria-pressed', 'true'),
    );
  });
});
