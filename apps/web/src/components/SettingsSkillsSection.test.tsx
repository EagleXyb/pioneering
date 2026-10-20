/**
 * 设置 → 技能（L3 管理面）组件测试
 *
 * 覆盖：列表渲染 / 启停调用与 toast / enabled=false 提示与禁用 / 加载失败重试。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getSkills: vi.fn(),
  activateSkill: vi.fn(),
  deactivateSkill: vi.fn(),
  reloadSkills: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('../api/skills', () => api);
vi.mock('sonner', () => ({ toast: toastMock }));

import { SettingsSkillsSection } from './SettingsSkillsSection';

const math = {
  name: 'math',
  description: '数学计算与表达式求值',
  version: '1.0.0',
  tags: ['math'],
  toolCount: 1,
  active: true,
  toolNames: ['calculator'],
};

const writer = {
  name: 'writer',
  description: '长文写作',
  version: '2.0.0',
  tags: [],
  toolCount: 0,
  active: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getSkills.mockResolvedValue({ skills: [math, writer], total: 2, enabled: true });
  api.activateSkill.mockResolvedValue({ ok: true });
  api.deactivateSkill.mockResolvedValue({ ok: true });
  api.reloadSkills.mockResolvedValue({ ok: true });
});

describe('SettingsSkillsSection', () => {
  it('渲染技能列表：名称 / 版本 / 状态 / 工具数', async () => {
    render(<SettingsSkillsSection />);

    expect(await screen.findByText('math')).toBeInTheDocument();
    expect(screen.getByText('已启用')).toBeInTheDocument();
    expect(screen.getByText('未启用')).toBeInTheDocument();
    expect(screen.getByText('1 个工具 · calculator')).toBeInTheDocument();
    expect(screen.getByLabelText('停用技能 math')).toBeInTheDocument();
    expect(screen.getByLabelText('启用技能 writer')).toBeInTheDocument();
  });

  it('停用：调用接口并 toast 成功', async () => {
    render(<SettingsSkillsSection />);
    fireEvent.click(await screen.findByLabelText('停用技能 math'));

    await waitFor(() => expect(api.deactivateSkill).toHaveBeenCalledWith('math'));
    expect(toastMock.success).toHaveBeenCalledWith('已停用 math');
    // 成功后重新拉取列表
    expect(api.getSkills).toHaveBeenCalledTimes(2);
  });

  it('启用：调用接口', async () => {
    render(<SettingsSkillsSection />);
    fireEvent.click(await screen.findByLabelText('启用技能 writer'));

    await waitFor(() => expect(api.activateSkill).toHaveBeenCalledWith('writer'));
    expect(toastMock.success).toHaveBeenCalledWith('已启用 writer');
  });

  it('操作失败：toast 展示后端 message', async () => {
    api.deactivateSkill.mockRejectedValueOnce(new Error('需要管理员权限'));
    render(<SettingsSkillsSection />);
    fireEvent.click(await screen.findByLabelText('停用技能 math'));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('操作失败：需要管理员权限'),
    );
  });

  it('enabled=false：展示提示且禁用操作', async () => {
    api.getSkills.mockResolvedValue({ skills: [math], total: 1, enabled: false });
    render(<SettingsSkillsSection />);

    expect(await screen.findByText(/技能子系统未启用/)).toBeInTheDocument();
    expect(screen.getByLabelText('停用技能 math')).toBeDisabled();
    expect(screen.getByRole('button', { name: '重新扫描目录' })).toBeDisabled();
  });

  it('加载失败：展示错误与重试', async () => {
    api.getSkills.mockRejectedValueOnce(new Error('网络错误'));
    render(<SettingsSkillsSection />);

    expect(await screen.findByText('网络错误')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(api.getSkills).toHaveBeenCalledTimes(2));
  });

  it('重新扫描：调用接口并刷新列表', async () => {
    render(<SettingsSkillsSection />);
    await screen.findByText('math');
    fireEvent.click(screen.getByRole('button', { name: '重新扫描目录' }));

    await waitFor(() => expect(api.reloadSkills).toHaveBeenCalledTimes(1));
    expect(toastMock.success).toHaveBeenCalledWith('已重新扫描技能目录');
  });
});
