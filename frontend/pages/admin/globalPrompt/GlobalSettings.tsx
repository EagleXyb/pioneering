// 全局设置组件

import React, { useState, useRef } from 'react';
import { PromptModule } from '../types';
import '../PromptManagement.css';
import { PromptList } from './PromptList';
import { CreatePromptModal } from './CreatePromptModal';
import type { CreatePromptFormData } from './types';

interface GlobalSettingsProps {
  prompts: Record<PromptModule, string>;
  onPromptChange: (module: PromptModule, value: string) => void;
  onReset: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export const GlobalSettings: React.FC<GlobalSettingsProps> = ({
  prompts,
  onPromptChange,
  onReset,
  isFullscreen,
  onToggleFullscreen,
}) => {
  const [leftWidth, setLeftWidth] = useState(65); // 百分比
  const [isDragging, setIsDragging] = useState(false);
  const [showList, setShowList] = useState(true); // 控制显示列表还是编辑器，默认显示列表
  const containerRef = useRef<HTMLDivElement>(null);

  // 模态框相关状态
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [currentPromptInfo, setCurrentPromptInfo] = useState<CreatePromptFormData | null>(null);

  const minLeftWidth = 40; // 左侧最小宽度百分比
  const minRightWidth = 25; // 右侧最小宽度百分比

  // 处理鼠标按下事件，开始拖动
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // 处理鼠标移动事件，调整宽度
  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const mouseX = e.clientX - containerRect.left;
    const newWidth = (mouseX / containerWidth) * 100;

    // 确保宽度在有效范围内
    if (newWidth >= minLeftWidth && newWidth <= 100 - minRightWidth) {
      setLeftWidth(newWidth);
    }
  };

  // 处理鼠标释放事件，结束拖动
  const handleMouseUp = () => {
    setIsDragging(false);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  // 处理复制
  const handleCopy = () => {
    const content = prompts['global-settings'];
    navigator.clipboard.writeText(content).then(() => {
      alert('复制成功！');
    });
  };

  // 处理清空
  const handleClear = () => {
    if (window.confirm('确定要清空内容吗？')) {
      onPromptChange('global-settings', '');
    }
  };

  // 处理编辑Prompt
  const handleEdit = (prompt: any) => {
    console.log('编辑Prompt:', prompt);
    // 切换到编辑器模式并填充内容
    if (prompt.templateContent) {
      onPromptChange('global-settings', prompt.templateContent);
    }
    setShowList(false);
  };

  // 处理查看Prompt
  const handleView = (prompt: any) => {
    console.log('查看Prompt:', prompt);
    // 这里可以实现查看逻辑
  };

  // 处理上线Prompt
  const handleOnline = (id: number) => {
    console.log('上线Prompt:', id);
    // 这里可以实现上线逻辑
  };

  // 处理下线Prompt
  const handleOffline = (id: number) => {
    console.log('下线Prompt:', id);
    // 这里可以实现下线逻辑
  };

  // 处理删除Prompt
  const handleDelete = (id: number) => {
    console.log('删除Prompt:', id);
    // 这里可以实现删除逻辑
  };

  // 处理创建新Prompt - 显示模态框
  const handleCreate = () => {
    setShowCreateModal(true);
  };

  // 处理模态框确认
  const handleConfirmCreate = (data: CreatePromptFormData) => {
    console.log('创建Prompt:', data);
    // 保存Prompt信息
    setCurrentPromptInfo(data);
    // 关闭模态框
    setShowCreateModal(false);
    // 切换到编辑器模式
    setShowList(false);
    // 清空编辑器内容，准备输入新的Prompt模板
    onPromptChange('global-settings', '');
  };

  // 处理模态框取消
  const handleCancelCreate = () => {
    setShowCreateModal(false);
  };

  return (
    <div className={`global-settings content-panel ${isFullscreen ? 'fullscreen-mode' : ''}`}>
      {showList ? (
        // 显示Prompt列表
        <div className="prompt-list-container">
          <div className="panel-header">
            <div className="header-left">
              <h2 className="panel-title">全局Prompt列表</h2>
            </div>
            <div className="header-actions">
              <button className="btn-primary" onClick={handleCreate}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px' }}>
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                新建Prompt
              </button>
            </div>
          </div>
          <PromptList
            onEdit={handleEdit}
            onView={handleView}
            onOnline={handleOnline}
            onOffline={handleOffline}
            onDelete={handleDelete}
            onCreate={handleCreate}
          />
        </div>
      ) : (
        // 显示编辑器
        <>
          <div className="panel-header">
            <div className="header-left">
              <button className="back-button" onClick={() => setShowList(true)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="header-content">
                <h2 className="panel-title">
                  {currentPromptInfo ? currentPromptInfo.name : '全局设置'}
                </h2>
                {currentPromptInfo && (
                  <div className="header-meta">
                    <div className="prompt-status">
                      <span className={`status-badge ${prompts['global-settings'] && prompts['global-settings'].trim() ? 'committed' : 'uncommitted'}`}>
                        {prompts['global-settings'] && prompts['global-settings'].trim() ? '已提交' : '未提交'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="header-actions">
              <button className="btn-primary" onClick={handleCreate}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px' }}>
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                提交发布
              </button>
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
                      <button className="toolbar-btn" data-title="删除" onClick={handleClear}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
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
        </>
      )}

      {/* 创建Prompt模态框 */}
      <CreatePromptModal
        visible={showCreateModal}
        onClose={handleCancelCreate}
        onConfirm={handleConfirmCreate}
      />
    </div>
  );
};
