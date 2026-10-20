/**
 * sidebarGroupsStore 单元测试 —— 侧边栏分组
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSidebarGroupsStore } from './sidebarGroupsStore';

const store = () => useSidebarGroupsStore.getState();

beforeEach(() => {
  useSidebarGroupsStore.setState({
    groups: [],
    assignments: {},
    recentCollapsed: false,
    groupsCollapsed: false,
    groupCollapsed: {},
  });
});

describe('sidebarGroupsStore 分组增删改', () => {
  it('创建分组：名称为空或重复时失败', () => {
    expect(store().createGroup('  ').ok).toBe(false);

    const ok = store().createGroup('项目 A');
    expect(ok.ok).toBe(true);
    expect(ok.group?.name).toBe('项目 A');
    expect(store().groups).toHaveLength(1);

    const dup = store().createGroup('项目 A');
    expect(dup.ok).toBe(false);
    expect(dup.message).toContain('已存在');
    expect(store().groups).toHaveLength(1);
  });

  it('重命名分组：重名时失败，成功后名称更新', () => {
    const a = store().createGroup('A').group!;
    store().createGroup('B');

    expect(store().renameGroup(a.id, 'B').ok).toBe(false);

    expect(store().renameGroup(a.id, 'C').ok).toBe(true);
    expect(store().groups.find((g) => g.id === a.id)?.name).toBe('C');
  });

  it('删除分组后，其下会话回到「最近」（归属被清空）', () => {
    const a = store().createGroup('A').group!;
    store().assign('s1', a.id);
    store().assign('s2', a.id);

    store().removeGroup(a.id);

    expect(store().groups).toHaveLength(0);
    expect(store().assignments.s1).toBeUndefined();
    expect(store().assignments.s2).toBeUndefined();
  });
});

describe('sidebarGroupsStore 会话归属与折叠', () => {
  it('assign：移动到分组 / 移出分组', () => {
    const a = store().createGroup('A').group!;

    store().assign('s1', a.id);
    expect(store().getGroupId('s1')).toBe(a.id);

    store().assign('s1', null);
    expect(store().getGroupId('s1')).toBeUndefined();
  });

  it('togglePin：置顶 / 取消置顶', () => {
    const a = store().createGroup('A').group!;
    expect(store().groups[0].pinned).toBeFalsy();

    store().togglePin(a.id);
    expect(store().groups.find((g) => g.id === a.id)?.pinned).toBe(true);

    store().togglePin(a.id);
    expect(store().groups.find((g) => g.id === a.id)?.pinned).toBe(false);
  });

  it('折叠状态可读写', () => {
    store().setRecentCollapsed(true);
    store().setGroupsCollapsed(true);
    const a = store().createGroup('A').group!;
    store().toggleGroupCollapsed(a.id);

    expect(store().recentCollapsed).toBe(true);
    expect(store().groupsCollapsed).toBe(true);
    expect(store().groupCollapsed[a.id]).toBe(true);

    store().toggleGroupCollapsed(a.id);
    expect(store().groupCollapsed[a.id]).toBe(false);
  });
});
