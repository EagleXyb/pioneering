import React from 'react';
import { ChevronDown, ChevronRight, ChevronLeft, Check, Loader2, Search, AlertCircle, Circle, XCircle, Zap, Minus, Copy, Download, Expand } from 'lucide-react';

export type AgentStepStatus = 'pending' | 'running' | 'completed' | 'error';

export interface AgentStep {
  id: string;
  title: string;
  status: AgentStepStatus;
  progress?: { current: number; total: number };
  content?: string;
  subItems?: Array<{
    id: string;
    type: 'search' | 'analysis' | 'result';
    title?: string;
    query?: string;
    content?: string;
    sourceCount?: number;
    sourceLabel?: string;
  }>;
}

interface AgentProcessPanelProps {
  steps: AgentStep[];
  isRunning: boolean;
  isPanelCollapsed: boolean;
  onTogglePanel: () => void;
  onTerminate?: () => void;
  onToggleStep?: (stepId: string) => void;
  onExpand?: () => void;
  collapsedSteps?: Set<string>;
}

const AgentProcessPanel: React.FC<AgentProcessPanelProps> = ({
  steps,
  isRunning,
  isPanelCollapsed,
  onTogglePanel,
  onTerminate,
  onToggleStep,
  onExpand,
  collapsedSteps = new Set(),
}) => {

  const getStepIcon = (status: AgentStepStatus) => {
    switch (status) {
      case 'completed':
        return <Check size={14} className="agent-step-icon agent-step-icon-completed" />;
      case 'running':
        return <Loader2 size={14} className="agent-step-icon agent-step-icon-running" />;
      case 'error':
        return <XCircle size={14} className="agent-step-icon agent-step-icon-error" />;
      default:
        return <Circle size={14} className="agent-step-icon agent-step-icon-pending" />;
    }
  };

  const getStatusText = (step: AgentStep) => {
    if (step.status === 'running') return '执行中...';
    if (step.status === 'error') return '出错';
    return '';
  };

  const handleCopy = () => {
    const text = steps.map((step, i) => {
      let line = `${i + 1}. ${step.title} [${step.status}]`;
      if (step.content) line += `\n   ${step.content}`;
      step.subItems?.forEach(sub => {
        if (sub.query) line += `\n   搜索: ${sub.query}`;
        if (sub.content) line += `\n   ${sub.content}`;
      });
      return line;
    }).join('\n');
    navigator.clipboard.writeText(text);
  };

  const handleDownload = () => {
    const text = steps.map((step, i) => {
      let line = `${i + 1}. ${step.title} [${step.status}]`;
      if (step.content) line += `\n   ${step.content}`;
      step.subItems?.forEach(sub => {
        if (sub.query) line += `\n   搜索: ${sub.query}`;
        if (sub.content) line += `\n   ${sub.content}`;
      });
      return line;
    }).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-process-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const completedCount = steps.filter(s => s.status === 'completed').length;
  const totalCount = steps.length;

  return (
    <div className={`agent-process-panel ${isPanelCollapsed ? 'panel-collapsed' : ''}`}>
      <div className="agent-panel-header">
        <div className="agent-panel-header-left">
          {!isPanelCollapsed && (
            <>
              <Zap size={16} className="agent-panel-title-icon" />
              <span className="agent-panel-title">研究过程</span>
            </>
          )}
        </div>
        <div className="agent-panel-header-right">
          {!isPanelCollapsed && (
            <>
              <button className="agent-panel-action-btn" onClick={handleCopy} data-tooltip="复制">
                <Copy size={14} />
              </button>
              <button className="agent-panel-action-btn" onClick={handleDownload} data-tooltip="下载">
                <Download size={14} />
              </button>
              <button className="agent-panel-action-btn" onClick={onExpand} data-tooltip="最大化">
                <Expand size={14} />
              </button>
            </>
          )}
          <button
            className="agent-panel-toggle-btn"
            onClick={onTogglePanel}
            data-tooltip={isPanelCollapsed ? '展开面板' : '收起面板'}
          >
            {isPanelCollapsed ? <ChevronLeft size={16} /> : <Minus size={16} />}
          </button>
        </div>
      </div>

      {!isPanelCollapsed && (
        <div className="agent-panel-body">
          <div className="agent-steps-list">
            {steps.map((step, index) => {
              const isExpanded = !collapsedSteps.has(step.id);
              return (
                <div key={step.id} className={`agent-step ${`agent-step-${step.status}`}`}>
                  <div
                    className="agent-step-header"
                    onClick={() => onToggleStep?.(step.id)}
                  >
                    <div className="agent-step-left">
                      {getStepIcon(step.status)}
                      <span className="agent-step-index">{index + 1}. </span>
                      <span className="agent-step-title">{step.title}</span>
                      {getStatusText(step) && (
                        <span className="agent-step-status-text">{getStatusText(step)}</span>
                      )}
                    </div>
                    <div className="agent-step-right">
                      {step.progress && (
                        <span className="agent-step-progress">
                          ({step.progress.current}/{step.progress.total})
                        </span>
                      )}
                      {(step.content || (step.subItems && step.subItems.length > 0)) && (
                        <button className="agent-step-expand-btn">
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="agent-step-content">
                      {step.content && (
                        <div className="agent-step-text">{step.content}</div>
                      )}

                      {step.subItems?.map(sub => (
                        <div key={sub.id} className={`agent-sub-item agent-sub-${sub.type}`}>
                          {sub.type === 'search' && (
                            <div className="agent-search-result">
                              <div className="agent-search-header">
                                <Search size={13} className="agent-search-icon" />
                                <span className="agent-search-query">{sub.query}</span>
                                {sub.sourceCount !== undefined && (
                                  <span className="agent-source-count">
                                    <Zap size={11} />
                                    找到{sub.sourceCount}篇{sub.sourceLabel || '资料'}来源
                                  </span>
                                )}
                                <ChevronDown size={12} className="agent-sub-chevron" />
                              </div>
                              {sub.content && (
                                <div className="agent-search-body">{sub.content}</div>
                              )}
                            </div>
                          )}
                          {sub.type === 'analysis' && (
                            <div className="agent-analysis-block">
                              <div className="agent-analysis-text">{sub.content}</div>
                              {sub.sourceCount !== undefined && (
                                <div className="agent-source-tag">
                                  <AlertCircle size={11} />
                                  找到{sub.sourceCount}篇资料来源
                                  <ChevronDown size={12} className="agent-sub-chevron" />
                                </div>
                              )}
                            </div>
                          )}
                          {sub.type === 'result' && sub.title && (
                            <div className="agent-result-card">
                              <div className="agent-result-title-row">
                                <Circle size={10} className="agent-result-dot" />
                                <span className="agent-result-title">{sub.title}</span>
                                {step.progress && (
                                  <span className="agent-result-progress">({step.progress.current}/{step.progress.total})</span>
                                )}
                                <ChevronDown size={12} className="agent-sub-chevron" />
                              </div>
                              {sub.content && (
                                <div className="agent-result-content">{sub.content}</div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {isRunning && (
            <div className="agent-panel-footer">
              <button className="agent-terminate-btn" onClick={onTerminate}>
                <Circle size={12} className="agent-terminate-icon" />
                终止任务
              </button>
            </div>
          )}

          {!isRunning && completedCount > 0 && completedCount === totalCount && (
            <div className="agent-panel-footer">
              <div className="agent-complete-badge">
                <Check size={14} />
                全部完成 ({completedCount}/{totalCount})
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AgentProcessPanel;
