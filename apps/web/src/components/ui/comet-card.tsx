/**
 * CometCard ——「彗星卡」容器：指针跟随的 3D 倾斜 + 指针处辉光。
 *
 * 视觉与交互对齐 ui.astonity.com 的 CometCard：
 *   · 外层 perspective，内层 preserve-3d + rotateX/rotateY（最大角度可配）
 *   · 辉光是一张跟随指针的 radial-gradient（--comet-x / --comet-y）
 *   · 指针离开回正；prefers-reduced-motion 下完全静止
 *
 * 与参考实现的差异：未使用 framer-motion（本仓库未安装该依赖），
 * 改用 rAF + 阻尼插值实现同样的手感；因此组件本身零依赖、可用在任意页面。
 *
 * 典型用法（参考组件 demo 的结构）：
 *   <CometCard className="bg-[#1F2121] p-2 md:p-4">
 *     <div className="relative aspect-[3/4] w-full">
 *       <img className="absolute inset-0 h-full w-full rounded-2xl object-cover contrast-75" />
 *     </div>
 *     <div className="mt-2 flex items-center justify-between p-4 font-mono text-white">…</div>
 *   </CometCard>
 */
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface CometCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 3D 倾斜最大角度（度） */
  maxTilt?: number;
  /** 指针辉光不透明度上限（0..1） */
  glow?: number;
  /** 是否响应指针。背景装饰层通常传 false——画面在文字后晃动会干扰阅读 */
  interactive?: boolean;
  /** 透视距离（px），越大越平缓 */
  perspective?: number;
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
/** 每帧向目标靠近的比例（0..1），越小越黏滞 */
const DAMPING = 0.14;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export const CometCard = React.forwardRef<HTMLDivElement, CometCardProps>(function CometCard(
  { className, children, maxTilt = 8, glow = 0.35, interactive = true, perspective = 1200, style, ...props },
  forwardedRef,
) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const innerRef = React.useRef<HTMLDivElement | null>(null);
  const rafRef = React.useRef(0);
  const enabledRef = React.useRef(false);

  const target = React.useRef({ rx: 0, ry: 0, x: 50, y: 50, g: 0 });
  const current = React.useRef({ rx: 0, ry: 0, x: 50, y: 50, g: 0 });

  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  React.useEffect(() => {
    enabledRef.current = interactive && !prefersReducedMotion();
    if (!enabledRef.current && rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, [interactive]);

  /** 把当前插值状态写进 CSS 变量与 transform（rAF 内调用） */
  const paint = React.useCallback(() => {
    const inner = innerRef.current;
    const root = rootRef.current;
    if (!inner || !root) return;
    const c = current.current;
    inner.style.transform = `rotateX(${c.rx.toFixed(3)}deg) rotateY(${c.ry.toFixed(3)}deg)`;
    root.style.setProperty('--comet-x', `${c.x.toFixed(2)}%`);
    root.style.setProperty('--comet-y', `${c.y.toFixed(2)}%`);
    root.style.setProperty('--comet-glow', (c.g * glow).toFixed(3));
  }, [glow]);

  const step = React.useCallback(() => {
    rafRef.current = 0;
    const t = target.current;
    const c = current.current;
    let moving = false;
    for (const key of ['rx', 'ry', 'x', 'y', 'g'] as const) {
      const delta = t[key] - c[key];
      if (Math.abs(delta) > 0.01) {
        c[key] += delta * DAMPING;
        moving = true;
      } else {
        c[key] = t[key];
      }
    }
    paint();
    if (moving) rafRef.current = requestAnimationFrame(step);
  }, [paint]);

  const schedule = React.useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(step);
  }, [step]);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!enabledRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    target.current.ry = (px - 0.5) * 2 * maxTilt;
    target.current.rx = (0.5 - py) * 2 * maxTilt;
    target.current.x = px * 100;
    target.current.y = py * 100;
    target.current.g = 1;
    schedule();
  };

  /** 指针离开：回正并让辉光淡出 */
  const handlePointerLeave = () => {
    if (!enabledRef.current) return;
    target.current.rx = 0;
    target.current.ry = 0;
    target.current.g = 0;
    schedule();
  };

  React.useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  return (
    <div
      ref={setRefs}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={{ perspective: `${perspective}px`, ...style }}
      className={cn('relative isolate overflow-hidden', className)}
      {...props}
    >
      {/* 指针辉光层：跟随 --comet-x/--comet-y，默认完全透明 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(42% 42% at var(--comet-x,50%) var(--comet-y,50%), rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.08) 45%, rgba(255,255,255,0) 72%)',
          opacity: 'var(--comet-glow, 0)',
        }}
      />
      {/* 内容层：preserve-3d 让子元素的 translateZ 生效 */}
      <div ref={innerRef} className="relative z-10 h-full" style={{ transformStyle: 'preserve-3d' }}>
        {children}
      </div>
    </div>
  );
});

export default CometCard;
