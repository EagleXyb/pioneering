/**
 * 回到底部悬浮按钮（对话 / 分析 / 任务三模式共用）
 *
 * 挂在消息滚动容器末尾：sticky 悬浮在滚动可视区底部居中，净占位 0
 * （不改变滚动几何），样式见 styles/conversation.css 的 `.chat-scroll-bottom*`。
 * 显隐由调用方依据「底部哨兵是否可见」决定；点击后平滑滚动到 targetRef
 * （通常是列表末尾的底部哨兵），并尊重系统「减少动态效果」设置。
 */
import { ArrowDown } from 'lucide-react';
import type { RefObject } from 'react';

interface Props {
  /** 是否显示：离开底部时显示 */
  visible: boolean;
  /** 点击后滚动到的目标元素（列表末尾的底部哨兵） */
  targetRef: RefObject<HTMLElement | null>;
}

export function ScrollToBottomButton({ visible, targetRef }: Props) {
  /** 回到最新消息：平滑滚动到底部（尊重系统"减少动态效果"设置） */
  const handleClick = () => {
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    targetRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  return (
    <div
      className={`chat-scroll-bottom${visible ? ' is-visible' : ''}`}
      aria-hidden={!visible}
      inert={!visible ? true : undefined}
    >
      <button
        type="button"
        className="chat-scroll-bottom-btn chat-tooltip"
        data-tooltip="回到底部"
        aria-label="回到底部"
        onClick={handleClick}
      >
        {/* 图标与输入区发送按钮（32×32 / 16）同规格 */}
        <ArrowDown size={16} strokeWidth={2.2} />
      </button>
    </div>
  );
}
