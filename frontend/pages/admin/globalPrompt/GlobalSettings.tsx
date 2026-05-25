// 全局设置组件

import React, { useState, useRef } from 'react';
import { Button, DialogPlugin, MessagePlugin } from 'tdesign-react';
import { AddIcon, ChevronLeftIcon, EditIcon, CheckCircleFilledIcon, FullscreenIcon, FullscreenExitIcon, FileCopyIcon, DeleteIcon } from 'tdesign-icons-react';
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
    fetchPrompts,
    handleOnline,
    handleOffline,
    handleDelete,
    handleCreate,
    handleUpdate,
    enterEditMode,
    exitEditMode,
    currentEditingPrompt,
  } = useGlobalPrompt();

  const minLeftWidthPx = 400;
  const minRightWidthPx = 350;

  const handleMouseDown = (_e: React.MouseEvent) => {
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
      MessagePlugin.success('复制成功！');
    });
  };

  const handleClear = () => {
    const dialog = DialogPlugin.confirm({
      header: '确认清空',
      body: '确定要清空内容吗？',
      onConfirm: () => {
        onPromptChange('global-settings', '');
        dialog.hide();
      },
    });
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
    const dialog = DialogPlugin.confirm({
      header: '确认上线',
      body: '确定要将此Prompt上线吗？',
      onConfirm: async () => {
        const result = await handleOnline(id);
        if (result) {
          MessagePlugin.success('上线成功！');
          fetchPrompts();
        }
        dialog.hide();
      },
    });
  };

  const handleOfflinePrompt = async (id: number) => {
    const dialog = DialogPlugin.confirm({
      header: '确认下线',
      body: '确定要将此Prompt下线吗？',
      onConfirm: async () => {
        const result = await handleOffline(id);
        if (result) {
          MessagePlugin.success('下线成功！');
          fetchPrompts();
        }
        dialog.hide();
      },
    });
  };

  const handleDeletePrompt = async (id: number) => {
    const dialog = DialogPlugin.confirm({
      header: '确认删除',
      body: '确定要删除此Prompt吗？',
      onConfirm: async () => {
        await handleDelete(id);
        MessagePlugin.success('删除成功！');
        fetchPrompts();
        dialog.hide();
      },
    });
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
      MessagePlugin.error('创建失败，请重试');
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
      MessagePlugin.warning('请填写Prompt模板内容');
      return;
    }

    const result = await handleUpdate(currentEditingPrompt.id, {
      templateContent: prompts['global-settings'].trim(),
      createdBy: 'admin',
    });

    if (result) {
      MessagePlugin.success('保存成功！');
      fetchPrompts();
    } else {
      MessagePlugin.error('保存失败，请重试');
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
              <Button theme="primary" icon={<AddIcon />} onClick={handleCreatePromptClick}>
                新建Prompt
              </Button>
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
                <Button variant="text" shape="square" size="large" icon={<ChevronLeftIcon />} onClick={handleBackToList} />
                <div className="header-content">
                  <div className="header-item">
                    <span className="prompt-name">{currentEditingPrompt?.name || ''}</span>
                    <Button 
                      variant="text"
                      shape="square"
                      size="small"
                      icon={<EditIcon />}
                      onClick={() => {
                        setNewName(currentEditingPrompt?.name || '');
                        setShowEditNameModal(true);
                      }}
                    />
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
                <Button theme="primary" icon={<CheckCircleFilledIcon />} onClick={handleSavePrompt}>
                  保存
                </Button>
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