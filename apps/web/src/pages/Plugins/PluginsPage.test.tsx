/**
 * PluginsPage 单元测试 —— 插件 · 技能市场页
 *
 * 覆盖：页签切换、目录与已接入插件合并展示、分类筛选、搜索过滤、
 * 目录项安装（预填添加插件表单）、插件启停、技能选用、工作伙伴占位、
 * 「管理」跳转设置框 MCP 分区。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: toastMock }));

const pluginMock = vi.hoisted(() => ({
  state: {
    plugins: [] as Array<Record<string, unknown>>,
    loading: false,
    error: null as string | null,
    busyName: null as string | null,
  },
  refresh: vi.fn(),
  togglePlugin: vi.fn(),
  addPlugin: vi.fn(),
}));

vi.mock('@/hooks/useMcpPlugins', () => ({
  useMcpPlugins: () => ({
    plugins: pluginMock.state.plugins,
    loading: pluginMock.state.loading,
    error: pluginMock.state.error,
    busyName: pluginMock.state.busyName,
    refresh: pluginMock.refresh,
    togglePlugin: pluginMock.togglePlugin,
    addPlugin: pluginMock.addPlugin,
  }),
}));

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
              ? prev.filter((n) => n !== name)
              : [...prev, name],
          ),
        reload: skillMock.reload,
      };
    },
  };
});

import PluginsPage from './PluginsPage';
import { useSettingsDialogStore } from '@/store/settingsDialogStore';

const pluginFixtures = [
  {
    name: 'github',
    enabled: true,
    transport: 'stdio',
    connected: true,
    toolCount: 3,
    tools: [{ name: 'search_code', description: '搜代码' }],
  },
  {
    name: 'internal',
    enabled: true,
    transport: 'sse',
    connected: false,
    toolCount: 1,
    tools: [{ name: 'ping', description: 'ping' }],
  },
];

const skillFixtures = [
  {
    name: 'math',
    description: '数学计算与表达式求值能力',
    version: '1.0.0',
    tags: ['办公'],
    toolCount: 1,
    active: true,
  },
  {
    name: 'coder',
    description: '代码生成与重构',
    version: '0.1.0',
    tags: ['engineering'],
    toolCount: 2,
    active: false,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  pluginMock.state.plugins = pluginFixtures;
  pluginMock.state.loading = false;
  pluginMock.state.error = null;
  pluginMock.state.busyName = null;
  pluginMock.togglePlugin.mockResolvedValue({ ok: true, message: '已停用插件 github' });
  pluginMock.addPlugin.mockResolvedValue({ ok: true, message: '已添加插件 notion' });
  skillMock.state.skills = skillFixtures;
  skillMock.state.loading = false;
  skillMock.state.error = null;
  useSettingsDialogStore.setState({ open: false, section: 'general' });
});

/** 取某个名称所在卡片的根元素 */
function cardOf(name: string): HTMLElement {
  return screen.getByText(name).closest('article') as HTMLElement;
}

describe('PluginsPage 顶部区域', () => {
  it('渲染三个页签与搜索 / 管理 / 添加', () => {
    render(<PluginsPage />);

    expect(screen.getByRole('tab', { name: '插件' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '技能' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '工作伙伴' })).toBeInTheDocument();

    expect(screen.getByLabelText('搜索插件')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '管理' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加' })).toBeInTheDocument();
  });

  it('页头自带侧边栏开关（该路由不渲染全局顶栏，避免出现空白条）', () => {
    render(<PluginsPage />);
    expect(
      screen.getByRole('button', { name: '切换侧边栏' }),
    ).toBeInTheDocument();
  });

  it('点击「管理」打开设置框的 MCP 分区', () => {
    render(<PluginsPage />);
    fireEvent.click(screen.getByRole('button', { name: '管理' }));

    expect(useSettingsDialogStore.getState()).toMatchObject({
      open: true,
      section: 'mcp',
    });
  });

  it('点击「添加」打开添加插件对话框（空白表单）', async () => {
    render(<PluginsPage />);
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('名称')).toHaveValue('');
  });
});

describe('PluginsPage 插件列表', () => {
  it('合并展示已接入插件与内置目录项', () => {
    render(<PluginsPage />);

    // 已接入的真实插件
    expect(screen.getByText('github')).toBeInTheDocument();
    expect(screen.getByText('internal')).toBeInTheDocument();
    expect(screen.getByText('已连接 · 3 个工具')).toBeInTheDocument();
    // 内置目录（静态候选）
    expect(screen.getByText('飞书企业号')).toBeInTheDocument();
    expect(screen.getByText('17.4 万人使用')).toBeInTheDocument();
  });

  it('目录项与已接入插件按名称去重（github 只出现一次）', () => {
    render(<PluginsPage />);
    expect(screen.getAllByText('github')).toHaveLength(1);
  });

  it('分类筛选：选中「办公」后只保留办公类卡片', () => {
    render(<PluginsPage />);

    fireEvent.click(screen.getByRole('button', { name: '办公' }));

    expect(screen.getByText('飞书企业号')).toBeInTheDocument();
    expect(screen.getByText('Notion')).toBeInTheDocument();
    // 非办公类（工程）与未分类卡片被过滤
    expect(screen.queryByText('github')).not.toBeInTheDocument();
    expect(screen.queryByText('internal')).not.toBeInTheDocument();
  });

  it('搜索按名称 / 简介过滤卡片', () => {
    render(<PluginsPage />);

    fireEvent.change(screen.getByLabelText('搜索插件'), {
      target: { value: 'notion' },
    });

    expect(screen.getByText('Notion')).toBeInTheDocument();
    expect(screen.queryByText('飞书企业号')).not.toBeInTheDocument();
  });

  it('搜索无结果时给出空态', () => {
    render(<PluginsPage />);

    fireEvent.change(screen.getByLabelText('搜索插件'), {
      target: { value: '不存在的插件' },
    });

    expect(screen.getByText('未找到匹配的内容')).toBeInTheDocument();
  });

  it('目录项「安装」：用官方 MCP 模板预填添加插件表单', async () => {
    render(<PluginsPage />);

    const card = cardOf('Notion');
    fireEvent.click(within(card).getByRole('button', { name: '安装' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('名称')).toHaveValue('notion');
    expect(screen.getByLabelText('启动命令')).toHaveValue('npx');
    expect(screen.getByLabelText('命令参数')).toHaveValue('-y\n@notionhq/notion-mcp-server');
    // 凭据提示
    expect(screen.getByText(/NOTION_TOKEN/)).toBeInTheDocument();
  });

  it('无官方服务的目录项按钮置灰为「即将上线」', () => {
    render(<PluginsPage />);

    const btn = within(cardOf('飞书企业号')).getByRole('button', {
      name: '即将上线',
    });
    expect(btn).toBeDisabled();
  });

  it('已连接插件点击「已连接」调用启停接口并 toast', async () => {
    render(<PluginsPage />);

    const card = cardOf('github');
    fireEvent.click(within(card).getByRole('button', { name: '已连接' }));

    await waitFor(() =>
      expect(pluginMock.togglePlugin).toHaveBeenCalledTimes(1),
    );
    expect(pluginMock.togglePlugin.mock.calls[0][0]).toMatchObject({
      name: 'github',
      connected: true,
    });
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('已停用插件 github'),
    );
  });

  it('插件列表加载失败展示错误与重试入口', () => {
    pluginMock.state.error = '插件列表加载失败';
    render(<PluginsPage />);

    expect(screen.getByText('插件列表加载失败')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(pluginMock.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('PluginsPage 技能与工作伙伴', () => {
  it('切换到「技能」页签展示技能卡片并可选用', () => {
    render(<PluginsPage />);

    fireEvent.click(screen.getByRole('tab', { name: '技能' }));

    expect(screen.getByText('math')).toBeInTheDocument();
    expect(screen.getByText('数学计算与表达式求值能力')).toBeInTheDocument();

    const btn = within(cardOf('math')).getByRole('button', { name: '使用' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(
      within(cardOf('math')).getByRole('button', { name: '已使用' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('技能页签的搜索框占位文案切换为「搜索技能」', () => {
    render(<PluginsPage />);

    fireEvent.click(screen.getByRole('tab', { name: '技能' }));
    expect(screen.getByLabelText('搜索技能')).toBeInTheDocument();
  });

  it('「工作伙伴」页签展示建设中占位', () => {
    render(<PluginsPage />);

    fireEvent.click(screen.getByRole('tab', { name: '工作伙伴' }));
    expect(screen.getByText('工作伙伴正在建设中，敬请期待')).toBeInTheDocument();
  });
});
