import { useCallback, useEffect, useRef } from 'react';
import {
  useAppStore,
  MIN_PIPELINE_WIDTH,
  MAX_PIPELINE_WIDTH,
} from '../../../store/appStore';

/**
 * 中间栏与右侧面板之间的可拖动分隔条。
 *
 * 视觉上为 1px 竖线（保持与原 border-left 一致的分隔效果），
 * 但命中区放宽到 5px 以便于拖拽。拖动时实时更新 appStore.pipelineWidth，
 * 中间栏（flex:1）与右侧面板宽度随之联动。
 */
export function TaskResizer() {
  const setPipelineWidth = useAppStore((s) => s.setPipelineWidth);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = useAppStore.getState().pipelineWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      // 向右拖动（dx>0）：右侧面板变窄；向左拖动：变宽
      const dx = e.clientX - startX.current;
      const next = Math.min(
        MAX_PIPELINE_WIDTH,
        Math.max(MIN_PIPELINE_WIDTH, startWidth.current - dx),
      );
      setPipelineWidth(next);
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
  }, [setPipelineWidth]);

  return (
    <div
      className="task-resizer"
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation="vertical"
      aria-label="拖动调整面板宽度"
    />
  );
}
