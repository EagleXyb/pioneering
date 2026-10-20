/**
 * 侧边栏折叠/展开按钮组 —— 顶栏（TopNav）与插件页头共用
 *
 * 原先这两个按钮只写在 TopNav 里，导致：
 *   - 桌面端（>768px）「新建会话」以外的顶栏完全空白（56px 空条）
 *   - 插件页自带顶栏时无法复用，折叠态下缺少「展开侧边栏」入口
 * 抽成组件后，两处按需渲染，视觉规格保持一致。
 */
import { Menu, PanelRight } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import './navButtons.css';

export function NavButtons() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  return (
    <>
      {/* 窄屏：顶栏左侧的汉堡按钮（覆盖层模式下的侧边栏开关） */}
      <button
        className="btn-sidebar-toggle"
        onClick={toggleSidebar}
        aria-label="切换侧边栏"
      >
        <Menu size={18} strokeWidth={1.75} />
      </button>

      {/* 桌面端：侧边栏折叠后，在顶栏左侧给出展开入口 */}
      {!sidebarOpen && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="btn-sidebar-expand"
              onClick={toggleSidebar}
              aria-label="展开侧边栏"
            >
              <PanelRight size={18} strokeWidth={1.75} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">展开侧边栏</TooltipContent>
        </Tooltip>
      )}
    </>
  );
}
