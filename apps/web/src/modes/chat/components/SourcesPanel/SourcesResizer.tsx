import { useCallback, useEffect, useRef } from 'react';
import {
  useAppStore,
  MIN_SOURCES_WIDTH,
  MAX_SOURCES_WIDTH,
} from '../../../../store/appStore';

/**
 * chat 中间栏与参考来源面板之间的可拖动分隔条（实现对齐 TaskResizer）。
 */
export function SourcesResizer() {
  const setSourcesWidth = useAppStore((s) => s.setSourcesWidth);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = useAppStore.getState().sourcesWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      // 向左拖动（dx<0）：面板变宽
      const dx = e.clientX - startX.current;
      const next = Math.min(
        MAX_SOURCES_WIDTH,
        Math.max(MIN_SOURCES_WIDTH, startWidth.current - dx),
      );
      setSourcesWidth(next);
    };
    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [setSourcesWidth]);

  return (
    <div
      className="sources-resizer"
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation="vertical"
      aria-label="拖动调整来源面板宽度"
    />
  );
}
