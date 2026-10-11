/**
 * 模式图标（chat / pro / task）—— 全应用唯一来源
 *
 * 使用场景：侧栏模式切换、侧栏会话列表项的模式标记、欢迎页模式卡片、模式空态插图。
 * 同一模式在任何位置都必须是同一个图形，因此这里集中映射，不再各写一份。
 */
import {
  LayoutGrid,
  ListChecks,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react';
import type { AppMode } from '@/types';

export const MODE_ICONS: Record<AppMode, LucideIcon> = {
  chat: MessageSquare,
  pro: LayoutGrid,
  task: ListChecks,
};
