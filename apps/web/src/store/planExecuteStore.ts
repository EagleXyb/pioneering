import { create } from 'zustand';

/**
 * Plan-and-Execute 任务模式状态管理
 *
 * 设计参考：apps/web/docs/Plan-and-Execute面板对接分析.md §2.4
 *
 * 与 artifactStore / conversationStore 解耦：plan 状态只活在任务模式生命周期内，
 * 切换会话时由 TaskMode.tsx 的 useEffect([activeId]) 主动调用 reset() 清理。
 *
 * 数据结构选择扁平 Record<id, PlanItem> + rootIds，而非嵌套树：
 *   1. SSE 增量更新时只需 O(1) 修改单个 item，无需递归遍历树
 *   2. rootIds 即可还原线性展示顺序
 *   3. 与 ProMode stateMap 的 Record<string, AgentStep> 模式一致
 */

/** 单个规划步骤（与后端 modu-agent/src/graph/plan-execute/types.ts PlanStep 对齐） */
export interface PlanItem {
  step_id: string;
  title: string;
  description: string;
  depends_on?: string[];
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  result?: string;
  error?: string;
  started_at?: number;
  finished_at?: number;
}

/** STATE_DELTA 事件 payload（与后端 agui-adapter.ts emit_state_delta 输出一致） */
export interface PlanStateDelta {
  phase: 'plan' | 'execute' | 'finalize' | string;
  plan?: any[];
  step_update?: {
    id: string;
    status: PlanItem['status'];
    result?: string;
    error?: string;
    started_at?: number;
    finished_at?: number;
  };
}

type Phase = 'idle' | 'planning' | 'executing' | 'done' | 'error';

interface PlanExecuteState {
  /** 扁平化的步骤列表：step_id → PlanItem */
  items: Record<string, PlanItem>;
  /** 根步骤 ID 列表（按规划顺序） */
  rootIds: string[];
  /** 当前执行阶段 */
  phase: Phase;
  /** 当前正在执行的步骤 ID */
  currentStepId: string | null;
  /** 错误信息 */
  error: string | null;

  /** 应用 STATE_DELTA 事件 */
  applyPlanDelta: (delta: PlanStateDelta) => void;
  /** 设置阶段（供 hook 在 RUN_FINISHED / RUN_ERROR 时调用） */
  setPhase: (phase: Phase, error?: string | null) => void;
  /** 重置全部状态（切换会话时调用） */
  reset: () => void;
}

const initialState = {
  items: {},
  rootIds: [],
  phase: 'idle' as Phase,
  currentStepId: null,
  error: null,
};

export const usePlanExecuteStore = create<PlanExecuteState>((set) => ({
  ...initialState,

  applyPlanDelta: (delta) =>
    set((state) => {
      // plan 阶段：全量替换 items 和 rootIds，进入 executing 阶段
      if (delta.phase === 'plan' && Array.isArray(delta.plan)) {
        const items: Record<string, PlanItem> = {};
        const rootIds: string[] = [];
        for (const step of delta.plan) {
          const id = step.step_id ?? step.id ?? '';
          if (!id) continue;
          items[id] = {
            step_id: id,
            title: step.title ?? '',
            description: step.description ?? '',
            depends_on: step.depends_on,
            status: step.status ?? 'pending',
          };
          rootIds.push(id);
        }
        return {
          items,
          rootIds,
          phase: 'executing',
          currentStepId: null,
          error: null,
        };
      }

      // execute 阶段：增量更新单个 step
      if (delta.phase === 'execute' && delta.step_update) {
        const su = delta.step_update;
        const id = su.id ?? '';
        if (!id || !state.items[id]) return state;

        const updatedItems = {
          ...state.items,
          [id]: {
            ...state.items[id],
            status: su.status ?? state.items[id].status,
            result: su.result ?? state.items[id].result,
            error: su.error ?? state.items[id].error,
            started_at: su.started_at ?? state.items[id].started_at,
            finished_at: su.finished_at ?? state.items[id].finished_at,
          },
        };

        return {
          ...state,
          items: updatedItems,
          // running 状态时记录当前步骤；其他状态保持当前步骤不变
          currentStepId: su.status === 'running' ? id : state.currentStepId,
        };
      }

      return state;
    }),

  setPhase: (phase, error = null) => set({ phase, error }),

  reset: () => set({ ...initialState }),
}));
