// Prompt 管理模块

import React from 'react';
import { PromptModule, PromptModuleInfo, SaveStatus } from './types';
import './PromptManagement.css';

interface PromptManagementProps {
  prompts: Record<PromptModule, string>;
  activeModule: PromptModule;
  saveStatus: SaveStatus;
  isFullscreen: boolean;
  onPromptChange: (module: PromptModule, value: string) => void;
  onSavePrompt: (module: PromptModule) => void;
  onToggleFullscreen: () => void;
  onReset: (module: PromptModule) => void;
}

export const PromptManagement: React.FC<PromptManagementProps> = ({
  prompts,
  activeModule,
  saveStatus,
  isFullscreen,
  onPromptChange,
  onSavePrompt,
  onToggleFullscreen,
  onReset,
}) => {
  // 根据 activeModule 渲染对应的内容
  if (activeModule === 'global-settings') {
    return (
      <div className="prompt-management">
        <GlobalSettings
          prompts={prompts}
          onPromptChange={onPromptChange}
          onReset={() => onReset('global-settings')}
          isFullscreen={isFullscreen}
          onToggleFullscreen={onToggleFullscreen}
        />
      </div>
    );
  }

  return (
    <div className="prompt-management">
      <PromptModuleEditor
        module={activeModule}
        prompts={prompts}
        saveStatus={saveStatus}
        isFullscreen={isFullscreen}
        onPromptChange={onPromptChange}
        onSavePrompt={onSavePrompt}
        onToggleFullscreen={onToggleFullscreen}
        onReset={() => onReset(activeModule)}
      />
    </div>
  );
};

// 全局设置
interface GlobalSettingsProps {
  prompts: Record<PromptModule, string>;
  onPromptChange: (module: PromptModule, value: string) => void;
  onReset: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

const GlobalSettings: React.FC<GlobalSettingsProps> = ({ prompts, onPromptChange, onReset, isFullscreen, onToggleFullscreen }) => {
  const [leftWidth, setLeftWidth] = React.useState(65); // 百分比
  const [isDragging, setIsDragging] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const minLeftWidth = 40; // 左侧最小宽度百分比
  const minRightWidth = 25; // 右侧最小宽度百分比

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const newLeftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
      const newRightWidth = 100 - newLeftWidth;

      // 检查是否超过最小宽度限制
      if (newLeftWidth >= minLeftWidth && newRightWidth >= minRightWidth) {
        setLeftWidth(newLeftWidth);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // 复制内容到剪贴板
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompts['global-settings']);
      alert('复制成功');
    } catch {
      alert('复制失败');
    }
  };

  // 清空内容
  const handleClear = () => {
    if (confirm('确定要清空内容吗？')) {
      onPromptChange('global-settings', '');
    }
  };

  return (
    <div className={`global-settings content-panel ${isFullscreen ? 'fullscreen-mode' : ''}`}>
      <div className="panel-header">
        <div className="header-left">
          <h2 className="panel-title">全局设置</h2>
          <p className="panel-description">配置全局提示词和系统参数</p>
        </div>
        <div className="header-actions">
          <button className="btn-action">按钮 1</button>
          <button className="btn-primary">提交发布</button>
        </div>
      </div>
      <div className="settings-layout" ref={containerRef}>
        <div className="settings-left" style={{ width: `${leftWidth}%` }}>
          <div className="form-card">
            <div className="form-group">
              <div className="prompt-editor-header">
                <label className="form-label">
                  Prompt 模板
                  <span className="label-required">*</span>
                </label>
                <div className="prompt-editor-toolbar">
                  <button className="toolbar-btn" data-title={isFullscreen ? '退出全屏' : '全屏'} onClick={onToggleFullscreen}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {isFullscreen ? (
                        <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
                      ) : (
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                      )}
                    </svg>
                  </button>
                  <button className="toolbar-btn" data-title="复制" onClick={handleCopy}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                  <button className="toolbar-btn" data-title="删除" onClick={handleClear}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
              </div>
              <div className="editor-divider" />
              <textarea
                value={prompts['global-settings']}
                onChange={(e) => onPromptChange('global-settings', e.target.value)}
                placeholder="定义 AI 的全局角色和身份..."
                className={`form-textarea ${isFullscreen ? 'fullscreen-textarea' : ''}`}
              />
            </div>
          </div>
        </div>
        <div
          className={`settings-divider ${isDragging ? 'dragging' : ''}`}
          onMouseDown={handleMouseDown}
        >
          <div className="divider-handle" />
        </div>
        <div className="settings-right" style={{ width: `${100 - leftWidth}%` }}>
          <div className="form-card">
            <h3 className="card-title">常用配置</h3>
            <div className="form-group">
              <label className="form-label">配置项 1</label>
              <input type="text" className="form-input" placeholder="请输入" />
            </div>
            <div className="form-group">
              <label className="form-label">配置项 2</label>
              <input type="text" className="form-input" placeholder="请输入" />
            </div>
            <div className="form-group">
              <label className="form-label">配置项 3</label>
              <input type="text" className="form-input" placeholder="请输入" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Prompt 模块编辑器
interface PromptModuleEditorProps {
  module: PromptModule;
  prompts: Record<PromptModule, string>;
  saveStatus: SaveStatus;
  isFullscreen: boolean;
  onPromptChange: (module: PromptModule, value: string) => void;
  onSavePrompt: (module: PromptModule) => void;
  onToggleFullscreen: () => void;
  onReset: () => void;
}

const PromptModuleEditor: React.FC<PromptModuleEditorProps> = ({
  module,
  prompts,
  saveStatus,
  isFullscreen,
  onPromptChange,
  onSavePrompt,
  onToggleFullscreen,
  onReset,
}) => {
  const moduleInfo: Record<PromptModule, PromptModuleInfo> = {
    perception: {
      title: '问题感知模块',
      description: '定义 AI 如何感知和理解用户提出的问题',
      placeholder: '例如：你是一位专业的问题分析专家，负责深入理解用户提出的每一个问题...',
    },
    retrieval: {
      title: '知识检索模块',
      description: '定义 AI 如何从知识库中检索相关信息',
      placeholder: '例如：你是一位知识检索专家，擅长从海量信息中找到最相关的知识...',
    },
    generation: {
      title: '创意生成模块',
      description: '定义 AI 如何生成创新性的想法和方案',
      placeholder: '例如：你是一位创新思维专家，擅长打破常规思维，产生独特的创意...',
    },
    evaluation: {
      title: '评估反馈模块',
      description: '定义 AI 如何评估创意并提供反馈',
      placeholder: '例如：你是一位专业的创新评估专家，负责评估创业项目的创新能力和潜力...',
    },
    'global-settings': {
      title: '全局设置',
      description: '全局提示词设置',
      placeholder: '',
    },
  };

  const info = moduleInfo[module];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompts[module]);
      alert('已复制到剪贴板');
    } catch {
      alert('复制失败');
    }
  };

  const handleClear = () => {
    if (confirm('确定要清空提示词内容吗？')) {
      onPromptChange(module, '');
    }
  };

  const handleSave = () => {
    onSavePrompt(module);
  };

  return (
    <div className={`prompt-module-editor content-panel ${isFullscreen ? 'fullscreen-mode' : ''}`}>
      <div className="panel-header">
        <div className="header-left">
          <h2 className="panel-title">{info.title}</h2>
          <p className="panel-description">{info.description}</p>
        </div>
        <div className="header-actions">
          <button className="btn-action" onClick={handleSave} disabled={saveStatus === 'saving'}>
            {saveStatus === 'saving' ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
      <div className="form-card">
        <div className="form-group">
          <div className="prompt-editor-header">
            <label className="form-label">
              Prompt 模板
              <span className="label-required">*</span>
            </label>
            <div className="prompt-editor-toolbar">
              <button className="toolbar-btn" data-title={isFullscreen ? '退出全屏' : '全屏'} onClick={onToggleFullscreen}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {isFullscreen ? (
                    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
                  ) : (
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                  )}
                </svg>
              </button>
              <button className="toolbar-btn" data-title="复制" onClick={handleCopy}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              </button>
              <button className="toolbar-btn" data-title="删除" onClick={handleClear}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
            </div>
          </div>
          <div className="editor-divider" />
          <textarea
            value={prompts[module]}
            onChange={(e) => onPromptChange(module, e.target.value)}
            placeholder={info.placeholder}
            className={`form-textarea ${isFullscreen ? 'fullscreen-textarea' : ''}`}
          />
        </div>
      </div>
    </div>
  );
};

export default PromptManagement;
