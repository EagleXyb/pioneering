// 共享的Prompt编辑器基础组件

import React from 'react';
import { Button, DialogPlugin, MessagePlugin } from 'tdesign-react';
import { CheckIcon, FullscreenIcon, FullscreenExitIcon, FileCopyIcon, DeleteIcon } from 'tdesign-icons-react';
import type { SaveStatus } from '../types';
import './BasePromptEditor.css';

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
}) => {
  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      MessagePlugin.success('复制成功！');
    });
  };

  const handleClear = () => {
    const dialog = DialogPlugin.confirm({
      header: '确认清空',
      body: '确定要清空内容吗？',
      onConfirm: () => {
        onContentChange('');
        dialog.hide();
      },
    });
  };

  return (
    <div className="prompt-module-editor content-panel">
      <div className="panel-header">
        <div className="header-left">
          <h2 className="panel-title">{title}</h2>
          <p className="panel-description">{description}</p>
        </div>
        <div className="header-actions">
          <Button
            theme="primary"
            loading={saveStatus === 'saving'}
            disabled={saveStatus === 'saving'}
            icon={<CheckIcon />}
            onClick={onSave}
          >
            保存
          </Button>
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
                <Button
                  variant="text"
                  shape="square"
                  icon={isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
                  title={isFullscreen ? '退出全屏' : '全屏'}
                  onClick={onToggleFullscreen}
                />
                <Button
                  variant="text"
                  shape="square"
                  icon={<FileCopyIcon />}
                  title="复制"
                  onClick={handleCopy}
                />
                <Button
                  variant="text"
                  shape="square"
                  icon={<DeleteIcon />}
                  title="清空"
                  onClick={handleClear}
                />
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
