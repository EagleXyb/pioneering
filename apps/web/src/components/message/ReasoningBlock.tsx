/**
 * 深度思考折叠块（TAO 的 Thought 段）
 *
 * 截图同款交互：
 * - 顶部一行标题 + 箭头的下拉框，默认隐藏繁琐的推理轨迹，保留可追溯性
 * - 标题随运行阶段变化：准备中（Agent 已启动）→ 开始思考（推理进行中）→
 *   深度思考（收尾后默认收起，点击可展开回溯）
 * - 展开后为轻引用排版（左侧 4px 竖线 + 深灰正文；整个块最大高度 220px，
 *   超出部分内部滚动），与正文段落形成清晰的层级区分
 * - 流式期间自动展开并跟随最新内容（标题文字呼吸提示）；本段结束后自动收起
 *
 * 一个 ReAct 轮次对应一个实例：多轮叙述在消息正文里与工具动作行交错排列。
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Markdown } from '@/components/Markdown';
import { ThinkingIcon } from '@/components/icons/customIcons';
import type { TaoReasoningPhase } from '@/lib/taoBlocks';
import './taoBlocks.css';

interface Props {
  /** 思考正文（Markdown） */
  text: string;
  /** 该段是否仍在流式输出 */
  streaming?: boolean;
  /** 运行阶段：preparing=准备中（尚无内容）、thinking=思考进行中；缺省视为思考中 */
  phase?: TaoReasoningPhase;
}

export function ReasoningBlock({ text, streaming = false, phase }: Props) {
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

  // 标题随运行阶段变化：准备中 → 开始思考 →（收尾后）深度思考，默认收起
  const title = streaming ? (phase === 'preparing' ? '准备中' : '开始思考') : '深度思考';

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
        <span className="tao-reasoning-title">{title}</span>
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
