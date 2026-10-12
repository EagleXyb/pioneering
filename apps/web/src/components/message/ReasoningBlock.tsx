/**
 * 深度思考折叠块（TAO 的 Thought 段）
 *
 * 截图同款交互：
 * - 顶部一行“深度思考 + 箭头”的下拉框，默认隐藏繁琐的推理轨迹，保留可追溯性
 * - 展开后为轻引用排版（左侧 2px 细竖线 + 中灰正文），与正文段落形成清晰的层级区分
 * - 流式期间自动展开并跟随最新内容（图标呼吸提示）；本段结束后自动收起
 *   （仅响应“流式 → 终态”的跃迁，用户手动展开后不再被打断）
 *
 * 一个 ReAct 轮次对应一个实例：多轮叙述在消息正文里与工具动作行交错排列。
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Markdown } from '@/components/Markdown';
import { ThinkingIcon } from '@/components/icons/customIcons';
import './taoBlocks.css';

interface Props {
  /** 思考正文（Markdown） */
  text: string;
  /** 该段是否仍在流式输出 */
  streaming?: boolean;
}

export function ReasoningBlock({ text, streaming = false }: Props) {
  // 流式期间展开、终态收起；用户点击后以手动状态为准
  const [open, setOpen] = useState(streaming);
  const prevStreamingRef = useRef(streaming);

  useEffect(() => {
    const prev = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (prev && !streaming) setOpen(false);
  }, [streaming]);

  // 流式期间自动跟随最新内容（思考区限高内部滚动）
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !streaming) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, open, streaming]);

  return (
    <div
      className={`tao-reasoning${open ? ' is-open' : ''}${streaming ? ' is-streaming' : ''}`}
    >
      <button
        type="button"
        className="tao-reasoning-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ThinkingIcon className="tao-reasoning-icon" />
        <span className="tao-reasoning-title">深度思考</span>
        <ChevronRight size={14} strokeWidth={2.2} className="tao-reasoning-chevron" />
      </button>

      <div
        className={`tao-reasoning-body-wrap${open ? ' is-open' : ''}`}
        aria-hidden={!open}
        inert={!open ? true : undefined}
      >
        <div className="tao-reasoning-body-inner">
          <div ref={bodyRef} className="tao-reasoning-body">
            <Markdown content={text} />
          </div>
        </div>
      </div>
    </div>
  );
}
