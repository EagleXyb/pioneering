import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '@/lib/utils';

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * 注意：故意省略 TooltipPortal。
 * 原因：tailwind.config.ts 设置了 `important: '.tw-scope'`，所有 utility
 * 都包裹在 .tw-scope 祖先选择器下。若使用 Portal 将内容挂到 body，会脱离
 * .tw-scope 子树导致 Tailwind 类全部失效。
 * 改为内联渲染：内容直接挂在 Trigger 旁，受 .tw-scope 作用域覆盖。
 * 前提：Tooltip 父级链路不能有 overflow:hidden 裁切小浮层。
 * 任务模式顶栏场景：顶栏位于 .main-area 顶部，tooltip 向下偏移 4px，
 * 高度约 28px，远小于 .main-area 剩余空间，不会被裁切。
 */
const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      'z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground',
      'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
      'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
