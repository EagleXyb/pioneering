/**
 * artifactStore 单元测试
 *
 * 覆盖场景：
 *   - 初始状态
 *   - openArtifact 写入 activeArtifact（自动填充 openedAt）
 *   - closeArtifact 清空
 *   - highlightMessage / clearHighlight 信号量机制
 *   - openArtifact 时清掉残留 highlightMessageId
 *   - reset 全量重置
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useArtifactStore } from './artifactStore';

describe('artifactStore', () => {
  beforeEach(() => {
    // 每个 case 前重置 store，避免互相污染
    useArtifactStore.getState().reset();
  });

  it('初始状态：activeArtifact 与 highlightMessageId 都为 null', () => {
    const state = useArtifactStore.getState();
    expect(state.activeArtifact).toBeNull();
    expect(state.highlightMessageId).toBeNull();
  });

  it('openArtifact 写入 activeArtifact 并自动填充 openedAt', () => {
    const before = Date.now();
    useArtifactStore.getState().openArtifact({
      messageId: 'msg-1',
      type: 'html',
      content: '<div></div>',
    });
    const after = Date.now();

    const { activeArtifact } = useArtifactStore.getState();
    expect(activeArtifact).not.toBeNull();
    expect(activeArtifact!.messageId).toBe('msg-1');
    expect(activeArtifact!.type).toBe('html');
    expect(activeArtifact!.content).toBe('<div></div>');
    expect(activeArtifact!.openedAt).toBeGreaterThanOrEqual(before);
    expect(activeArtifact!.openedAt).toBeLessThanOrEqual(after);
  });

  it('openArtifact 保留可选 language 字段', () => {
    useArtifactStore.getState().openArtifact({
      messageId: 'msg-2',
      type: 'code',
      content: 'print(1)',
      language: 'python',
    });
    const { activeArtifact } = useArtifactStore.getState();
    expect(activeArtifact!.language).toBe('python');
  });

  it('closeArtifact 清空 activeArtifact', () => {
    useArtifactStore.getState().openArtifact({
      messageId: 'msg-3',
      type: 'svg',
      content: '<svg></svg>',
    });
    expect(useArtifactStore.getState().activeArtifact).not.toBeNull();

    useArtifactStore.getState().closeArtifact();
    expect(useArtifactStore.getState().activeArtifact).toBeNull();
  });

  it('highlightMessage 设置 highlightMessageId', () => {
    useArtifactStore.getState().highlightMessage('msg-target');
    expect(useArtifactStore.getState().highlightMessageId).toBe('msg-target');
  });

  it('clearHighlight 清空 highlightMessageId', () => {
    useArtifactStore.getState().highlightMessage('msg-target');
    useArtifactStore.getState().clearHighlight();
    expect(useArtifactStore.getState().highlightMessageId).toBeNull();
  });

  it('openArtifact 时清掉残留的 highlightMessageId（避免脏信号）', () => {
    useArtifactStore.getState().highlightMessage('stale-msg');
    expect(useArtifactStore.getState().highlightMessageId).toBe('stale-msg');

    useArtifactStore.getState().openArtifact({
      messageId: 'new-msg',
      type: 'html',
      content: '<p></p>',
    });
    expect(useArtifactStore.getState().highlightMessageId).toBeNull();
  });

  it('closeArtifact 同时清空 activeArtifact 和 highlightMessageId', () => {
    useArtifactStore.getState().openArtifact({
      messageId: 'msg-4',
      type: 'html',
      content: '<div></div>',
    });
    useArtifactStore.getState().highlightMessage('msg-4');

    useArtifactStore.getState().closeArtifact();
    const state = useArtifactStore.getState();
    expect(state.activeArtifact).toBeNull();
    expect(state.highlightMessageId).toBeNull();
  });

  it('reset 清空所有状态', () => {
    useArtifactStore.getState().openArtifact({
      messageId: 'msg-5',
      type: 'html',
      content: '<div></div>',
    });
    useArtifactStore.getState().highlightMessage('msg-5');

    useArtifactStore.getState().reset();
    const state = useArtifactStore.getState();
    expect(state.activeArtifact).toBeNull();
    expect(state.highlightMessageId).toBeNull();
  });

  it('连续 openArtifact 替换前一个', () => {
    useArtifactStore.getState().openArtifact({
      messageId: 'msg-a',
      type: 'html',
      content: '<a></a>',
    });
    useArtifactStore.getState().openArtifact({
      messageId: 'msg-b',
      type: 'svg',
      content: '<b></b>',
    });
    const { activeArtifact } = useArtifactStore.getState();
    expect(activeArtifact!.messageId).toBe('msg-b');
    expect(activeArtifact!.type).toBe('svg');
  });
});
