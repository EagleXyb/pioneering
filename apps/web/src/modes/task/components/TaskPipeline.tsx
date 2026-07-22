import { PanelRight } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import { usePlanExecuteStore } from '../../../store/planExecuteStore';
import { PlanPipelineTree } from './PlanPipelineTree';

/**
 * 任务流水线右侧面板容器
 *
 * 改造说明（P4 Plan-and-Execute 对接）：
 *   - body 区从静态空态占位替换为 <PlanPipelineTree />，展示实时 plan 步骤
 *   - header badge 从固定"开发中"改为联动 planExecuteStore.phase 的状态徽章
 *   - 容器折叠/拖拽/与 ArtifactPanel 互斥逻辑保持不变
 */

const PHASE_BADGE: Record<string, { text: string; className: string }> = {
  idle: { text: '待机', className: 'task-pipeline-badge--idle' },
  planning: { text: '规划中', className: 'task-pipeline-badge--planning' },
  executing: { text: '执行中', className: 'task-pipeline-badge--executing' },
  done: { text: '已完成', className: 'task-pipeline-badge--done' },
  error: { text: '失败', className: 'task-pipeline-badge--error' },
};

export function TaskPipeline() {
  const pipelineOpen = useAppStore((s) => s.pipelineOpen);
  const togglePipeline = useAppStore((s) => s.togglePipeline);
  const pipelineWidth = useAppStore((s) => s.pipelineWidth);
  const phase = usePlanExecuteStore((s) => s.phase);
  const collapsed = !pipelineOpen;

  const badge = PHASE_BADGE[phase] ?? PHASE_BADGE.idle;

  return (
    <div
      className={`task-pipeline${collapsed ? ' task-pipeline--collapsed' : ''}`}
      style={{ width: collapsed ? 0 : pipelineWidth, minWidth: collapsed ? 0 : pipelineWidth }}
    >
      <div className="task-pipeline-header">
        <div className="task-pipeline-header-left">
          <h3 className="task-pipeline-title">任务流水线</h3>
          <span className={`task-pipeline-badge ${badge.className}`}>{badge.text}</span>
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
        <PlanPipelineTree />
      </div>
    </div>
  );
}
