// Prompt 列表页面

import React from 'react';
import { useGlobalPrompt } from './useGlobalPrompt';
import type { GlobalPrompt, PromptListProps } from './types';
import '../PromptManagement.css';

export const PromptList: React.FC<PromptListProps> = ({
  onEdit,
  onView,
  onOnline,
  onOffline,
  onDelete,
  onCreate,
}) => {
  const {
    prompts,
    loading,
    error,
    handleOnline: apiHandleOnline,
    handleOffline: apiHandleOffline,
    handleDelete: apiHandleDelete,
  } = useGlobalPrompt();

  // 处理上线操作
  const handleOnline = async (id: number) => {
    if (window.confirm('确定要将此Prompt上线吗？')) {
      await apiHandleOnline(id);
    }
  };

  // 处理下线操作
  const handleOffline = async (id: number) => {
    if (window.confirm('确定要将此Prompt下线吗？')) {
      await apiHandleOffline(id);
    }
  };

  // 处理删除操作
  const handleDelete = async (id: number) => {
    if (window.confirm('确定要删除此Prompt吗？')) {
      await apiHandleDelete(id);
    }
  };

  // 渲染状态徽章
  const renderStatusBadge = (status: string) => {
    if (status === 'online') {
      return <span className="status-badge online">在线</span>;
    } else if (status === 'offline') {
      return <span className="status-badge offline">离线</span>;
    }
    return <span className="status-badge">{status}</span>;
  };

  // 渲染审批状态徽章
  const renderApprovalBadge = (status: string) => {
    if (status === 'approved') {
      return <span className="approval-badge approved">已审批</span>;
    } else if (status === 'pending') {
      return <span className="approval-badge pending">待审批</span>;
    } else if (status === 'rejected') {
      return <span className="approval-badge rejected">已驳回</span>;
    }
    return <span className="approval-badge">{status}</span>;
  };

  if (loading) {
    return (
      <div className="prompt-list loading">
        <div className="loading-spinner">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="prompt-list error">
        <div className="error-message">{error}</div>
        <button className="btn-primary" onClick={() => window.location.reload()}>重试</button>
      </div>
    );
  }

  return (
    <div className="prompt-list">
      <div className="form-card">
        {prompts.length === 0 ? (
          <div className="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            <h3>暂无Prompt</h3>
            <p>点击上方按钮创建第一个Prompt</p>
          </div>
        ) : (
          <div className="prompt-table">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>版本</th>
                  <th>状态</th>
                  <th>审批状态</th>
                  <th>创建者</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {prompts.map((prompt) => (
                  <tr key={prompt.id}>
                    <td className="prompt-name">{prompt.name}</td>
                    <td className="prompt-version">v{prompt.version}</td>
                    <td>{renderStatusBadge(prompt.status)}</td>
                    <td>{renderApprovalBadge(prompt.approvalStatus)}</td>
                    <td className="prompt-creator">{prompt.createdBy}</td>
                    <td className="prompt-time">
                      {new Date(prompt.updatedAt).toLocaleString()}
                    </td>
                    <td className="prompt-actions">
                      <button 
                        className="action-btn view" 
                        onClick={() => onView(prompt)}
                        title="查看"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      </button>
                      <button 
                        className="action-btn edit" 
                        onClick={() => onEdit(prompt)}
                        title="编辑"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      {prompt.status === 'offline' ? (
                        <button 
                          className="action-btn online" 
                          onClick={() => handleOnline(prompt.id)}
                          title="上线"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                          </svg>
                        </button>
                      ) : (
                        <button 
                          className="action-btn offline" 
                          onClick={() => handleOffline(prompt.id)}
                          title="下线"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      )}
                      <button 
                        className="action-btn delete" 
                        onClick={() => handleDelete(prompt.id)}
                        title="删除"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

