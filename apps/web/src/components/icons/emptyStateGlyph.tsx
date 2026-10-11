/**
 * 空态插图 —— 大尺寸占位图形的统一规范
 *
 * 规范：默认 48px + strokeWidth 1.2（紧凑容器可传更小尺寸）。
 * 说明：lucide 默认 strokeWidth 2 在 48px 下呈现约 4px 的粗线，与正文观感失衡；
 * 取 1.2 换算到 24 画板即 2.4px，与常规 16px 图标（默认 2 → 1.33px）同属一个层次。
 *
 * 图形来源：pro / task 直接复用模式图标（MODE_ICONS），
 * 因此空态与其在侧栏、欢迎页的标识始终是同一个图形。
 * 颜色与透明度由调用方的容器类控制（如 .pro-empty-icon / .task-empty-icon）。
 */
import { Clipboard, TriangleAlert, type LucideIcon } from 'lucide-react';
import { MODE_ICONS } from './modeIcons';

export type EmptyStateVariant = 'chat' | 'pro' | 'task' | 'process' | 'error';

const ILLUSTRATIONS: Record<EmptyStateVariant, LucideIcon> = {
  chat: MODE_ICONS.chat,
  pro: MODE_ICONS.pro,
  task: MODE_ICONS.task,
  process: Clipboard,
  error: TriangleAlert,
};

/** 大尺寸插图统一线宽 */
const STROKE_WIDTH = 1.2;

interface Props {
  variant: EmptyStateVariant;
  /** 默认 48px */
  size?: number;
  className?: string;
}

export function EmptyStateGlyph({ variant, size = 48, className }: Props) {
  const Icon = ILLUSTRATIONS[variant];
  return (
    <Icon
      size={size}
      strokeWidth={STROKE_WIDTH}
      className={className}
      aria-hidden="true"
    />
  );
}
