// 全局设置组件

import React, { useState, useRef } from 'react';
import type { PromptModule } from '../types';
import '../PromptManagement.css';
import { PromptList } from './PromptList';
import { CreatePromptModal } from './CreatePromptModal';
import { useGlobalPrompt } from './useGlobalPrompt';
import type { GlobalPrompt, CreatePromptFormData } from './types';

interface GlobalSettingsProps {
  prompts: Record<PromptModule, string>;
  onPromptChange: (module: PromptModule, value: string) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export const GlobalSettings: React.FC<GlobalSettingsProps> = ({
  prompts,
  onPromptChange,
  isFullscreen,
  onToggleFullscreen,
}) => {
  const [rightWidth, setRightWidth] = useState(380);
  const [isDragging, setIsDragging] = useState(false);
  const [showList, setShowList] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditNameModal, setShowEditNameModal] = useState(false);
  const [newName, setNewName] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    prompts: globalPrompts,
    loading,
    error,
    fetchPrompts,
    handleOnline,
    handleOffline,
    handleDelete,
    handleCreate,
    handleUpdate,
    enterEditMode,
    exitEditMode,
    currentEditingPrompt,
    isEditing,
  } = useGlobalPrompt();

  const minLeftWidthPx = 400;
  const minRightWidthPx = 350;

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const mouseX = e.clientX - containerRect.left;
    const newRightWidth = containerWidth - mouseX;

    if (newRightWidth >= minRightWidthPx && newRightWidth <= containerWidth - minLeftWidthPx) {
      setRightWidth(newRightWidth);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  const handleCopy = () => {
    const content = prompts['global-settings'];
    navigator.clipboard.writeText(content).then(() => {
      alert('复制成功！');
    });
  };

  const handleClear = () => {
    if (window.confirm('确定要清空内容吗？')) {
      onPromptChange('global-settings', '');
    }
  };

  const handleEdit = (prompt: GlobalPrompt) => {
    enterEditMode(prompt);
    onPromptChange('global-settings', prompt.templateContent);
    setShowList(false);
  };

  const handleView = (prompt: GlobalPrompt) => {
    console.log('查看Prompt:', prompt);
  };

  const handleOnlinePrompt = async (id: number) => {
    if (window.confirm('确定要将此Prompt上线吗？')) {
      const result = await handleOnline(id);
      if (result) {
        alert('上线成功！');
        fetchPrompts();
      }
    }
  };

  const handleOfflinePrompt = async (id: number) => {
    if (window.confirm('确定要将此Prompt下线吗？')) {
      const result = await handleOffline(id);
      if (result) {
        alert('下线成功！');
        fetchPrompts();
      }
    }
  };

  const handleDeletePrompt = async (id: number) => {
    if (window.confirm('确定要删除此Prompt吗？')) {
      await handleDelete(id);
      alert('删除成功！');
      fetchPrompts();
    }
  };

  const handleCreatePromptClick = () => {
    setShowCreateModal(true);
  };

  const handleCreateConfirm = async (data: CreatePromptFormData) => {
    const newPrompt = await handleCreate({
      name: data.name,
      templateContent: '',
      createdBy: 'admin',
    });

    if (newPrompt) {
      setShowCreateModal(false);
      enterEditMode(newPrompt);
      onPromptChange('global-settings', '');
      setShowList(false);
    } else {
      alert('创建失败，请重试');
    }
  };

  const handleBackToList = () => {
    exitEditMode();
    setShowList(true);
    fetchPrompts();
  };

  const handleSavePrompt = async () => {
    if (!currentEditingPrompt) return;

    if (!prompts['global-settings'].trim()) {
      alert('请填写Prompt模板内容');
      return;
    }

    const result = await handleUpdate(currentEditingPrompt.id, {
      templateContent: prompts['global-settings'].trim(),
      createdBy: 'admin',
    });

    if (result) {
      alert('保存成功！');
      fetchPrompts();
    } else {
      alert('保存失败，请重试');
    }
  };

  return (
    <div className={`global-settings content-panel ${isFullscreen ? 'fullscreen-mode' : ''}`}>
      {showList ? (
        <div className="prompt-list-container">
          <div className="panel-header">
            <div className="header-left">
              <h2 className="panel-title">全局Prompt列表</h2>
            </div>
            <div className="header-actions">
              <button className="btn-primary" onClick={handleCreatePromptClick}>
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
            onOnline={handleOnlinePrompt}
            onOffline={handleOfflinePrompt}
            onDelete={handleDeletePrompt}
            onCreate={handleCreatePromptClick}
          />
        </div>
      ) : (
        <>
          {!isFullscreen && (
            <div className="panel-header">
              <div className="header-left">
                <button className="back-button" onClick={handleBackToList}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M19 12H5M12 19l-7-7 7-7" />
                  </svg>
                </button>
                <div className="header-content">
                  <div className="header-item">
                    <span className="prompt-name">{currentEditingPrompt?.name || ''}</span>
                    <button 
                      className="edit-name-btn" 
                      onClick={() => {
                        setNewName(currentEditingPrompt?.name || '');
                        setShowEditNameModal(true);
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                  </div>
                  <div className="header-divider"></div>
                  <div className="header-item">
                    <div className="status-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                    <span className="status-text">{currentEditingPrompt?.approvalStatus === 'approved' ? '已审批' : currentEditingPrompt?.approvalStatus === 'rejected' ? '已驳回' : '已提交'}</span>
                  </div>
                  <div className="header-divider"></div>
                  <div className="header-item">
                    <span className="version-text">v{currentEditingPrompt?.version || '1'}</span>
                  </div>
                </div>
              </div>
              <div className="header-actions">
                <button className="btn-primary" onClick={handleSavePrompt}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px' }}>
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  保存
                </button>
              </div>
            </div>
          )}
          <div className={`settings-layout ${isFullscreen ? 'fullscreen-layout' : ''}`} ref={containerRef}>
            <div className={`settings-left ${isFullscreen ? 'fullscreen-left' : ''}`} style={{ width: isFullscreen ? '100%' : `calc(100% - ${rightWidth}px)` }}>
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
                      <button className="toolbar-btn" data-title="清空" onClick={handleClear}>
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
            {!isFullscreen && (
              <>
                <div
                  className={`settings-divider ${isDragging ? 'dragging' : ''}`}
                  onMouseDown={handleMouseDown}
                >
                  <div className="divider-handle" />
                </div>
                <div className="settings-right" style={{ width: `${rightWidth}px` }}>
                  <div className="form-card">
                    <h3 className="card-title">基础配置</h3>
                    {currentEditingPrompt && (
                      <>
                        <div className="form-group">
                          <label className="form-label">版本</label>
                          <div className="info-value">v{currentEditingPrompt.version}</div>
                        </div>
                        <div className="form-group">
                          <label className="form-label">创建人</label>
                          <div className="info-value">{currentEditingPrompt.createdBy}</div>
                        </div>
                        <div className="form-group">
                          <label className="form-label">创建时间</label>
                          <div className="info-value">{new Date(currentEditingPrompt.createdAt).toLocaleString()}</div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}

      <CreatePromptModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onConfirm={handleCreateConfirm}
      />

      {showEditNameModal && currentEditingPrompt && (
        <div className="modal-overlay" onClick={() => setShowEditNameModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>修改 Prompt</h3>
              <button className="modal-close-btn" onClick={() => setShowEditNameModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">
                  Prompt Key
                  <span className="label-required">*</span>
                </label>
                <div className="input-wrapper">
                  <input
                    type="text"
                    className="form-input"
                    value={currentEditingPrompt.promptKey || ''}
                    disabled
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Prompt 名称</label>
                <div className="input-wrapper">
                  <input
                    type="text"
                    className="form-input"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="请输入 Prompt 名称"
                    maxLength={100}
                    autoFocus
                  />
                  <span className="char-count">{newName.length}/100</span>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Prompt 描述</label>
                <div className="input-wrapper">
                  <textarea
                    className="form-textarea"
                    value={currentEditingPrompt.description || ''}
                    disabled
                    rows={3}
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowEditNameModal(false)}>
                取消
              </button>
              <button
                className="btn-primary"
                onClick={async () => {
                  if (!newName.trim()) {
                    alert('请输入Prompt名称');
                    return;
                  }
                  if (currentEditingPrompt) {
                    const result = await handleUpdate(currentEditingPrompt.id, {
                      name: newName.trim(),
                      createdBy: 'admin',
                    });
                    if (result) {
                      setShowEditNameModal(false);
                      fetchPrompts();
                    } else {
                      alert('修改失败，请重试');
                    }
                  }
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};