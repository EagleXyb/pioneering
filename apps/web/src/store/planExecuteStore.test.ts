import { beforeEach, describe, expect, it } from 'vitest';
import { usePlanExecuteStore } from './planExecuteStore';

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
  });
});
