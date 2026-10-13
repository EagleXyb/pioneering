/**
 * 过程容器（TAO 全流程折叠，借鉴豆包工作）
 *
 * 一次 run 的全部过程块（思考段 / 过程叙述 / 工具动作行）收进一个折叠容器：
 * - 运行中：展开并逐块流出，标题显示状态与实时「已用时」（有进度感）；
 * - 终态：自动收起为一行摘要（`已完成 · 耗时 X 分 Y 秒`），
 *   正文区只留最终回答 —— 多轮任务不再把消息撑长；
 * - 展开后仍是原有的 TAO 交错结构（思考块仍可继续展开看思维链、动作行可看参数与观测）。
 *
 * 与豆包的差异：豆包不展示推理（CoT），我们保留「深度思考」可展开 —— 默认简洁、
 * 点开可追溯，两种诉求兼得。
 *
 * 耗时取值：优先用后端 run 记录的 durationMs（历史消息可用），
 * 实时流则本地计时（容器挂载即开始，终态冻结）。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import './taoBlocks.css';

interface Props {
  /** 是否仍在流式输出 */
  streaming?: boolean;
  /** 后端 run 记录耗时（毫秒）；历史消息由 run 提供，实时流缺省时本地计时 */
  durationMs?: number | null;
  children: ReactNode;
}

/** 毫秒 → 「1 分 37 秒」/「8 秒」 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}

export function ProcessContainer({
  streaming = false,
  durationMs = null,
  children,
}: Props) {
  // 运行中展开；流式 → 终态的跃迁自动收起（用户手动展开后不再被打断）
  const [open, setOpen] = useState(streaming);
  const prevStreamingRef = useRef(streaming);
  const mountedAtRef = useRef(Date.now());
  const frozenMsRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const prev = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (prev && !streaming) {
      frozenMsRef.current = Date.now() - mountedAtRef.current;
      setOpen(false);
    }
  }, [streaming]);

  // 运行中的秒级计时（终态后停止，避免无意义重渲染）
  useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - mountedAtRef.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [streaming]);

  const shownMs = durationMs ?? (streaming ? elapsedMs : frozenMsRef.current);

  // 摘要措辞（只保留"状态 + 耗时"，检索/工具次数由过程内容本身表达）：
  //   终态：已完成 · 耗时 8 分 21 秒
  //   运行中：运行中 · 已用 12 秒
  const timePart =
    shownMs === null || shownMs === undefined
      ? ''
      : streaming
        ? ` · 已用 ${formatDuration(shownMs)}`
        : ` · 耗时 ${formatDuration(shownMs)}`;
  /** 可见文案 = 可访问名的一部分（读屏与测试口径一致） */
  const text = `${streaming ? '运行中' : '已完成'}${timePart}`;

  return (
    <div className={`tao-process${open ? ' is-open' : ''}${streaming ? ' is-streaming' : ''}`}>
      <button
        type="button"
        className="tao-process-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        // 可访问名固定带「执行过程」前缀（含规模/耗时），便于读屏与测试稳定命中
        aria-label={`执行过程，${text}`}
      >
        {streaming && <span className="tao-process-dot" aria-hidden="true" />}
        <span className="tao-process-meta">{text}</span>
        <ChevronRight size={14} strokeWidth={2.2} className="tao-process-chevron" />
      </button>

      <div
        className={`tao-process-body-wrap${open ? ' is-open' : ''}`}
        aria-hidden={!open}
        inert={!open ? true : undefined}
      >
        <div className="tao-process-body-inner">
          <div className="tao-process-body">{children}</div>
        </div>
      </div>
    </div>
  );
}
