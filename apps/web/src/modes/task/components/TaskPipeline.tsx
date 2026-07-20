import React, { useState } from 'react';

export function TaskPipeline() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`task-pipeline${collapsed ? ' task-pipeline--collapsed' : ''}`}>
      <div
        className="task-pipeline-header"
        onClick={() => setCollapsed((v) => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCollapsed((v) => !v);
          }
        }}
      >
        <div className="task-pipeline-header-left">
          <h3 className="task-pipeline-title">任务流水线</h3>
          <span className="task-pipeline-badge">开发中</span>
        </div>
        <svg
          className="task-pipeline-toggle"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </div>
      <div className="task-pipeline-body">
        <div className="task-pipeline-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          <div className="task-pipeline-empty-text">Plan-and-Execute 模式</div>
          <div className="task-pipeline-empty-desc">
            Agent 将自动规划任务步骤，逐项执行并汇报结果
          </div>
        </div>
      </div>
    </div>
  );
}