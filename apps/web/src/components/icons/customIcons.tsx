/**
 * 自绘图标 —— 项目内所有非 lucide 的规范图形集中在此
 *
 * 收纳标准：lucide 无对应造型（如四瓣花思考标识），或需针对极小渲染尺寸
 * 单独标定线宽（如 8px 的步骤状态图形）。其余一律使用 lucide。
 * 集中放置的目的：图标策略可审计——"哪些图形不是 lucide、为什么"一目了然。
 */
import type { ReactNode } from 'react';

/**
 * 操作栏图标属性（与 lucide 的 size / className 用法对齐）
 * 导出供各模式消息组件声明操作按钮数组的 icon 类型使用。
 */
export interface ActionIconProps {
  size?: number;
  className?: string;
}

/**
 * 分享：弧形转发箭头
 * 使用 round 圆角线帽/连接，与复制、赞、踩（lucide 图标圆角风格）保持统一；
 * stroke=currentColor 自动继承按钮灰色/hover/高亮色
 */
export function ShareForwardIcon({ size = 15, className }: ActionIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12.5 4L22 12L12.5 20V14.9C7.5 14.9 4 16.5 1.5 20C2.5 15 5.5 10 12.5 9L12.5 4Z" />
    </svg>
  );
}

/**
 * 重新生成：近闭合圆环 + 右侧顺时针箭头
 * 使用 round 圆角线帽/连接，与其他 lucide 图标的平滑风格一致；
 * stroke=currentColor 自动继承按钮颜色
 */
export function ReplayRotateIcon({ size = 15, className }: ActionIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21.1679 16C19.6248 19.5318 16.1006 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12L20 10.5" />
    </svg>
  );
}

/**
 * 思考标识：四瓣花造型 + 居中实心圆点，流式时由 CSS 加呼吸动画。
 * lucide 无对应的四瓣花，故自绘；填充用 currentColor，不依赖底色。
 *
 * 几何口径与 lucide 严格一致：墨迹落在 viewBox 的 1/24–23/24 上
 * （= lucide circle r=10 + stroke 2 的外缘），线宽 2 折合到 14px 盒子也是 1.17px。
 * 这样与 lucide 图标（如联网搜索的地球）同盒尺寸时，笔画左缘、右缘、线重完全重合：
 * 图标列能对齐，"图标 ↔ 文字"的间距也是同一个值（盒内 0.58px + gap 6px）。
 * 数值来源：45° 旋转后的椭圆包围半宽 sqrt((rx² + ry²) / 2) + 1 = 11 → rx 5.27 / ry 13.13
 * （rx/ry 与原设计同为 0.401，造型不变，仅整体等比放大）。
 */
export function ThinkingIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <g transform="rotate(45 12 12)">
        <ellipse cx="12" cy="12" rx="5.27" ry="13.13" />
      </g>
      <g transform="rotate(-45 12 12)">
        <ellipse cx="12" cy="12" rx="5.27" ry="13.13" />
      </g>
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export type StepStatus = 'done' | 'failed' | 'skipped';

const STEP_STATUS_PATHS: Record<StepStatus, ReactNode> = {
  done: <path d="M3 7l3 3 5-5" />,
  failed: <path d="M4 4l6 6M10 4l-6 6" />,
  skipped: <path d="M3 7h8" />,
};

/**
 * 步骤状态图形（完成勾 / 失败叉 / 跳过横线）。
 *
 * 刻意不使用 lucide：这类图形渲染尺寸仅 8~12px，而 lucide 是 24 画板，
 * 默认 strokeWidth 2 在 8px 下实际线宽不足 0.7px，会糊成灰线；
 * 这里用 14 画板 + strokeWidth 2，8px 下约 1.1px、12px 下约 1.7px，
 * 与所在圆点/圆环的 2px 边框相称。
 */
export function StepStatusGlyph({
  status,
  size = 8,
}: {
  status: StepStatus;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {STEP_STATUS_PATHS[status]}
    </svg>
  );
}
