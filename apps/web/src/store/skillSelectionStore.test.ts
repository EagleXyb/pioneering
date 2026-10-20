/**
 * skillSelectionStore 单元测试 —— 技能选择的单一事实源（P0 选择→执行）
 *
 * 覆盖：localStorage 持久化、按模式隔离、未 hydrate 时的读取回退、去重归一。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  _resetSkillSelectionForTest,
  getSelectedSkills,
  readStoredSkills,
  skillStorageKey,
  useSkillSelectionStore,
} from './skillSelectionStore';

beforeEach(() => {
  localStorage.clear();
  _resetSkillSelectionForTest();
});

describe('skillSelectionStore', () => {
  it('持久化键按模式隔离', () => {
    expect(skillStorageKey('pro')).toBe('skill-select:pro');
    expect(skillStorageKey('task')).toBe('skill-select:task');
  });

  it('未选择时读取为空数组', () => {
    expect(readStoredSkills('pro')).toEqual([]);
    expect(getSelectedSkills('pro')).toEqual([]);
  });

  it('toggle 写入 localStorage 并更新状态', () => {
    useSkillSelectionStore.getState().toggle('pro', 'math');

    expect(useSkillSelectionStore.getState().byMode.pro).toEqual(['math']);
    expect(JSON.parse(localStorage.getItem('skill-select:pro') as string)).toEqual([
      'math',
    ]);
    expect(getSelectedSkills('pro')).toEqual(['math']);
  });

  it('再次 toggle 取消勾选', () => {
    const { toggle } = useSkillSelectionStore.getState();
    toggle('pro', 'math');
    toggle('pro', 'writer');
    toggle('pro', 'math');

    expect(getSelectedSkills('pro')).toEqual(['writer']);
  });

  it('pro 与 task 互不影响', () => {
    const { toggle } = useSkillSelectionStore.getState();
    toggle('pro', 'math');
    toggle('task', 'writer');

    expect(getSelectedSkills('pro')).toEqual(['math']);
    expect(getSelectedSkills('task')).toEqual(['writer']);
  });

  it('未 hydrate 时读取回退到 localStorage', () => {
    localStorage.setItem('skill-select:task', JSON.stringify(['writer']));
    // store 中尚无该模式的缓存
    expect(useSkillSelectionStore.getState().byMode.task).toBeUndefined();
    expect(getSelectedSkills('task')).toEqual(['writer']);
  });

  it('hydrate 从 localStorage 载入且幂等（不覆盖已变更状态）', () => {
    localStorage.setItem('skill-select:pro', JSON.stringify(['math']));
    const store = useSkillSelectionStore.getState();

    store.hydrate('pro');
    expect(useSkillSelectionStore.getState().byMode.pro).toEqual(['math']);

    // 已变更后再次 hydrate 不应回滚
    useSkillSelectionStore.getState().setSelected('pro', []);
    useSkillSelectionStore.getState().hydrate('pro');
    expect(useSkillSelectionStore.getState().byMode.pro).toEqual([]);
  });

  it('setSelected 去重并丢弃空白项', () => {
    useSkillSelectionStore.getState().setSelected('pro', ['math', 'math', '', '  ']);
    expect(getSelectedSkills('pro')).toEqual(['math']);
  });

  it('localStorage 内容损坏时按未选择处理（不抛异常）', () => {
    localStorage.setItem('skill-select:pro', '{not-json');
    expect(readStoredSkills('pro')).toEqual([]);
  });

  it('localStorage 中非字符串项被过滤', () => {
    localStorage.setItem('skill-select:pro', JSON.stringify(['math', 1, null]));
    expect(readStoredSkills('pro')).toEqual(['math']);
  });
});
