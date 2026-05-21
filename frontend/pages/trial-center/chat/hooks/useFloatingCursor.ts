import { useEffect, useRef, useCallback } from 'react';
import type { RefObject } from 'react';
import { getLastTextNode } from '../../utils/getLastTextNode';
import type { FloatingCursorRef } from '../components/FloatingCursor';

export function useFloatingCursor(
  content: string,
  isLoading: boolean,
  markdownContainerRef: RefObject<HTMLElement | null>,
  cursorRef: RefObject<FloatingCursorRef | null>
) {
  const rafIdRef = useRef<number | null>(null);
  const isLoadingRef = useRef(isLoading);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  const updateCursorPosition = useCallback(() => {
    if (!markdownContainerRef.current || !cursorRef.current) return;
    if (!isLoadingRef.current) return;
    const container = markdownContainerRef.current;

    const lastTextNode = getLastTextNode(container);
    if (!lastTextNode) {
      cursorRef.current.hide();
      return;
    }

    const probe = document.createTextNode('');
    lastTextNode.parentNode?.insertBefore(probe, lastTextNode.nextSibling);

    const range = document.createRange();
    range.setStart(probe, 0);
    range.setEnd(probe, 0);
    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const x = rect.left - containerRect.left;
    const y = rect.top - containerRect.top;

    cursorRef.current.updatePosition(x, y);

    probe.remove();
  }, [markdownContainerRef, cursorRef]);

  useEffect(() => {
    if (!isLoading) {
      cursorRef.current?.hide();
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      return;
    }

    const scheduleUpdate = () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = requestAnimationFrame(() => {
        updateCursorPosition();
        rafIdRef.current = null;
      });
    };

    scheduleUpdate();

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
