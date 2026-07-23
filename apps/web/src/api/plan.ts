/**
 * Plan-and-Execute 任务步骤时间轴 API
 *
 * 对接后端：
 *   GET    /api/agent/messages/:messageId/plan          获取消息关联的 plan 步骤快照
 *   PATCH  /api/agent/messages/:messageId/plan/collapsed 回传用户手动折叠状态
 *
 * 设计参考：apps/web/src/api/message.ts
 * 与 planExecuteStore.hydrateFromHistory 配合，用于历史任务时间轴恢复。
 */
import { get, post } from './client';

/** 单个持久化步骤（与后端 plan_steps 表对齐） */
export interface PersistedPlanStep {
  step_id: string;
  step_index: number;
  title: string;
  description: string;
  depends_on?: string[];
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  result?: string;
  error?: string;
  /** 步骤开始时间戳（毫秒） */
  started_at?: number;
  /** 步骤结束时间戳（毫秒） */
  finished_at?: number;
  /** 步骤耗时（毫秒） */
  duration_ms?: number;
}

/** 后端返回的 plan 快照（GET /messages/:id/plan 响应） */
export interface PlanSnapshot {
  messageId: string;
  /** plan 终态阶段：done / error / null（无 plan 数据） */
  phase: 'done' | 'error' | null;
  /** 全局错误信息（phase=error 时存在） */
  error: string | null;
  /** 用户手动折叠状态快照（step_id → 是否折叠） */
  collapsedSteps: Record<string, boolean>;
  /** 步骤列表（已按 step_index 升序） */
  steps: PersistedPlanStep[];
}

/** 获取消息关联的 plan 步骤快照 */
export function getMessagePlan(messageId: string): Promise<PlanSnapshot> {
  return get<PlanSnapshot>(`/agent/messages/${messageId}/plan`);
}

/**
 * 回传用户手动折叠状态
 *
 * 在流结束（RUN_FINISHED）后调用，将当前 planExecuteStore.collapsedSteps
 * 持久化到 chat_messages.metadata.collapsed_steps，确保历史恢复时
 * 时间轴的折叠态与初次生成完全一致。
 *
 * 使用 POST 而非 PATCH，与现有 client.ts 暴露的方法对齐（client 未导出 patch）。
 */
export function patchCollapsedSteps(
  messageId: string,
  collapsedSteps: Record<string, boolean>,
): Promise<void> {
  return post<void>(
    `/agent/messages/${messageId}/plan/collapsed`,
    { collapsedSteps },
  );
}
