/**
 * 侧边栏分组（用户自建）—— 会话分组与归属关系
 *
 * 后端 chat_sessions 没有分组字段（且该库 db push 不可用，见记忆中的
 * "只允许单独补表"约束），因此分组定义与「会话 → 分组」的归属关系
 * 暂以 localStorage 持久化（key: sidebar-groups）：
 *   - groups：分组列表（id / name / createdAt）
 *   - assignments：会话 id → 分组 id（未出现的会话归入「最近」）
 *   - recentCollapsed / groupsCollapsed / groupCollapsed：折叠状态
 *
 * 数据量为「分组数 × 会话数」的量级（几十～几百），localStorage 足够；
 * 若后续后端补上分组字段，只需把本 store 的读写换成接口即可。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SidebarGroup {
  id: string;
  name: string;
  createdAt: string;
  /** 置顶：置顶分组排在前面，行尾显示书签图标 */
  pinned?: boolean;
}

/** 操作结果（供调用方 toast 反馈） */
export interface GroupOpResult {
  ok: boolean;
  message: string;
  group?: SidebarGroup;
}

interface SidebarGroupsState {
  groups: SidebarGroup[];
  /** 会话 id → 分组 id */
  assignments: Record<string, string>;
  /** 「最近」区是否折叠 */
  recentCollapsed: boolean;
  /** 「分组」区是否折叠 */
  groupsCollapsed: boolean;
  /** 各分组自身是否折叠 */
  groupCollapsed: Record<string, boolean>;

  /** 新建分组（名称为空或重名时返回 ok=false） */
  createGroup: (name: string) => GroupOpResult;
  /** 重命名分组 */
  renameGroup: (id: string, name: string) => GroupOpResult;
  /** 删除分组（该分组下的会话回到「最近」） */
  removeGroup: (id: string) => void;
  /** 置顶 / 取消置顶分组 */
  togglePin: (id: string) => void;
  /** 移动会话：groupId 为 null 表示移出分组（回到「最近」） */
  assign: (sessionId: string, groupId: string | null) => void;
  /** 会话所属分组 id（未分组返回 undefined） */
  getGroupId: (sessionId: string) => string | undefined;

  setRecentCollapsed: (collapsed: boolean) => void;
  setGroupsCollapsed: (collapsed: boolean) => void;
  toggleGroupCollapsed: (id: string) => void;
}

/** 生成分组 id（时间戳 + 随机串，避免同毫秒冲突） */
function nextGroupId(): string {
  return `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useSidebarGroupsStore = create<SidebarGroupsState>()(
  persist(
    (set, get) => ({
      groups: [],
      assignments: {},
      recentCollapsed: false,
      groupsCollapsed: false,
      groupCollapsed: {},

      createGroup: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return { ok: false, message: '分组名称不能为空' };
        if (get().groups.some((g) => g.name === trimmed)) {
          return { ok: false, message: `分组「${trimmed}」已存在` };
        }
        const group: SidebarGroup = {
          id: nextGroupId(),
          name: trimmed,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ groups: [...s.groups, group] }));
        return { ok: true, message: `已创建分组「${trimmed}」`, group };
      },

      renameGroup: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return { ok: false, message: '分组名称不能为空' };
        if (get().groups.some((g) => g.id !== id && g.name === trimmed)) {
          return { ok: false, message: `分组「${trimmed}」已存在` };
        }
        set((s) => ({
          groups: s.groups.map((g) =>
            g.id === id ? { ...g, name: trimmed } : g,
          ),
        }));
        return { ok: true, message: '分组已重命名' };
      },

      removeGroup: (id) => {
        set((s) => {
          // 该分组下的会话回到「最近」：清掉归属记录
          const assignments: Record<string, string> = {};
          for (const [sid, gid] of Object.entries(s.assignments)) {
            if (gid !== id) assignments[sid] = gid;
          }
          const groupCollapsed = { ...s.groupCollapsed };
          delete groupCollapsed[id];
          return {
            groups: s.groups.filter((g) => g.id !== id),
            assignments,
            groupCollapsed,
          };
        });
      },

      assign: (sessionId, groupId) => {
        set((s) => {
          const assignments = { ...s.assignments };
          if (groupId === null) delete assignments[sessionId];
          else assignments[sessionId] = groupId;
          return { assignments };
        });
      },

      togglePin: (id) => {
        set((s) => ({
          groups: s.groups.map((g) =>
            g.id === id ? { ...g, pinned: !g.pinned } : g,
          ),
        }));
      },

      getGroupId: (sessionId) => get().assignments[sessionId],

      setRecentCollapsed: (collapsed) => set({ recentCollapsed: collapsed }),
      setGroupsCollapsed: (collapsed) => set({ groupsCollapsed: collapsed }),
      toggleGroupCollapsed: (id) =>
        set((s) => ({
          groupCollapsed: {
            ...s.groupCollapsed,
            [id]: !s.groupCollapsed[id],
          },
        })),
    }),
    {
      name: 'sidebar-groups',
      partialize: (state) => ({
        groups: state.groups,
        assignments: state.assignments,
        recentCollapsed: state.recentCollapsed,
        groupsCollapsed: state.groupsCollapsed,
        groupCollapsed: state.groupCollapsed,
      }),
    },
  ),
);
