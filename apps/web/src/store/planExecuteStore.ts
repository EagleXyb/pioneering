import { create } from 'zustand';
import type { PlanSnapshot } from '../api/plan';

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
 *
 * 持久化恢复：hydrateFromHistory 从后端 plan_steps 表装配终态，
 * source 字段区分 'live'（实时流）与 'history'（历史恢复），
 * 渲染层可据此禁用 running 脉冲动画，保证历史展示与初次生成像素级一致。
 */

/** 单个规划步骤（与后端 modu-agent/src/graph/plan-execute/types.ts PlanStep 对齐） */
export interface PlanItem {
  step_id: string;
  title: string;
  description: string;
  depends_on?: string[];
  /**
   * 步骤状态。
   *
   * `retrying` 为后端步骤级重试的中间态（dispatcher.ts step_finalize 的
   * retry 分支下发），语义是"本步失败后正在按 retry_policy 重试"，
   * 既非终态也非 running——渲染层需要区别于"执行中"展示。
   */
  status: 'pending' | 'running' | 'retrying' | 'done' | 'failed' | 'skipped';
  result?: string;
  error?: string;
  started_at?: number;
  finished_at?: number;
  /** 已重试次数（后端 retry_count） */
  retry_count?: number;
  /** 重试上限（后端 max_attempts），用于展示"重试中 n/m" */
  max_attempts?: number;
  /** P2-4：本步输出因模型长度上限被截断（内容可能不完整） */
  truncated?: boolean;
}

/**
 * 合法步骤状态白名单。
 *
 * P0-1：后端 SSE 的 status 来自网络（`step_update.status`），历史恢复时来自 DB，
 * 二者都不可信。渲染层按 `STATUS_CONFIG[status]` 直接取 className，
 * 一旦出现未登记状态就会 `undefined.className` 抛 TypeError 导致整个面板崩溃。
 * 因此在**写入 store 的唯一入口**做归一化，渲染层再做一次兜底（双保险）。
 */
export const PLAN_STATUSES = [
  'pending',
  'running',
  'retrying',
  'done',
  'failed',
  'skipped',
] as const;

/** 归一化步骤状态：未知/缺失值一律降级为 'pending'（不崩溃、不丢失已有状态由调用方兜底） */
export function normalizePlanStatus(raw: unknown): PlanItem['status'] {
  return (PLAN_STATUSES as readonly string[]).includes(raw as string)
    ? (raw as PlanItem['status'])
    : 'pending';
}

/**
 * 应用单条 step_update（纯函数，供单条与批量更新共用）。
 *
 * 返回新 state；命中未知步骤时原样返回（不抛错）。
 */
function applyStepUpdate(
  state: PlanExecuteState,
  su: NonNullable<PlanStateDelta['step_update']>,
): PlanExecuteState {
  const id = su.id ?? '';
  if (!id || !state.items[id]) {
    // P2 修复：step_update 命中未知步骤时静默丢弃会掩盖协议不一致
    // （后端 replan 重编号 / id 漂移）。dev 环境显式告警，生产保持静默。
    if (import.meta.env?.DEV) {
      console.warn('[task.plan_execute] step_update 命中未知步骤，已忽略', {
        id,
        status: su.status,
      });
    }
    return state;
  }

  const updatedItems = {
    ...state.items,
    [id]: {
      ...state.items[id],
      // P0-1：status 来自网络，先归一化再落库，避免未知状态击穿渲染层
      status:
        su.status === undefined || su.status === null || su.status === ''
          ? state.items[id].status
          : normalizePlanStatus(su.status),
      result: su.result ?? state.items[id].result,
      error: su.error ?? state.items[id].error,
      started_at: su.started_at ?? state.items[id].started_at,
      finished_at: su.finished_at ?? state.items[id].finished_at,
      retry_count: su.retry_count ?? state.items[id].retry_count,
      max_attempts: su.max_attempts ?? state.items[id].max_attempts,
      truncated: su.truncated ?? state.items[id].truncated,
    },
  };

  return {
    ...state,
    items: updatedItems,
    // running / retrying 状态时记录当前步骤；其他状态保持当前步骤不变
    currentStepId:
      su.status === 'running' || su.status === 'retrying' ? id : state.currentStepId,
  };
}

/** STATE_DELTA 事件 payload（与后端 agui-adapter.ts emit_state_delta 输出一致） */
export interface PlanStateDelta {
  phase: 'plan' | 'execute' | 'finalize' | string;
  plan?: any[];
  step_update?: {
    id: string;
    /** 后端可能下发白名单外的自定义状态（如 retrying 之外的扩展），故放宽为 string */
    status: PlanItem['status'] | string;
    result?: string;
    error?: string;
    started_at?: number;
    finished_at?: number;
    retry_count?: number;
    max_attempts?: number;
    /** P2-4：本步输出因模型长度上限被截断（内容可能不完整） */
    truncated?: boolean;
  };
  /**
   * P1-4：计划被后端 max_steps 截断时透出的提示（"还有 N 步被丢弃"）。
   * 此前 slice(0, maxSteps) 静默丢步，用户看到的是"少做几步还显示已完成"。
   */
  truncated_steps?: number;
  /** P2-3：planner 解析/调用失败，已降级为无计划直答（前端需显式提示） */
  planning_failed?: boolean;

  /**
   * P0-3：批量步骤更新（一次节点调用内更新多个步骤）。
   * 场景：前序步骤已提前产出完整交付物时，一次性跳过后续冗余步骤并激活下一个待执行步骤。
   * 后端 event-bridge 会把它拆成多条单步 step_update 事件下发，故该字段为可选兜底。
   */
  step_updates?: Array<NonNullable<PlanStateDelta['step_update']>>;
}

/**
 * 运行阶段。
 *
 * incomplete（P0 修复）：SSE 流已结束但仍有 pending/running 步骤——
 * 流正常结束 ≠ 任务完成，不能把"流关闭"当作"已完成"（否则会出现
 * "已完成"徽章与 "已完成 0/N" 进度自相矛盾的假成功展示）。
 */
export type Phase = 'idle' | 'planning' | 'executing' | 'done' | 'incomplete' | 'error';

/** 数据来源：实时 SSE 流 vs 历史快照恢复 */
type PlanSource = 'live' | 'history';

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
  /** P1-4：计划级提示（如"计划被步骤上限截断"），面板顶部展示 */
  planWarning: string | null;
  /** 步骤折叠状态：step_id → 是否折叠（true=折叠, false/undefined=展开） */
  collapsedSteps: Record<string, boolean>;
  /** 数据来源标记：'live' 实时流，'history' 历史恢复。渲染层据此禁用 running 脉冲动画 */
  source: PlanSource;
  /** 当前快照关联的 assistant messageId（仅 history 来源有意义，用于回传 collapsedSteps） */
  snapshotMessageId: string | null;
  /** HITL 暂停互斥锁：锁定时禁止 toggleStep，且 STATE_DELTA 不得推进 phase */
  hitlLocked: boolean;

  /** 应用 STATE_DELTA 事件（实时流） */
  applyPlanDelta: (delta: PlanStateDelta) => void;
  /** 设置阶段（供 hook 在 RUN_FINISHED / RUN_ERROR 时调用） */
  setPhase: (phase: Phase, error?: string | null) => void;
  /** 切换单个步骤的折叠状态（HITL 锁定时 no-op） */
  toggleStep: (stepId: string) => void;
  /** 设置 HITL 互斥锁 */
  setHitlLock: (locked: boolean) => void;
  /** 从持久化快照装配（会话切换/刷新后恢复，source='history'） */
  hydrateFromHistory: (snapshot: PlanSnapshot) => void;
  /** 重置全部状态（切换会话时调用） */
  reset: () => void;
}

const initialState = {
  items: {},
  rootIds: [],
  phase: 'idle' as Phase,
  currentStepId: null,
  error: null,
  /** P1-4：计划级提示（如"计划被步骤上限截断"），面板顶部展示 */
  planWarning: null as string | null,
  collapsedSteps: {},
  source: 'live' as PlanSource,
  snapshotMessageId: null,
  hitlLocked: false,
};

export const usePlanExecuteStore = create<PlanExecuteState>((set) => ({
  ...initialState,

  applyPlanDelta: (delta) =>
    set((state) => {
      // HITL 暂停互斥：暂停期间任何 STATE_DELTA 不得推进
      if (state.hitlLocked) return state;
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
            status: normalizePlanStatus(step.status),
          };
          rootIds.push(id);
        }
        return {
          items,
          rootIds,
          phase: 'executing',
          currentStepId: null,
          error: null,
          // P1-4 / P2-3：计划级提示（面板顶部展示）
          planWarning:
            delta.planning_failed
              ? '未能生成执行计划（模型输出无法解析），已改为直接回答。可尝试缩小任务范围或重新描述需求。'
              : typeof delta.truncated_steps === 'number' && delta.truncated_steps > 0
                ? `计划已超出单轮步骤上限，末尾 ${delta.truncated_steps} 步未纳入执行（可缩小任务范围或拆分后重试）`
                : null,
          source: 'live' as PlanSource,
          snapshotMessageId: null,
        };
      }

      // P0-3：批量步骤更新（提前交付收敛会一次性跳过多个冗余步骤 + 激活下一个待执行步骤）。
      // 协议上每条仍是单步增量，这里按顺序逐个应用。
      if (
        delta.phase === 'execute' &&
        Array.isArray(delta.step_updates) &&
        delta.step_updates.length > 0
      ) {
        let next = state;
        for (const su of delta.step_updates) {
          next = applyStepUpdate(next, su);
        }
        return next;
      }

      // execute 阶段：增量更新单个 step
      if (delta.phase === 'execute' && delta.step_update) {
        return applyStepUpdate(state, delta.step_update);
      }

      return state;
    }),

  setPhase: (phase, error = null) => set({ phase, error }),

  toggleStep: (stepId) =>
    set((state) => {
      // HITL 暂停时步骤不可交互
      if (state.hitlLocked) return {};
      return {
        collapsedSteps: {
          ...state.collapsedSteps,
          [stepId]: !state.collapsedSteps[stepId],
        },
      };
    }),

  setHitlLock: (locked) => set({ hitlLocked: locked }),

  hydrateFromHistory: (snapshot) =>
    set(() => {
      // 按 step_index 保序装配扁平 items + rootIds
      const items: Record<string, PlanItem> = {};
      const rootIds: string[] = [];
      const sorted = [...snapshot.steps].sort(
        (a, b) => a.step_index - b.step_index,
      );
      for (const s of sorted) {
        items[s.step_id] = {
          step_id: s.step_id,
          title: s.title,
          description: s.description,
          depends_on: s.depends_on,
          // P0-1：DB 里的 status 同样不可信（历史数据 / 写入端缺陷），统一归一化
          status: normalizePlanStatus(s.status),
          result: s.result,
          error: s.error,
          started_at: s.started_at,
          finished_at: s.finished_at,
        };
        rootIds.push(s.step_id);
      }
      // P1-3：以**步骤实际状态**反推阶段，而不是无条件信任后端 metadata.plan_phase。
        // 修复前：后端恒写 'done'，而步骤可能全是 pending/running（实测 7 步计划只跑完
        // 第 1 步），导致刷新后徽章"已完成"与进度"已完成 0/7 步"自相矛盾。
        const hasUnfinished = rootIds.some((id) => {
          const st = items[id]?.status
          return st === 'pending' || st === 'running' || st === 'retrying'
        })
        const resolvedPhase: Phase =
          snapshot.phase === 'error'
            ? 'error'
            : hasUnfinished
              ? 'incomplete'
              : ((snapshot.phase ?? 'done') as Phase)

        return {
        items,
        rootIds,
        // 历史恢复后阶段固定为终态（done/incomplete/error），无 executing
        phase: resolvedPhase,
        error: snapshot.error,
        // 历史恢复无截断提示（计划已定型）
        planWarning: null,
        collapsedSteps: snapshot.collapsedSteps ?? {},
        currentStepId: null,
        source: 'history' as PlanSource,
        snapshotMessageId: snapshot.messageId,
      };
    }),

  reset: () => set({ ...initialState }),
}));
