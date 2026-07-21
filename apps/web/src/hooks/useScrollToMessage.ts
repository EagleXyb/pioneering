import { useEffect } from 'react';
import { useArtifactStore } from '@/store/artifactStore';

/**
 * "跳转到源消息" 反向联动 Hook
 *
 * 设计参考：apps/web/docs/输入框实现深度分析.md §2.5（store 作为事件总线）。
 * 也参考了 OpenWebUI 中 Overview 节点点击 → scrollIntoView 的实现模式
 * （docs/lib/components/chat/Overview/View.svelte:181-185 +
 *  docs/lib/components/chat/Chat.svelte:516-552）。
 *
 * 工作流程：
 *   1. ArtifactPanel 点击"跳转到源消息" → store.highlightMessage(messageId)
 *   2. 本 Hook 监听 highlightMessageId 变化
 *   3. 在 containerRef 内查找 [data-message-id="..."] 节点
 *   4. scrollIntoView + 添加高亮 class
 *   5. 1.5s 后移除高亮 class 并 clearHighlight（避免重复触发）
 *
 * 注意事项：
 *   - useEffect cleanup 必须清掉 setTimeout，防止快速连续点击产生多个 timer
 *   - 找不到节点时不报错（消息可能已被删除），但仍 clearHighlight 避免卡住
 *   - 高亮 class 名 'task-message--highlight' 与 task.css 中的动画绑定
 */

const HIGHLIGHT_DURATION_MS = 1500;
const HIGHLIGHT_CLASS = 'task-message--highlight';

export function useScrollToMessage<T extends HTMLElement>(
  containerRef: React.RefObject<T>,
) {
  const highlightMessageId = useArtifactStore((s) => s.highlightMessageId);
  const clearHighlight = useArtifactStore((s) => s.clearHighlight);

  useEffect(() => {
    if (!highlightMessageId || !containerRef.current) return;

    const el = containerRef.current.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(highlightMessageId)}"]`,
    );

    if (!el) {
      // 节点不存在（消息可能已删除），清掉信号避免卡住
      clearHighlight();
      return;
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add(HIGHLIGHT_CLASS);

    const timer = window.setTimeout(() => {
      el.classList.remove(HIGHLIGHT_CLASS);
      clearHighlight();
    }, HIGHLIGHT_DURATION_MS);

    return () => {
      window.clearTimeout(timer);
      // 防御性：组件卸载时也移除高亮 class，避免残留
      el.classList.remove(HIGHLIGHT_CLASS);
    };
  }, [highlightMessageId, containerRef, clearHighlight]);
}
