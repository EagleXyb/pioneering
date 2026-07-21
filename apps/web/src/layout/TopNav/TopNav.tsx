import { useLocation } from 'react-router';
import { useAppStore } from '../../store/appStore';
import { Tooltip } from 'tdesign-react';
import { PanelRight } from 'lucide-react';
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
    <nav className={`top-nav${isProRoute ? ' top-nav--pro' : ''}`} style={navStyle}>
      <button className="btn-sidebar-toggle" onClick={toggleSidebar}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 5h14M3 10h14M3 15h14"/>
        </svg>
      </button>

      {!sidebarOpen && (
        <Tooltip content="展开侧边栏" placement="bottom" showArrow>
          <button className="btn-sidebar-expand" onClick={toggleSidebar} aria-label="展开侧边栏">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2"/>
              <path d="M9 3v18"/>
              <path d="m14 9 3 3-3 3"/>
            </svg>
          </button>
        </Tooltip>
      )}

      <div className="nav-spacer" />

      {/* 分析模式下在顶栏提供推理面板的折叠/展开入口（与任务模式 TaskTopBar 一致），
       * 折叠后仍可在此重新展开 */}
      {isProRoute && (
        <Tooltip content={pipelineOpen ? '收起推理面板' : '展开推理面板'} placement="bottom" showArrow>
          <button
            type="button"
            className="top-nav-collapse-btn"
            onClick={togglePipeline}
            aria-label={pipelineOpen ? '收起推理面板' : '展开推理面板'}
            aria-expanded={pipelineOpen}
            title={pipelineOpen ? '收起推理面板' : '展开推理面板'}
          >
            <PanelRight width={18} height={18} />
          </button>
        </Tooltip>
      )}
    </nav>
  );
}
