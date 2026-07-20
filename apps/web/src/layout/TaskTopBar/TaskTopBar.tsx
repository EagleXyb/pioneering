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

export function TaskTopBar() {
  const { sidebarOpen, toggleSidebar } = useAppStore();

  return (
    <nav
      className="tw-scope task-top-bar"
      onClick={toggleSidebar}
      role="button"
      tabIndex={0}
      aria-label={sidebarOpen ? '折叠侧边栏' : '展开侧边栏'}
      aria-expanded={sidebarOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleSidebar();
        }
      }}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="切换侧边栏"
        className="md:hidden"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {!sidebarOpen && (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="展开侧边栏"
                className="hidden md:inline-flex task-top-bar-expand"
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
