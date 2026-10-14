import React from 'react';
import { PanelRight } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import type { AgentRunData } from '../../../api/agent';
import { StepStatusGlyph } from '@/components/icons/customIcons';
import { EmptyStateGlyph } from '@/components/icons/emptyStateGlyph';
import { PanelTabs } from '@/components/ui/panel-tabs';
import { RunTracePanel } from '@/components/run-trace/RunTracePanel';

interface StepState {
  id: string;
  type: string;
  label: string;
  content: any;
  status: 'running' | 'done' | 'pending';
}

interface Props {
  stateMap: Record<string, any>;
  currentStateKey: string | null;
  /** 当前会话全部 run（「执行轨迹」tab 数据源） */
  runs?: AgentRunData[];
}

/**
 * 右侧面板：头部 tab 在「推理过程」与「执行轨迹」间切换。
 * - 推理过程：stateMap 步骤时间线（流式期间实时更新）
 * - 执行轨迹：run 事件时间轴（RunTracePanel，自动跟随最新 / 锁定消息内入口指定的 run）
 */
export function ProcessPanel({ stateMap, currentStateKey, runs = [] }: Props) {
  const togglePipeline = useAppStore((s) => s.togglePipeline);
  const pipelineTab = useAppStore((s) => s.pipelineTab);
  const setPipelineTab = useAppStore((s) => s.setPipelineTab);

  const steps: StepState[] = Object.entries(stateMap).map(([key, state]) => ({
    id: key,
    type: state.type || 'unknown',
    label: state.label || key,
    content: state.content,
    status: key === currentStateKey ? 'running' : 'done',
  }));

  return (
    <div className="process-panel">
      <div className="pro-pipeline-header">
        <div className="pro-pipeline-header-left">
          <PanelTabs
            ariaLabel="右侧面板视图"
            value={pipelineTab}
            onChange={(key) => setPipelineTab(key as 'process' | 'trace')}
            tabs={[
              { key: 'process', label: '推理过程' },
              { key: 'trace', label: '执行轨迹' },
            ]}
          />
          {pipelineTab === 'process' && steps.some((s) => s.status === 'running') && (
            <span className="process-live-dot" />
          )}
        </div>
        <button
          type="button"
          className="pro-pipeline-collapse-btn chat-tooltip chat-tooltip--below"
          onClick={togglePipeline}
          aria-label="收起推理面板"
          data-tooltip="收起推理面板"
        >
          <PanelRight size={18} strokeWidth={1.75} />
        </button>
      </div>

      {pipelineTab === 'trace' ? (
        <RunTracePanel runs={runs} />
      ) : steps.length === 0 ? (
        <div className="process-empty">
          <EmptyStateGlyph variant="process" size={32} />
          <div className="process-empty-text">等待分析开始</div>
          <div className="process-empty-desc">Agent 推理步骤将在这里展示</div>
        </div>
      ) : (
        <div className="process-steps">
          {steps.map((step) => (
            <div key={step.id} className={`process-step${step.status === 'running' ? ' active' : ''}`}>
              <div className="process-step-indicator">
                <div className="process-step-circle">
                  {step.status === 'done' && (
                    <StepStatusGlyph status="done" size={12} />
                  )}
                  {step.status === 'running' && <div className="process-step-spinner" />}
                </div>
                {step.id !== steps[steps.length - 1].id && <div className="process-step-line" />}
              </div>
              <div className="process-step-body">
                <div className="process-step-label">{step.label}</div>
                {step.content && (
                  <div className="process-step-content">
                    {typeof step.content === 'string' ? step.content : JSON.stringify(step.content).slice(0, 200)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
