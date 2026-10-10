/**
 * useSkillOptions 单元测试 —— 技能列表拉取（模块级缓存）与按模式持久化选中
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ getSkills: vi.fn() }));

vi.mock('../api/skills', () => ({ getSkills: api.getSkills }));

import type { SkillBrief } from '../api/skills';
import type { AppMode } from '../types';

const skills: SkillBrief[] = [
  {
    name: 'math',
    description: '数学计算',
    version: '1.0.0',
    tags: ['math'],
    toolCount: 1,
    active: true,
  },
  {
    name: 'writer',
    description: '写作',
    version: '0.1.0',
    tags: [],
    toolCount: 0,
    active: false,
  },
];

/** 动态加载 hook 模块：绕过模块级列表缓存的跨测试污染 */
async function loadHook() {
  vi.resetModules();
  const mod = await import('./useSkillOptions');
  return mod.useSkillOptions;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.getSkills.mockResolvedValue({ skills, total: skills.length });
});

describe('useSkillOptions', () => {
  it('挂载后拉取技能列表并结束 loading', async () => {
    const useSkillOptions = await loadHook();
    const { result } = renderHook(() => useSkillOptions('pro'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.skills).toEqual(skills);
    expect(result.current.error).toBeNull();
    expect(api.getSkills).toHaveBeenCalledTimes(1);
  });

  it('勾选技能写入 localStorage，重新挂载后恢复', async () => {
    const useSkillOptions = await loadHook();
    const first = renderHook(() => useSkillOptions('pro'));
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    act(() => first.result.current.toggleSkill('math'));
    expect(first.result.current.selected).toEqual(['math']);
    expect(
      JSON.parse(localStorage.getItem('skill-select:pro') as string),
    ).toEqual(['math']);

    // 再次点击取消勾选
    act(() => first.result.current.toggleSkill('math'));
    expect(first.result.current.selected).toEqual([]);

    // 重新挂载（模拟切换模式回来 / 页面刷新）
    act(() => first.result.current.toggleSkill('math'));
    first.unmount();

    const useSkillOptionsReloaded = await loadHook();
    const second = renderHook(() => useSkillOptionsReloaded('pro'));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.selected).toEqual(['math']);
  });

  it('选中按模式隔离，切换模式读取各自持久化', async () => {
    localStorage.setItem('skill-select:pro', JSON.stringify(['math']));
    localStorage.setItem('skill-select:task', JSON.stringify(['writer']));

    const useSkillOptions = await loadHook();
    const { result, rerender } = renderHook(
      ({ mode }: { mode: AppMode }) => useSkillOptions(mode),
      { initialProps: { mode: 'pro' as AppMode } },
    );
    expect(result.current.selected).toEqual(['math']);

    rerender({ mode: 'task' });
    await waitFor(() => expect(result.current.selected).toEqual(['writer']));
  });

  it('reload 忽略模块缓存重新拉取', async () => {
    const useSkillOptions = await loadHook();
    const { result } = renderHook(() => useSkillOptions('pro'));
    await waitFor(() => expect(result.current.skills).toHaveLength(2));

    // 后端数据变化后 reload 应拿到新列表
    api.getSkills.mockResolvedValue({ skills: [skills[0]], total: 1 });
    act(() => result.current.reload());

    await waitFor(() => expect(result.current.skills).toHaveLength(1));
    expect(api.getSkills).toHaveBeenCalledTimes(2);
  });

  it('加载失败给出 error，重试成功后清空', async () => {
    api.getSkills.mockRejectedValueOnce(new Error('网络错误'));
    const useSkillOptions = await loadHook();
    const { result } = renderHook(() => useSkillOptions('pro'));

    await waitFor(() => expect(result.current.error).toBe('网络错误'));
    expect(result.current.loading).toBe(false);

    api.getSkills.mockResolvedValue({ skills, total: skills.length });
    act(() => result.current.reload());

    await waitFor(() => expect(result.current.skills).toHaveLength(2));
    expect(result.current.error).toBeNull();
  });
});
