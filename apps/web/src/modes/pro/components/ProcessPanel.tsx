import React from 'react';

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
        <div className="process-header">
          <div className="process-title">推理过程</div>
        </div>
        <div className="process-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 5a2 2 0 002 2h2a2 2 0 002-2"/>
          </svg>
          <div className="process-empty-text">等待分析开始</div>
          <div className="process-empty-desc">Agent 推理步骤将在这里展示</div>
        </div>
      </div>
    );
  }

  return (
    <div className="process-panel">
      <div className="process-header">
        <div className="process-title">推理过程</div>
        {steps.some(s => s.status === 'running') && (
          <span className="process-live-dot" />
        )}
      </div>

      <div className="process-steps">
        {steps.map((step) => (
          <div key={step.id} className={`process-step${step.status === 'running' ? ' active' : ''}`}>
            <div className="process-step-indicator">
              <div className="process-step-circle">
                {step.status === 'done' && (
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 7l3 3 5-5"/>
                  </svg>
                )}
                {step.status === 'running' && (
                  <div className="process-step-spinner" />
                )}
              </div>
              {step.id !== steps[steps.length - 1].id && (
                <div className="process-step-line" />
              )}
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