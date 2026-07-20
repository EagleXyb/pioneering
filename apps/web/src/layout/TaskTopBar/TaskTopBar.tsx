import { Menu, PanelLeft } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import './tasktopbar.css';

/**
 * 任务模式专属顶部栏 —— shadcn/ui 实现
 *
 * 与全局 TopNav 的差异：
 * - 使用 shadcn Button（variant=ghost, size=icon-sm）替代原生 button
 * - 使用 shadcn Tooltip（基于 @radix-ui/react-tooltip）替代 TDesign Tooltip
 * - 根节点挂 tw-scope 类，作为 Tailwind 作用域入口
 * - 仅在 /task 路由渲染，chat / pro 路由仍使用全局 TopNav
 */
export function TaskTopBar() {
  const { sidebarOpen, toggleSidebar } = useAppStore();

  return (
    <nav className="tw-scope task-top-bar">
      {/* 移动端汉堡按钮（≤768px 显示） */}
      <Button
        variant="ghost"
        size="icon-sm"
        className="task-top-bar-mobile-toggle"
        onClick={toggleSidebar}
        aria-label="切换侧边栏"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* 桌面端：侧边栏收起时显示展开按钮 */}
      {!sidebarOpen && (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleSidebar}
                aria-label="展开侧边栏"
                className="task-top-bar-expand"
              >
                <PanelLeft className="h-[18px] w-[18px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">展开侧边栏</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      <div className="task-top-bar-spacer" />
    </nav>
  );
}
