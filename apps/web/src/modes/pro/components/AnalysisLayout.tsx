import React from 'react';
import type { ChatStatus } from 'tdesign-web-components/lib/chat-engine';

export function ProMainHeader({ status, stateMap }: { status: ChatStatus; stateMap: Record<string, any> }) {
  const stepCount = Object.keys(stateMap).length;
  const runningCount = Object.values(stateMap).filter((s: any) => s.status === 'running').length;

  return (
    <div className="pro-main-header">
      <div className="pro-main-header-left">
        <h2 className="pro-main-title">智能分析</h2>
        {status === 'streaming' && (
          <span className="pro-main-status">分析中...</span>
        )}
        {status === 'complete' && (
          <span className="pro-main-status pro-main-status-done">分析完成</span>
        )}
      </div>
      {stepCount > 0 && (
        <div className="pro-main-progress">
          <div className="pro-main-progress-bar">
            <div
              className="pro-main-progress-fill"
              style={{ width: `${((stepCount - runningCount) / stepCount) * 100}%` }}
            />
          </div>
          <span className="pro-main-progress-text">
            {stepCount - runningCount}/{stepCount} 步骤
          </span>
        </div>
      )}
    </div>
  );
}

export function AnalysisLayout({ children }: { children: React.ReactNode }) {
  return <div className="pro-layout">{children}</div>;
}

AnalysisLayout.Main = function AnalysisMain({ children }: { children: React.ReactNode }) {
  return <div className="pro-layout-main">{children}</div>;
};

AnalysisLayout.Panel = function AnalysisPanel({ children }: { children: React.ReactNode }) {
  return <div className="pro-layout-panel">{children}</div>;
};