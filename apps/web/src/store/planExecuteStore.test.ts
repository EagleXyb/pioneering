import { beforeEach, describe, expect, it } from 'vitest';
import { usePlanExecuteStore, normalizePlanStatus } from './planExecuteStore';
import type { PlanSnapshot } from '../api/plan';

describe('planExecuteStore', () => {
  beforeEach(() => {
    usePlanExecuteStore.getState().reset();
  });

  describe('toggleStep', () => {
    it('默认 collapsedSteps 为空', () => {
      expect(usePlanExecuteStore.getState().collapsedSteps).toEqual({});
    });

    it('切换步骤折叠状态', () => {
      const { toggleStep } = usePlanExecuteStore.getState();
      toggleStep('step-1');
      expect(usePlanExecuteStore.getState().collapsedSteps['step-1']).toBe(true);
      toggleStep('step-1');
      expect(usePlanExecuteStore.getState().collapsedSteps['step-1']).toBe(false);
    });

    it('多个步骤独立切换', () => {
      const { toggleStep } = usePlanExecuteStore.getState();
      toggleStep('step-1');
      toggleStep('step-2');
      const state = usePlanExecuteStore.getState().collapsedSteps;
      expect(state['step-1']).toBe(true);
      expect(state['step-2']).toBe(true);
      toggleStep('step-1');
      expect(usePlanExecuteStore.getState().collapsedSteps['step-1']).toBe(false);
      expect(usePlanExecuteStore.getState().collapsedSteps['step-2']).toBe(true);
    });
  });

  describe('reset', () => {
    it('reset 清空 collapsedSteps', () => {
      const { toggleStep, reset } = usePlanExecuteStore.getState();
      toggleStep('step-1');
      expect(usePlanExecuteStore.getState().collapsedSteps['step-1']).toBe(true);
      reset();
      expect(usePlanExecuteStore.getState().collapsedSteps).toEqual({});
    });

    it('reset 清空 source 与 snapshotMessageId', () => {
      const { hydrateFromHistory, reset } = usePlanExecuteStore.getState();
      hydrateFromHistory({
        messageId: 'msg_1',
        phase: 'done',
        error: null,
        collapsedSteps: { step_2: true },
        steps: [
          { step_id: 'step_1', step_index: 0, title: 'A', description: '', status: 'done' },
        ],
      });
      expect(usePlanExecuteStore.getState().source).toBe('history');
      expect(usePlanExecuteStore.getState().snapshotMessageId).toBe('msg_1');
      reset();
      expect(usePlanExecuteStore.getState().source).toBe('live');
      expect(usePlanExecuteStore.getState().snapshotMessageId).toBeNull();
    });
  });

  describe('hydrateFromHistory', () => {
    it('按 step_index 保序装配 items 与 rootIds', () => {
      const { hydrateFromHistory } = usePlanExecuteStore.getState();
      // 故意乱序输入，验证按 step_index 装配
      const snapshot: PlanSnapshot = {
        messageId: 'msg_1',
        phase: 'done',
        error: null,
        collapsedSteps: {},
        steps: [
          { step_id: 'step_2', step_index: 1, title: 'B', description: 'b', status: 'done', result: 'r2' },
          { step_id: 'step_1', step_index: 0, title: 'A', description: 'a', status: 'done', result: 'r1' },
        ],
      };
      hydrateFromHistory(snapshot);
      const state = usePlanExecuteStore.getState();
      expect(state.rootIds).toEqual(['step_1', 'step_2']);
      expect(state.items['step_1'].title).toBe('A');
      expect(state.items['step_1'].result).toBe('r1');
      expect(state.items['step_2'].title).toBe('B');
    });

    it('设置 source=history 与 snapshotMessageId', () => {
      const { hydrateFromHistory } = usePlanExecuteStore.getState();
      hydrateFromHistory({
        messageId: 'msg_42',
        phase: 'done',
        error: null,
        collapsedSteps: {},
        steps: [
          { step_id: 'step_1', step_index: 0, title: 'A', description: '', status: 'done' },
        ],
      });
      const state = usePlanExecuteStore.getState();
      expect(state.source).toBe('history');
      expect(state.snapshotMessageId).toBe('msg_42');
    });

    it('装配 phase 终态与 error 信息', () => {
      const { hydrateFromHistory } = usePlanExecuteStore.getState();
      hydrateFromHistory({
        messageId: 'msg_1',
        phase: 'error',
        error: 'boom',
        collapsedSteps: {},
        steps: [
          { step_id: 'step_1', step_index: 0, title: 'A', description: '', status: 'failed', error: 'e1' },
        ],
      });
      const state = usePlanExecuteStore.getState();
      expect(state.phase).toBe('error');
      expect(state.error).toBe('boom');
      expect(state.items['step_1'].status).toBe('failed');
      expect(state.items['step_1'].error).toBe('e1');
    });

    it('恢复 collapsedSteps 快照（保视觉细节）', () => {
      const { hydrateFromHistory } = usePlanExecuteStore.getState();
      hydrateFromHistory({
        messageId: 'msg_1',
        phase: 'done',
        error: null,
        collapsedSteps: { step_2: true, step_3: true },
        steps: [
          { step_id: 'step_1', step_index: 0, title: 'A', description: '', status: 'done' },
          { step_id: 'step_2', step_index: 1, title: 'B', description: '', status: 'done' },
        ],
      });
      expect(usePlanExecuteStore.getState().collapsedSteps).toEqual({
        step_2: true,
        step_3: true,
      });
    });

    it('phase 缺省时回退为 done', () => {
      const { hydrateFromHistory } = usePlanExecuteStore.getState();
      hydrateFromHistory({
        messageId: 'msg_1',
        phase: null,
        error: null,
        collapsedSteps: {},
        steps: [
          { step_id: 'step_1', step_index: 0, title: 'A', description: '', status: 'done' },
        ],
      });
      expect(usePlanExecuteStore.getState().phase).toBe('done');
    });
  });

  describe('HITL 互斥锁', () => {
    it('setHitlLock 切换 hitlLocked', () => {
      const { setHitlLock } = usePlanExecuteStore.getState();
      expect(usePlanExecuteStore.getState().hitlLocked).toBe(false);
      setHitlLock(true);
      expect(usePlanExecuteStore.getState().hitlLocked).toBe(true);
      setHitlLock(false);
      expect(usePlanExecuteStore.getState().hitlLocked).toBe(false);
    });

    it('锁定时 toggleStep 为 no-op', () => {
      const { toggleStep, setHitlLock } = usePlanExecuteStore.getState();
      setHitlLock(true);
      toggleStep('step-1');
      expect(usePlanExecuteStore.getState().collapsedSteps).toEqual({});
    });

    it('锁定时 applyPlanDelta（plan/execute）为 no-op，phase 不推进', () => {
      const { applyPlanDelta, setHitlLock } = usePlanExecuteStore.getState();
      setHitlLock(true);

      applyPlanDelta({
        phase: 'plan',
        plan: [{ step_id: 's1', title: 'T', description: 'D', status: 'pending' }],
      });
      expect(usePlanExecuteStore.getState().phase).toBe('idle');
      expect(usePlanExecuteStore.getState().rootIds).toEqual([]);

      applyPlanDelta({
        phase: 'execute',
        step_update: { id: 's1', status: 'running' },
      });
      expect(usePlanExecuteStore.getState().phase).toBe('idle');
    });

    it('解锁后 applyPlanDelta 正常推进', () => {
      const { applyPlanDelta, setHitlLock } = usePlanExecuteStore.getState();
      setHitlLock(true);
      applyPlanDelta({
        phase: 'plan',
        plan: [{ step_id: 's1', title: 'T', description: 'D', status: 'pending' }],
      });
      setHitlLock(false);
      applyPlanDelta({
        phase: 'plan',
        plan: [{ step_id: 's1', title: 'T', description: 'D', status: 'pending' }],
      });
      expect(usePlanExecuteStore.getState().phase).toBe('executing');
      expect(usePlanExecuteStore.getState().rootIds).toEqual(['s1']);
    });

    it('reset 清除互斥锁', () => {
      const { setHitlLock, reset } = usePlanExecuteStore.getState();
      setHitlLock(true);
      reset();
      expect(usePlanExecuteStore.getState().hitlLocked).toBe(false);
    });
  });

  describe('P2 修复：step_update 协议不一致的防御', () => {
    it('未知 step_id 的 execute 事件被忽略（状态引用不变，不抛错）', () => {
      const { applyPlanDelta } = usePlanExecuteStore.getState();
      applyPlanDelta({
        phase: 'plan',
        plan: [{ step_id: 's1', title: 'T', description: 'D', status: 'pending' }],
      });
      const before = usePlanExecuteStore.getState().items;

      applyPlanDelta({
        phase: 'execute',
        step_update: { id: 'ghost', status: 'done', result: 'x' },
      });

      expect(usePlanExecuteStore.getState().items).toBe(before);
      expect(usePlanExecuteStore.getState().items['ghost']).toBeUndefined();
    });

    it('空 id 的 execute 事件同样被忽略', () => {
      const { applyPlanDelta } = usePlanExecuteStore.getState();
      applyPlanDelta({
        phase: 'plan',
        plan: [{ step_id: 's1', title: 'T', description: 'D', status: 'pending' }],
      });
      const before = usePlanExecuteStore.getState().items;

      applyPlanDelta({ phase: 'execute', step_update: { id: '', status: 'running' } });

      expect(usePlanExecuteStore.getState().items).toBe(before);
    });
  });

  /**
   * P0-1 回归（2026-10-14）：后端步骤级重试会下发 `status: 'retrying'`
   * （dispatcher.ts step_finalize 的 retry 分支，经 event-bridge 原样透传）。
   * 修复前该状态不在前端白名单内：
   *   - store 直接落库 → PlanPipelineTree `STATUS_CONFIG['retrying']` 落空
   *   - 渲染 `config.className` 抛 TypeError → 整个任务面板崩溃
   */
  describe('P0-1：retrying / 未知状态的归一化', () => {
    it('normalizePlanStatus 接受白名单状态、拒绝未知状态', () => {
      expect(normalizePlanStatus('pending')).toBe('pending');
      expect(normalizePlanStatus('running')).toBe('running');
      expect(normalizePlanStatus('retrying')).toBe('retrying');
      expect(normalizePlanStatus('done')).toBe('done');
      expect(normalizePlanStatus('failed')).toBe('failed');
      expect(normalizePlanStatus('skipped')).toBe('skipped');
      // 未知值不得抛错，一律降级
      expect(normalizePlanStatus('exploded')).toBe('pending');
      expect(normalizePlanStatus(undefined)).toBe('pending');
      expect(normalizePlanStatus(null)).toBe('pending');
      expect(normalizePlanStatus(123)).toBe('pending');
    });

    it('execute 事件下发 retrying 时按原值落库（不再被降级为 pending）', () => {
      const { applyPlanDelta } = usePlanExecuteStore.getState();
      applyPlanDelta({
        phase: 'plan',
        plan: [{ step_id: 's1', title: 'T', description: 'D', status: 'pending' }],
      });
      applyPlanDelta({
        phase: 'execute',
        step_update: {
          id: 's1',
          status: 'retrying',
          retry_count: 1,
          max_attempts: 3,
          error: 'tool failed',
        },
      });

      const item = usePlanExecuteStore.getState().items['s1'];
      expect(item.status).toBe('retrying');
      expect(item.retry_count).toBe(1);
      expect(item.max_attempts).toBe(3);
      expect(item.error).toBe('tool failed');
      // 重试中的步骤应作为"当前步骤"跟踪
      expect(usePlanExecuteStore.getState().currentStepId).toBe('s1');
    });

    it('execute 事件下发未知状态时降级为 pending（不产生白名单外状态）', () => {
      const { applyPlanDelta } = usePlanExecuteStore.getState();
      applyPlanDelta({
        phase: 'plan',
        plan: [{ step_id: 's1', title: 'T', description: 'D', status: 'pending' }],
      });
      applyPlanDelta({ phase: 'execute', step_update: { id: 's1', status: 'totally-unknown' } });

      expect(usePlanExecuteStore.getState().items['s1'].status).toBe('pending');
    });

    it('execute 事件缺省 status 时保留原状态（不被降级覆盖）', () => {
      const { applyPlanDelta } = usePlanExecuteStore.getState();
      applyPlanDelta({
        phase: 'plan',
        plan: [{ step_id: 's1', title: 'T', description: 'D', status: 'pending' }],
      });
      applyPlanDelta({ phase: 'execute', step_update: { id: 's1', status: 'running' } });
      applyPlanDelta({ phase: 'execute', step_update: { id: 's1' } as never });

      expect(usePlanExecuteStore.getState().items['s1'].status).toBe('running');
    });

    it('plan 全量事件中的未知状态同样被归一化', () => {
      const { applyPlanDelta } = usePlanExecuteStore.getState();
      applyPlanDelta({
        phase: 'plan',
        plan: [{ step_id: 's1', title: 'T', description: 'D', status: 'weird' }],
      });

      expect(usePlanExecuteStore.getState().items['s1'].status).toBe('pending');
    });

    it('P0-3：批量 step_updates 按顺序应用（提前交付收敛一次跳过多个步骤）', () => {
      const { applyPlanDelta } = usePlanExecuteStore.getState();
      applyPlanDelta({
        phase: 'plan',
        plan: [
          { step_id: 's1', title: '框架', description: '', status: 'done' },
          { step_id: 's2', title: '章节A', description: '', status: 'pending' },
          { step_id: 's3', title: '章节B', description: '', status: 'pending' },
          { step_id: 's4', title: '整合', description: '', status: 'pending' },
        ],
      });

      applyPlanDelta({
        phase: 'execute',
        step_updates: [
          { id: 's2', status: 'skipped', result: '前序步骤已产出完整交付物，本步已跳过' },
          { id: 's3', status: 'skipped', result: '前序步骤已产出完整交付物，本步已跳过' },
          { id: 's4', status: 'running' },
        ],
      });

      const { items, currentStepId } = usePlanExecuteStore.getState();
      expect(items['s2'].status).toBe('skipped');
      expect(items['s3'].status).toBe('skipped');
      expect(items['s4'].status).toBe('running');
      // 最后一条 running 决定当前步骤
      expect(currentStepId).toBe('s4');
      // 跳过原因保留在 result，供面板展示
      expect(items['s2'].result).toContain('已跳过');
    });

    it('P0-3：批量更新中的未知步骤被跳过，其余照常应用', () => {
      const { applyPlanDelta } = usePlanExecuteStore.getState();
      applyPlanDelta({
        phase: 'plan',
        plan: [{ step_id: 's1', title: 'T', description: '', status: 'pending' }],
      });

      applyPlanDelta({
        phase: 'execute',
        step_updates: [
          { id: 'ghost', status: 'skipped' },
          { id: 's1', status: 'running' },
        ],
      });

      expect(usePlanExecuteStore.getState().items['ghost']).toBeUndefined();
      expect(usePlanExecuteStore.getState().items['s1'].status).toBe('running');
    });

    it('P1-3：历史恢复时按步骤状态反推 phase（后端说 done 但步骤未完成 → incomplete）', () => {
      const { hydrateFromHistory } = usePlanExecuteStore.getState();
      hydrateFromHistory({
        messageId: 'msg_1',
        // 后端历史数据恒为 done（P1-3 修复前的落库值）
        phase: 'done',
        error: null,
        collapsedSteps: {},
        steps: [
          { step_id: 's1', step_index: 0, title: '框架', description: '', status: 'running' },
          { step_id: 's2', step_index: 1, title: '章节A', description: '', status: 'pending' },
        ],
      } as unknown as PlanSnapshot);

      // 修复前：phase='done' → 徽章"已完成" + 进度"已完成 0/2 步"自相矛盾
      expect(usePlanExecuteStore.getState().phase).toBe('incomplete');
    });

    it('P1-3：步骤全部终态时仍沿用后端 phase（行为不回归）', () => {
      const { hydrateFromHistory } = usePlanExecuteStore.getState();
      hydrateFromHistory({
        messageId: 'msg_1',
        phase: 'done',
        error: null,
        collapsedSteps: {},
        steps: [
          { step_id: 's1', step_index: 0, title: 'A', description: '', status: 'done' },
          { step_id: 's2', step_index: 1, title: 'B', description: '', status: 'skipped' },
        ],
      } as unknown as PlanSnapshot);

      expect(usePlanExecuteStore.getState().phase).toBe('done');
    });

    it('P1-3：后端 phase=error 时保持 error（错误优先）', () => {
      const { hydrateFromHistory } = usePlanExecuteStore.getState();
      hydrateFromHistory({
        messageId: 'msg_1',
        phase: 'error',
        error: '执行失败',
        collapsedSteps: {},
        steps: [{ step_id: 's1', step_index: 0, title: 'A', description: '', status: 'pending' }],
      } as unknown as PlanSnapshot);

      expect(usePlanExecuteStore.getState().phase).toBe('error');
    });

    it('P1-3：后端 phase=incomplete 且步骤未完成 → incomplete', () => {
      const { hydrateFromHistory } = usePlanExecuteStore.getState();
      hydrateFromHistory({
        messageId: 'msg_1',
        phase: 'incomplete',
        error: null,
        collapsedSteps: {},
        steps: [{ step_id: 's1', step_index: 0, title: 'A', description: '', status: 'running' }],
      } as unknown as PlanSnapshot);

      expect(usePlanExecuteStore.getState().phase).toBe('incomplete');
    });

    it('P2-3：planning_failed → 面板提示"未能生成执行计划"', () => {
      const { applyPlanDelta } = usePlanExecuteStore.getState();
      applyPlanDelta({
        phase: 'plan',
        plan: [],
        planning_failed: true,
      });

      expect(usePlanExecuteStore.getState().planWarning).toContain('未能生成执行计划');
      expect(usePlanExecuteStore.getState().rootIds).toEqual([]);
    });

    it('P1-4：truncated_steps → 面板提示被丢弃的步数', () => {
      const { applyPlanDelta } = usePlanExecuteStore.getState();
      applyPlanDelta({
        phase: 'plan',
        plan: [{ step_id: 's1', title: 'T', description: '', status: 'pending' }],
        truncated_steps: 3,
      });

      expect(usePlanExecuteStore.getState().planWarning).toContain('末尾 3 步未纳入执行');
    });

    it('P2-4：step_update.truncated 被记录（输出可能被截断）', () => {
      const { applyPlanDelta } = usePlanExecuteStore.getState();
      applyPlanDelta({
        phase: 'plan',
        plan: [{ step_id: 's1', title: 'T', description: '', status: 'pending' }],
      });
      applyPlanDelta({ phase: 'execute', step_update: { id: 's1', status: 'done', truncated: true } });

      expect(usePlanExecuteStore.getState().items['s1'].truncated).toBe(true);
    });

    it('历史恢复时 DB 中的未知状态同样被归一化', () => {
      const { hydrateFromHistory } = usePlanExecuteStore.getState();
      hydrateFromHistory({
        messageId: 'msg_1',
        phase: 'done',
        error: null,
        collapsedSteps: {},
        steps: [
          {
            step_id: 's1',
            step_index: 0,
            title: 'T',
            description: 'D',
            status: 'legacy-unknown' as never,
          },
        ],
      } as unknown as PlanSnapshot);

      expect(usePlanExecuteStore.getState().items['s1'].status).toBe('pending');
    });
  });
});

