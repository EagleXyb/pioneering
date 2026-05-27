// 后台管理主入口 - 组装所有模块

import React, { useState } from 'react';
import type { NavSection, PromptModule } from './types';
import { AdminLayout } from './AdminLayout';
import { ModelManagement } from './ModelManagement';
import { PromptManagement } from './PromptManagement';
import { UserManagement } from './UserManagement';
import { DashboardOverview } from './DashboardOverview';
import { useAIConfig, usePromptManagement } from './hooks';

// ==================== 占位组件（后续待开发） ====================
const ComingSoonPlaceholder: React.FC = () => (
  <div className="content-panel">
    <div className="coming-soon">
      <div className="coming-soon-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <line x1="3" y1="9" x2="21" y2="9"/>
          <line x1="9" y1="21" x2="9" y2="9"/>
        </svg>
      </div>
      <h3>功能开发中</h3>
      <p>该功能正在紧张开发中，敬请期待...</p>
    </div>
  </div>
);

// ==================== Admin 主组件 ====================
const Admin: React.FC = () => {
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [activeNavItem, setActiveNavItem] = useState<string>('overview');

  // AI 配置相关的状态和操作（模型管理模块使用）
  const {
    apiKey, setApiKey,
    provider, setProvider,
    model, setModel,
    testStatus, testResult,
    saveStatus,
    isConfigValid,
    handleTestConnection,
    handleSaveConfig,
  } = useAIConfig();

  // Prompt 管理相关的状态和操作
  const {
    prompts,
    activeModule,
    setActiveModule,
    saveStatus: promptSaveStatus,
    isFullscreen,
    setIsFullscreen,
    handlePromptChange,
    handleSavePrompt,
  } = usePromptManagement();

  // 处理导航项点击
  const handleNavItemClick = (section: NavSection, itemKey: string) => {
    setActiveSection(section);
    setActiveNavItem(itemKey);
    if (section === 'model-prompt' && itemKey === 'prompt') {
      setActiveModule('global-settings' as PromptModule);
    }
  };

  // 渲染内容区域
  const renderContent = () => {
    // ----- 04. 模型与Prompt > 模型管理（已有代码）-----
    if (activeSection === 'model-prompt' && activeNavItem === 'model') {
      return (
        <ModelManagement
          apiKey={apiKey}
          provider={provider}
          model={model}
          testStatus={testStatus}
          testResult={testResult}
          saveStatus={saveStatus}
          onApiKeyChange={setApiKey}
          onProviderChange={setProvider}
          onModelChange={setModel}
          onTestConnection={handleTestConnection}
          onSaveConfig={handleSaveConfig}
          isConfigValid={isConfigValid}
        />
      );
    }

    // ----- 04. 模型与Prompt > Prompt管理（已有代码）-----
    if (activeSection === 'model-prompt' && activeNavItem === 'prompt') {
      return (
        <PromptManagement
          prompts={prompts}
          activeModule={activeModule}
          saveStatus={promptSaveStatus}
          isFullscreen={isFullscreen}
          onPromptChange={handlePromptChange}
          onSavePrompt={(module) => handleSavePrompt(module, apiKey, provider, model, testResult)}
          onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
        />
      );
    }

    // ----- 06. 用户与账户 > 用户与权限（已有代码）-----
    if (activeSection === 'user-account' && activeNavItem === 'user-permission') {
      return <UserManagement />;
    }

    // ----- 01. 仪表盘（系统概览/使用统计/关键指标）-----
    if (activeSection === 'dashboard') {
      return <DashboardOverview />;
    }

    // ----- 其余模块 / 子项：统一渲染占位 -----
    return <ComingSoonPlaceholder />;
  };

  return (
    <>
      <AdminLayout
        activeSection={activeSection}
        activeNavItem={activeNavItem}
        onNavItemClick={handleNavItemClick}
      >
        {renderContent()}
      </AdminLayout>

      <style>{`
        /* ===== 各模块通用样式（参照 TDesign Starter Dashboard 间距规范） ===== */
        .content-body {
          flex: 1;
          overflow-y: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }

        .content-body::-webkit-scrollbar {
          display: none;
        }

        .content-panel {
          width: 100%;
          transition: all 0.3s ease;
        }

        .content-panel.fullscreen-mode {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          z-index: 1000 !important;
          max-width: 100% !important;
          background: white !important;
          padding: 24px !important;
          overflow: auto !important;
        }

        /* 面板头部 */
        .panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }

        .header-left {
          display: flex;
          align-items: center;
        }

        .panel-title {
          font-size: 16px;
          font-weight: 600;
          color: rgba(0, 0, 0, 0.9);
          margin: 0;
        }

        .header-actions {
          display: flex;
          align-items: center;
        }

        .panel-description {
          font-size: 14px;
          color: rgba(0, 0, 0, 0.4);
        }

        /* 表单卡片 */
        .form-card {
          background: #fff;
          border-radius: 6px;
          padding: 24px;
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.06);
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-label {
          display: block;
          font-size: 14px;
          font-weight: 500;
          color: rgba(0, 0, 0, 0.9);
          margin-bottom: 8px;
        }

        .label-required {
          color: #e34d59;
          margin-left: 4px;
        }

        .form-input,
        .form-select,
        .form-textarea {
          width: 100%;
          padding: 8px 12px;
          font-size: 14px;
          border: 1px solid #dcdcdc;
          border-radius: 6px;
          background: #fff;
          color: rgba(0, 0, 0, 0.9);
          transition: border-color 0.2s ease;
        }

        .form-input:focus,
        .form-select:focus,
        .form-textarea:focus {
          outline: none;
          border-color: #0052d9;
          box-shadow: 0 0 0 2px rgba(0, 82, 217, 0.1);
        }

        .form-hint {
          margin-top: 8px;
          font-size: 12px;
          color: rgba(0, 0, 0, 0.4);
        }

        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .form-actions {
          display: flex;
          gap: 12px;
          margin-top: 24px;
        }

        .btn-primary {
          width: 120px;
          height: 40px;
          background: #0052d9;
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .btn-primary:hover {
          background: #0034b5;
        }

        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-secondary {
          width: 120px;
          height: 40px;
          background: #fff;
          color: rgba(0, 0, 0, 0.9);
          border: 1px solid #dcdcdc;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .btn-secondary:hover {
          border-color: #0052d9;
          color: #0052d9;
        }

        .btn-secondary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .test-result {
          margin-top: 16px;
          padding: 16px;
          border-radius: 6px;
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }

        .test-result.success {
          background: #e8f8f2;
          border: 1px solid #2ba471;
          color: #2ba471;
        }

        .test-result.error {
          background: #fcebe9;
          border: 1px solid #e34d59;
          color: #e34d59;
        }

        .result-info h4 {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 4px;
        }

        .result-info p {
          font-size: 14px;
          margin: 0;
          color: rgba(0, 0, 0, 0.6);
        }

        .response-time {
          margin-top: 8px !important;
          font-size: 12px !important;
        }

        .provider-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          width: 100%;
        }

        .provider-card {
          background: #fff;
          border-radius: 6px;
          padding: 24px 20px;
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.06);
          transition: all 0.2s ease;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .provider-card:hover {
          box-shadow: 0 6px 16px 0 rgba(0, 0, 0, 0.08);
        }

        .provider-header {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-bottom: 16px;
          gap: 12px;
        }

        .provider-icon {
          width: 48px;
          height: 48px;
          border-radius: 6px;
          background: #0052d9;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .status-badge {
          padding: 2px 8px;
          border-radius: 3px;
          font-size: 12px;
          font-weight: 500;
        }

        .status-badge.active {
          background: #e8f8f2;
          color: #2ba471;
        }

        .status-badge.inactive {
          background: #f3f3f3;
          color: #999;
        }

        .provider-name {
          font-size: 16px;
          font-weight: 600;
          color: rgba(0, 0, 0, 0.9);
          margin-bottom: 4px;
        }

        .provider-models {
          font-size: 13px;
          color: rgba(0, 0, 0, 0.4);
          margin-bottom: 12px;
        }

        .provider-actions {
          display: flex;
          gap: 8px;
          justify-content: center;
          margin-top: auto;
          padding-top: 16px;
          width: 100%;
          border-top: 1px solid #f3f3f3;
        }

        .btn-small {
          padding: 4px 12px;
          font-size: 12px;
          font-weight: 500;
          border-radius: 3px;
          border: none;
          cursor: pointer;
          transition: all 0.2s ease;
          background: #0052d9;
          color: white;
        }

        .btn-small:hover {
          background: #0034b5;
        }

        .btn-small.btn-outline {
          background: transparent;
          border: 1px solid #0052d9;
          color: #0052d9;
        }

        .btn-small.btn-outline:hover {
          background: rgba(0, 82, 217, 0.06);
        }

        /* 模型列表表格 */
        .model-table {
          background: #fff;
          border-radius: 6px;
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.06);
          overflow: hidden;
        }

        .model-table table {
          width: 100%;
          border-collapse: collapse;
        }

        .model-table th {
          text-align: left;
          padding: 12px 16px;
          font-size: 14px;
          font-weight: 600;
          color: rgba(0, 0, 0, 0.9);
          background: #fff;
          border-bottom: 1px solid #e7e7e7;
        }

        .model-table td {
          padding: 12px 16px;
          font-size: 14px;
          color: rgba(0, 0, 0, 0.6);
          border-bottom: 1px solid #e7e7e7;
        }

        .model-table tr:last-child td {
          border-bottom: none;
        }

        .model-table tr:hover td {
          background: #f3f3f3;
        }

        .model-id {
          font-family: monospace;
          font-size: 13px !important;
          color: rgba(0, 0, 0, 0.4) !important;
        }

        /* ===== 占位样式 ===== */
        .coming-soon {
          background: #fff;
          border-radius: 6px;
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.06);
          padding: 64px 40px;
          text-align: center;
        }

        .coming-soon-icon {
          color: #dcdcdc;
          margin-bottom: 24px;
        }

        .coming-soon h3 {
          font-size: 16px;
          font-weight: 600;
          color: rgba(0, 0, 0, 0.9);
          margin-bottom: 8px;
        }

        .coming-soon p {
          font-size: 14px;
          color: rgba(0, 0, 0, 0.4);
        }

        /* ===== 响应式 ===== */
        @media (max-width: 1024px) {
          .form-row {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </>
  );
};

export default Admin;