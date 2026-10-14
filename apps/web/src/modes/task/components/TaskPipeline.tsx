import { PanelRight } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import { usePlanExecuteStore } from '../../../store/planExecuteStore';
import type { AgentRunData } from '../../../api/agent';
import { PanelTabs } from '@/components/ui/panel-tabs';
import { RunTracePanel } from '@/components/run-trace/RunTracePanel';
import { PlanPipelineTree } from './PlanPipelineTree';

/**
 * 任务流水线右侧面板容器
 *
 * 改造说明：
 *   - P4 Plan-and-Execute 对接：body 区渲染 <PlanPipelineTree /> 实时 plan 步骤，
 *     header badge 联动 planExecuteStore.phase
 *   - 执行轨迹：头部 tab 可切到 <RunTracePanel />（run 事件时间轴，
 *     自动跟随最新 / 锁定消息内入口指定的 run）
 *   - 容器折叠/拖拽/与 ArtifactPanel 互斥逻辑保持不变
 */

const PHASE_BADGE: Record<string, { text: string; className: string }> = {
  idle: { text: '待机', className: 'task-pipeline-badge--idle' },
  planning: { text: '规划中', className: 'task-pipeline-badge--planning' },
  executing: { text: '执行中', className: 'task-pipeline-badge--executing' },
  done: { text: '已完成', className: 'task-pipeline-badge--done' },
  // P0 修复：流结束但仍有未完成步骤——不得显示"已完成"
  incomplete: { text: '未完成', className: 'task-pipeline-badge--incomplete' },
  error: { text: '失败', className: 'task-pipeline-badge--error' },
};

interface Props {
  /** 当前会话全部 run（「执行轨迹」tab 数据源） */
  runs?: AgentRunData[];
}

export function TaskPipeline({ runs = [] }: Props) {
  const pipelineOpen = useAppStore((s) => s.pipelineOpen);
  const togglePipeline = useAppStore((s) => s.togglePipeline);
  const pipelineWidth = useAppStore((s) => s.pipelineWidth);
  const pipelineTab = useAppStore((s) => s.pipelineTab);
  const setPipelineTab = useAppStore((s) => s.setPipelineTab);
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
          <PanelTabs
            ariaLabel="右侧面板视图"
            value={pipelineTab}
            onChange={(key) => setPipelineTab(key as 'process' | 'trace')}
            tabs={[
              { key: 'process', label: '任务流水线' },
              { key: 'trace', label: '执行轨迹' },
            ]}
          />
          {pipelineTab === 'process' && (
            <span className={`task-pipeline-badge ${badge.className}`}>{badge.text}</span>
          )}
        </div>
        <button
          type="button"
          className="task-pipeline-collapse-btn chat-tooltip chat-tooltip--below"
          onClick={togglePipeline}
          aria-label="收起任务流水线"
          aria-expanded={pipelineOpen}
          data-tooltip="收起任务流水线"
        >
          <PanelRight width={18} height={18} strokeWidth={1.75} />
        </button>
      </div>
      {pipelineTab === 'trace' ? (
        <RunTracePanel runs={runs} />
      ) : (
        <div className="task-pipeline-body">
          <PlanPipelineTree />
        </div>
      )}
    </div>
  );
}
