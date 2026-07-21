import React from 'react';
import { useAppStore } from '../../../store/appStore';

export function AnalysisLayout({ children }: { children: React.ReactNode }) {
  return <div className="pro-layout">{children}</div>;
}

AnalysisLayout.Main = function AnalysisMain({ children }: { children: React.ReactNode }) {
  return <div className="pro-layout-main">{children}</div>;
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
