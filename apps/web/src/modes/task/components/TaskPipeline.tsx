import { PanelRight } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';

export function TaskPipeline() {
  const pipelineOpen = useAppStore((s) => s.pipelineOpen);
  const togglePipeline = useAppStore((s) => s.togglePipeline);
  const pipelineWidth = useAppStore((s) => s.pipelineWidth);
  const collapsed = !pipelineOpen;

  return (
    <div
      className={`task-pipeline${collapsed ? ' task-pipeline--collapsed' : ''}`}
      style={{ width: collapsed ? 0 : pipelineWidth, minWidth: collapsed ? 0 : pipelineWidth }}
    >
      <div className="task-pipeline-header">
        <div className="task-pipeline-header-left">
          <h3 className="task-pipeline-title">任务流水线</h3>
          <span className="task-pipeline-badge">开发中</span>
        </div>
        <button
          type="button"
          className="task-pipeline-collapse-btn"
          onClick={togglePipeline}
          aria-label="收起任务流水线"
          aria-expanded={pipelineOpen}
          title="收起任务流水线"
        >
          <PanelRight width={18} height={18} />
        </button>
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
