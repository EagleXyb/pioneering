import { useLocation } from 'react-router-dom';
import { Menu, PanelLeftOpen, PanelRight } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import './topnav.css';

const RESIZER_WIDTH = 5;

export function TopNav() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const pipelineOpen = useAppStore((s) => s.pipelineOpen);
  const pipelineWidth = useAppStore((s) => s.pipelineWidth);
  const togglePipeline = useAppStore((s) => s.togglePipeline);
  const location = useLocation();
  const isProRoute = location.pathname.startsWith('/pro');

  // 分析模式下顶栏仅覆盖左侧中间主栏（不含右侧推理面板），与中间栏内容区域等宽；
  // 其余路由（如 chat）铺满中间区域。面板折叠时同样铺满
  const navStyle =
    isProRoute && pipelineOpen
      ? { width: `calc(100% - ${pipelineWidth + RESIZER_WIDTH}px)` }
      : undefined;

  return (
    <TooltipProvider delayDuration={300}>
      <nav
        className={`top-nav${isProRoute ? ' top-nav--pro' : ''}`}
        style={navStyle}
      >
        <button className="btn-sidebar-toggle" onClick={toggleSidebar} aria-label="切换侧边栏">
          <Menu size={20} strokeWidth={1.5} />
        </button>

        {!sidebarOpen && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="btn-sidebar-expand"
                onClick={toggleSidebar}
                aria-label="展开侧边栏"
              >
                <PanelLeftOpen size={20} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">展开侧边栏</TooltipContent>
          </Tooltip>
        )}

        <div className="nav-spacer" />

        {/* 分析模式下在顶栏提供推理面板的折叠/展开入口（与任务模式 TaskTopBar 一致），
         折叠后仍可在此重新展开 */}
        {isProRoute && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="top-nav-collapse-btn"
                onClick={togglePipeline}
                aria-label={pipelineOpen ? '收起推理面板' : '展开推理面板'}
                aria-expanded={pipelineOpen}
              >
                <PanelRight size={18} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {pipelineOpen ? '收起推理面板' : '展开推理面板'}
            </TooltipContent>
          </Tooltip>
        )}
      </nav>
    </TooltipProvider>
  );
}
