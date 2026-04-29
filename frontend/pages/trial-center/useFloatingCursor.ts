import { useEffect, useRef, useCallback } from 'react';
import type { RefObject } from 'react';
import { getLastTextNode } from './getLastTextNode';
import type { FloatingCursorRef } from './FloatingCursor';

export function useFloatingCursor(
  content: string,
  isLoading: boolean,
  markdownContainerRef: RefObject<HTMLElement | null>,
  cursorRef: RefObject<FloatingCursorRef | null>
) {
  const rafIdRef = useRef<number | null>(null);
  const isLoadingRef = useRef(isLoading);

  // 保持 ref 与 state 同步，供非 effect 回调使用
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  const updateCursorPosition = useCallback(() => {
    if (!markdownContainerRef.current || !cursorRef.current) return;
    // 流式输出结束后，不再更新光标位置
    if (!isLoadingRef.current) return;
    const container = markdownContainerRef.current;

    // 1. 找到最后一个文本节点
    const lastTextNode = getLastTextNode(container);
    if (!lastTextNode) {
      cursorRef.current.hide();
      return;
    }

    // 2. 创建零宽度探测节点，插入到最后一个文本节点的后面
    const probe = document.createTextNode('');
    lastTextNode.parentNode?.insertBefore(probe, lastTextNode.nextSibling);

    // 3. 获取探测节点的位置
    const range = document.createRange();
    range.setStart(probe, 0);
    range.setEnd(probe, 0);
    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // 4. 计算相对坐标
    const x = rect.left - containerRect.left;
    const y = rect.top - containerRect.top;

    // 5. 移动光标
    cursorRef.current.updatePosition(x, y);

    // 6. 清理探测节点
    probe.remove();
  }, [markdownContainerRef, cursorRef]);

  useEffect(() => {
    if (!isLoading) {
      cursorRef.current?.hide();
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      return;
    }

    // 流式更新时，使用 requestAnimationFrame 节流
    const scheduleUpdate = () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = requestAnimationFrame(() => {
        updateCursorPosition();
        rafIdRef.current = null;
      });
    };

    scheduleUpdate();

    // 监听容器大小变化（换行导致高度改变时重新定位）
    const container = markdownContainerRef.current;
    if (!container) return;
    const resizeObserver = new ResizeObserver(() => scheduleUpdate());
    resizeObserver.observe(container);
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [content, isLoading, markdownContainerRef, cursorRef, updateCursorPosition]);

  // 滚动时重新定位（仅在加载中生效）
  useEffect(() => {
    const container = markdownContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      if (!isLoadingRef.current) return;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = requestAnimationFrame(updateCursorPosition);
    };
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [markdownContainerRef, updateCursorPosition]);
}
