import React from 'react';
import { PanelRight } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import { StepStatusGlyph } from '@/components/icons/customIcons';
import { EmptyStateGlyph } from '@/components/icons/emptyStateGlyph';

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
}

export function ProcessPanel({ stateMap, currentStateKey }: Props) {
  const togglePipeline = useAppStore((s) => s.togglePipeline);
  const steps: StepState[] = Object.entries(stateMap).map(([key, state]) => ({
    id: key,
    type: state.type || 'unknown',
    label: state.label || key,
    content: state.content,
    status: key === currentStateKey ? 'running' : 'done',
  }));

  if (steps.length === 0) {
    return (
      <div className="process-panel">
        <div className="pro-pipeline-header">
          <div className="pro-pipeline-header-left">
            <h3 className="pro-pipeline-title">推理过程</h3>
          </div>
          <button
            type="button"
            className="pro-pipeline-collapse-btn chat-tooltip chat-tooltip--below"
            onClick={togglePipeline}
            aria-label="收起推理面板"
            data-tooltip="收起推理面板"
          >
            <PanelRight size={18} />
          </button>
        </div>
        <div className="process-empty">
          <EmptyStateGlyph variant="process" size={32} />
          <div className="process-empty-text">等待分析开始</div>
          <div className="process-empty-desc">Agent 推理步骤将在这里展示</div>
        </div>
      </div>
    );
  }

  return (
      <div className="process-panel">
        <div className="pro-pipeline-header">
          <div className="pro-pipeline-header-left">
            <h3 className="pro-pipeline-title">推理过程</h3>
          {steps.some((s) => s.status === 'running') && <span className="process-live-dot" />}
        </div>
        <button
          type="button"
            className="pro-pipeline-collapse-btn chat-tooltip chat-tooltip--below"
            onClick={togglePipeline}
          aria-label="收起推理面板"
          data-tooltip="收起推理面板"
        >
          <PanelRight size={18} />
        </button>
      </div>

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
    </div>
  );
}
