// Prompt 列表页面

import React, { useState } from 'react';
import { useGlobalPrompt } from './useGlobalPrompt';
import type { PromptListProps } from './types';
import './PromptList.css';

type SortDirection = 'asc' | 'desc' | null;
type SortField = 'updatedAt' | 'createdAt' | null;

export const PromptList: React.FC<PromptListProps> = ({
  onEdit,
  onView,
}) => {
  const {
    prompts,
    loading,
    error,
    fetchPrompts,
    handleDelete: apiHandleDelete,
  } = useGlobalPrompt();

  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // 处理排序
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // 如果点击的是当前排序字段，切换排序方向
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // 如果点击的是新的排序字段，设置为升序
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // 排序数据
  const sortedPrompts = [...prompts].sort((a, b) => {
    if (!sortField) return 0;
    
    const aValue = a[sortField];
    const bValue = b[sortField];
    
    if (aValue < bValue) {
      return sortDirection === 'asc' ? -1 : 1;
    }
    if (aValue > bValue) {
      return sortDirection === 'asc' ? 1 : -1;
    }
    return 0;
  });

  // 处理删除操作
  const handleDelete = async (id: number) => {
    if (window.confirm('确定要删除此Prompt吗？')) {
      await apiHandleDelete(id);
    }
  };

  // 处理重试
  const handleRetry = () => {
    fetchPrompts();
  };

  // 渲染排序图标
  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    
    if (sortDirection === 'asc') {
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: '4px' }}>
          <polyline points="18 15 12 9 6 15" />
        </svg>
      );
    } else {
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: '4px' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      );
    }
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
        <button className="btn-primary" onClick={handleRetry}>重试</button>
      </div>
    );
  }

  return (
    <div className="prompt-list">
      <div className="form-card">
        <div className="prompt-table">
          <table>
            <thead>
              <tr>
                <th>Prompt Key</th>
                <th>Prompt 名称</th>
                <th>Prompt 描述</th>
                <th>最新版本</th>
                <th>提交人</th>
                <th className="sortable" onClick={() => handleSort('updatedAt')}>
                  提交时间 {renderSortIcon('updatedAt')}
                </th>
                <th>创建人</th>
                <th className="sortable" onClick={() => handleSort('createdAt')}>
                  创建时间 {renderSortIcon('createdAt')}
                </th>
                <th>备注</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {sortedPrompts.length === 0 ? (
                <tr>
                  <td colSpan={10} className="empty-cell">
                    <div className="empty-icon">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                        <polyline points="17 21 17 13 7 13 7 21"/>
                        <polyline points="7 3 7 8 15 8"/>
                      </svg>
                    </div>
                    <div className="empty-text">暂无内容</div>
                  </td>
                </tr>
              ) : (
                sortedPrompts.map((prompt) => (
                  <tr key={prompt.id}>
                    <td>{prompt.id}</td>
                    <td>{prompt.name}</td>
                    <td>{prompt.templateContent?.substring(0, 50)}...</td>
                    <td>v{prompt.version}</td>
                    <td>{prompt.createdBy}</td>
                    <td>{new Date(prompt.updatedAt).toLocaleString()}</td>
                    <td>{prompt.createdBy}</td>
                    <td>{new Date(prompt.createdAt).toLocaleString()}</td>
                    <td>-</td>
                    <td className="prompt-actions">
                      <button 
                        className="action-btn view" 
                        onClick={() => onView(prompt)}
                        title="详情"
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

