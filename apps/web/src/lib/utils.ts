import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn/ui 标配的 className 合并工具：
 * - clsx 处理条件类名
 * - tailwind-merge 解决 Tailwind 类名冲突（后写覆盖先写）
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
