import React from 'react';
import { PanelRight } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';

export function AnalysisLayout({ children }: { children: React.ReactNode }) {
  return <div className="pro-layout">{children}</div>;
}

AnalysisLayout.Main = function AnalysisMain({ children }: { children: React.ReactNode }) {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const pipelineOpen = useAppStore((s) => s.pipelineOpen);
  const togglePipeline = useAppStore((s) => s.togglePipeline);
  return (
    <div className="pro-layout-main">
      {/* 中间栏自带顶部栏：与右侧面板 .pro-pipeline-header 同级、同高(48px) */}
      <div className="pro-main-header">
        {!sidebarOpen && (
          <button className="pro-main-expand" onClick={toggleSidebar} aria-label="展开侧边栏">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M9 3v18" />
              <path d="m14 9 3 3-3 3" />
            </svg>
          </button>
        )}
        <div className="pro-main-spacer" />
        {/* 面板折叠后提供重新展开入口（展开时由右侧面板头部按钮控制） */}
        {!pipelineOpen && (
          <button
            className="pro-main-panel-toggle"
            onClick={togglePipeline}
            aria-label="展开推理面板"
            title="展开推理面板"
          >
            <PanelRight width={18} height={18} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
};

AnalysisLayout.Panel = function AnalysisPanel({ children }: { children: React.ReactNode }) {
  const pipelineOpen = useAppStore((s) => s.pipelineOpen);
  const pipelineWidth = useAppStore((s) => s.pipelineWidth);
  const collapsed = !pipelineOpen;
  return (
    <div
      className={`pro-pipeline${collapsed ? ' pro-pipeline--collapsed' : ''}`}
      style={{ width: collapsed ? 0 : pipelineWidth, minWidth: collapsed ? 0 : pipelineWidth }}
    >
      {children}
    </div>
  );
};
