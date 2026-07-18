import { useAppStore } from '../../store/appStore';
import { Tooltip } from 'tdesign-react';
import './topnav.css';

export function TopNav() {
  const { sidebarOpen, toggleSidebar } = useAppStore();

  return (
    <nav className="top-nav">
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
    </nav>
  );
}
