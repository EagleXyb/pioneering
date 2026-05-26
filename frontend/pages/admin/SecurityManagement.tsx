// 安全管理模块

import React from 'react';

interface SecurityManagementProps {
  activeSection: string;
}

// 访问日志
const AccessLog: React.FC = () => (
  <div className="content-panel">
    <div className="panel-header">
      <h2 className="panel-title">访问日志</h2>
    </div>
    <p className="panel-description" style={{ marginBottom: 16 }}>查看所有 API 访问记录</p>
    <div className="coming-soon">
      <div className="coming-soon-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      </div>
      <h3>功能开发中</h3>
      <p>该功能正在紧张开发中，敬请期待...</p>
    </div>
  </div>
);

// API 监控
const ApiMonitor: React.FC = () => (
  <div className="content-panel">
    <div className="panel-header">
      <h2 className="panel-title">API 监控</h2>
    </div>
    <p className="panel-description" style={{ marginBottom: 16 }}>实时监控 API 调用情况</p>
    <div className="coming-soon">
      <div className="coming-soon-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
        </svg>
      </div>
      <h3>功能开发中</h3>
      <p>该功能正在紧张开发中，敬请期待...</p>
    </div>
  </div>
);

// 限流配置
const RateLimit: React.FC = () => (
  <div className="content-panel">
    <div className="panel-header">
      <h2 className="panel-title">限流配置</h2>
    </div>
    <p className="panel-description" style={{ marginBottom: 16 }}>配置 API 调用频率限制</p>
    <div className="coming-soon">
      <div className="coming-soon-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>
      </div>
      <h3>功能开发中</h3>
      <p>该功能正在紧张开发中，敬请期待...</p>
    </div>
  </div>
);

export const SecurityManagement: React.FC<SecurityManagementProps> = ({ activeSection }) => {
  const renderContent = () => {
    switch (activeSection) {
      case 'access-log':
        return <AccessLog />;
      case 'api-monitor':
        return <ApiMonitor />;
      case 'rate-limit':
        return <RateLimit />;
      default:
        return <AccessLog />;
    }
  };

  return renderContent();
};

export default SecurityManagement;
