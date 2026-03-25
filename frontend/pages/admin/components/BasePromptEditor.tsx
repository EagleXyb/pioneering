// 共享的Prompt编辑器基础组件

import React from 'react';
import { SaveStatus } from '../types';
import '../PromptManagement.css';

interface BasePromptEditorProps {
  title: string;
  description: string;
  placeholder: string;
  content: string;
  saveStatus: SaveStatus;
  isFullscreen: boolean;
  onContentChange: (value: string) => void;
  onSave: () => void;
  onToggleFullscreen: () => void;
  onReset: () => void;
}

export const BasePromptEditor: React.FC<BasePromptEditorProps> = ({
  title,
  description,
  placeholder,
  content,
  saveStatus,
  isFullscreen,
  onContentChange,
  onSave,
  onToggleFullscreen,
  onReset,
}) => {
  // 处理复制
  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      alert('复制成功！');
    });
  };

  // 处理清空
  const handleClear = () => {
    if (window.confirm('确定要清空内容吗？')) {
      onContentChange('');
    }
  };

  return (
    <div className="prompt-module-editor content-panel">
      <div className="panel-header">
        <div className="header-left">
          <h2 className="panel-title">{title}</h2>
          <p className="panel-description">{description}</p>
        </div>
        <div className="header-actions">
          <button
            className={`btn-primary ${saveStatus === 'saving' ? 'loading' : ''}`}
            onClick={onSave}
            disabled={saveStatus === 'saving'}
          >
            {saveStatus === 'saving' ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
      <div className="editor-layout">
        <div className="form-card">
          <div className="form-group">
            <div className="prompt-editor-header">
              <label className="form-label">
                Prompt 模板
                <span className="label-required">*</span>
              </label>
              <div className="prompt-editor-toolbar">
                <button
                  className="toolbar-btn"
                  data-title={isFullscreen ? '退出全屏' : '全屏'}
                  onClick={onToggleFullscreen}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {isFullscreen ? (
                      <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                    ) : (
                      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                    )}
                  </svg>
                </button>
                <button className="toolbar-btn" data-title="复制" onClick={handleCopy}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
                <button className="toolbar-btn" data-title="清空" onClick={handleClear}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
                <button className="toolbar-btn" data-title="重置" onClick={onReset}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="editor-divider" />
            <textarea
              value={content}
              onChange={(e) => onContentChange(e.target.value)}
              placeholder={placeholder}
              className={`form-textarea ${isFullscreen ? 'fullscreen-textarea' : ''}`}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
