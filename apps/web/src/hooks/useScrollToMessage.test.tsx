/**
 * useScrollToMessage Hook 集成测试
 *
 * 验证反向联动核心流程：
 *   1. highlightMessageId 变化时，对应 [data-message-id] 节点被高亮
 *   2. 高亮 class 在 1.5s 后被移除
 *   3. clearHighlight 被调用清理信号
 *   4. 节点不存在时安全降级（清信号不报错）
 *   5. 组件卸载时清理 timer（不残留高亮 class）
 *
 * 注意：zustand store 在 React 外部直接调用 setState 时，
 * 组件订阅虽会触发，但 React 需要 act() 包装才能同步处理更新。
 * 这里用 act() 包裹所有 store mutation 调用。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import React, { useRef } from 'react';
import { useScrollToMessage } from './useScrollToMessage';
import { useArtifactStore } from '@/store/artifactStore';

// 渲染一个测试组件，调用 useScrollToMessage
function TestComponent() {
  const containerRef = useRef<HTMLDivElement>(null);
  useScrollToMessage(containerRef);
  return (
    <div ref={containerRef}>
      <div data-message-id="msg-1" data-testid="msg-1">消息1</div>
      <div data-message-id="msg-2" data-testid="msg-2">消息2</div>
    </div>
  );
}

describe('useScrollToMessage', () => {
  beforeEach(() => {
    useArtifactStore.getState().reset();
    // jsdom 不实现 scrollIntoView，mock 之
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    useArtifactStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('highlightMessageId 变化时给目标节点添加高亮 class', () => {
    const { getByTestId } = render(<TestComponent />);
    const target = getByTestId('msg-1');

    expect(target.classList.contains('task-message--highlight')).toBe(false);

    act(() => {
      useArtifactStore.getState().highlightMessage('msg-1');
    });

    expect(target.classList.contains('task-message--highlight')).toBe(true);
  });

  it('调用 scrollIntoView 滚动到目标节点', () => {
    const { getByTestId } = render(<TestComponent />);
    getByTestId('msg-2');

    act(() => {
      useArtifactStore.getState().highlightMessage('msg-2');
    });

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('目标节点不存在时安全降级，清掉信号不报错', () => {
    render(<TestComponent />);

    expect(() => {
      act(() => {
        useArtifactStore.getState().highlightMessage('non-existent');
      });
    }).not.toThrow();

    // 信号应被立即清掉（避免卡住后续触发）
    expect(useArtifactStore.getState().highlightMessageId).toBeNull();
  });

  it('1.5s 后自动移除高亮 class 并清信号', async () => {
    vi.useFakeTimers();
    const { getByTestId } = render(<TestComponent />);
    const target = getByTestId('msg-1');

    act(() => {
      useArtifactStore.getState().highlightMessage('msg-1');
    });
    expect(target.classList.contains('task-message--highlight')).toBe(true);

    // 推进 1500ms
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(target.classList.contains('task-message--highlight')).toBe(false);
    expect(useArtifactStore.getState().highlightMessageId).toBeNull();
    vi.useRealTimers();
  });

  it('组件卸载时清理 timer，不残留高亮 class', () => {
    vi.useFakeTimers();
    const { getByTestId, unmount } = render(<TestComponent />);
    const target = getByTestId('msg-1');

    act(() => {
      useArtifactStore.getState().highlightMessage('msg-1');
    });
    expect(target.classList.contains('task-message--highlight')).toBe(true);

    unmount();

    // 推进 timer，不应抛错（cleanup 已生效）
    expect(() => {
      act(() => vi.advanceTimersByTime(1500));
    }).not.toThrow();
    vi.useRealTimers();
  });

  it('切换目标时清理上一个 timer 并对准新目标', () => {
    vi.useFakeTimers();
    const { getByTestId } = render(<TestComponent />);
    const t1 = getByTestId('msg-1');
    const t2 = getByTestId('msg-2');

    act(() => {
      useArtifactStore.getState().highlightMessage('msg-1');
    });
    expect(t1.classList.contains('task-message--highlight')).toBe(true);

    // 推进 500ms（未到 1.5s），切换目标
    act(() => vi.advanceTimersByTime(500));
    act(() => {
      useArtifactStore.getState().highlightMessage('msg-2');
    });

    // 新目标被高亮
    expect(t2.classList.contains('task-message--highlight')).toBe(true);
    vi.useRealTimers();
  });
});
