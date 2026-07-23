import { beforeEach, describe, expect, it } from 'vitest';
import { usePlanExecuteStore } from './planExecuteStore';
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
});

