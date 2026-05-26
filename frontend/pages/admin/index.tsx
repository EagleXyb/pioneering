// 后台管理主入口 - 组装所有模块

import React, { useState } from 'react';
import type { NavSection, PromptModule } from './types';
import { AdminLayout } from './AdminLayout';
import { ModelManagement } from './ModelManagement';
import { PromptManagement } from './PromptManagement';
import { SecurityManagement } from './SecurityManagement';
import { UserManagement } from './UserManagement';
import { useAIConfig, usePromptManagement } from './hooks';

const Admin: React.FC = () => {
  const [activeSection, setActiveSection] = useState<NavSection>('model');
  const [activeNavItem, setActiveNavItem] = useState<string>('config');

  // AI 配置相关的状态和操作
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
    if (section === 'prompt') {
      setActiveModule(itemKey as PromptModule);
    }
  };

  // 渲染内容区域
  const renderContent = () => {
    if (activeSection === 'model') {
      return (
        <ModelManagement
          apiKey={apiKey}
          provider={provider}
          model={model}
          testStatus={testStatus}
          testResult={testResult}
          saveStatus={saveStatus}
          activeNavItem={activeNavItem}
          onApiKeyChange={setApiKey}
          onProviderChange={setProvider}
          onModelChange={setModel}
          onTestConnection={handleTestConnection}
          onSaveConfig={handleSaveConfig}
          isConfigValid={isConfigValid}
        />
      );
    }

    if (activeSection === 'prompt') {
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

    if (activeSection === 'security') {
      return <SecurityManagement activeSection={activeNavItem} />;
    }

    if (activeSection === 'users') {
      return <UserManagement />;
    }

    return null;
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
        /* ===== 各模块通用样式 ===== */
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

        .panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
          padding: 16px;
          border: 1px solid #e5e7eb;
          border-radius: 5px;
          background: white;
        }

        .header-left {
          display: flex;
          align-items: center;
        }

        .panel-title {
          font-size: 16px;
          font-weight: 600;
          color: #374151;
          margin: 0;
        }

        .header-actions {
          display: flex;
          align-items: center;
        }

        .panel-description {
          font-size: 14px;
          color: #6b7280;
        }

        /* ===== ModelManagement - 表单样式（P0-3 后将删除） ===== */
        .form-card {
          background: white;
          border-radius: 8px;
          padding: 24px;
          border: 1px solid #e5e7eb;
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-label {
          display: block;
          font-size: 14px;
          font-weight: 500;
          color: var(--text-primary);
          margin-bottom: 8px;
        }

        .label-required {
          color: #e74c3c;
          margin-left: 4px;
        }

        .form-input,
        .form-select,
        .form-textarea {
          width: 100%;
          padding: 12px 16px;
          font-size: 14px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--bg-primary);
          color: var(--text-primary);
          transition: border-color 0.2s ease;
        }

        .form-input:focus,
        .form-select:focus,
        .form-textarea:focus {
          outline: none;
          border-color: #2490f8;
        }

        .form-hint {
          margin-top: 8px;
          font-size: 12px;
          color: var(--text-secondary);
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
          height: 41px;
          background: #2490f8;
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 2px 8px rgba(36, 144, 248, 0.3);
        }

        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(36, 144, 248, 0.4);
        }

        .btn-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        .btn-secondary {
          width: 120px;
          height: 41px;
          background: var(--bg-primary);
          color: var(--text-primary);
          border: 1px solid var(--border);
          border-radius: 4px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .btn-secondary:hover {
          background: var(--border-light);
        }

        .btn-secondary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .test-result {
          margin-top: 20px;
          padding: 16px;
          border-radius: 8px;
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }

        .test-result.success {
          background: rgba(36, 144, 248, 0.1);
          border: 1px solid rgba(36, 144, 248, 0.3);
          color: #2490f8;
        }

        .test-result.error {
          background: rgba(231, 76, 60, 0.1);
          border: 1px solid rgba(231, 76, 60, 0.3);
          color: #e74c3c;
        }

        .result-info h4 {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 4px;
        }

        .result-info p {
          font-size: 14px;
          margin: 0;
          color: var(--text-secondary);
        }

        .response-time {
          margin-top: 8px !important;
          font-size: 12px !important;
        }

        .provider-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          width: 100%;
        }

        .provider-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 24px 20px;
          transition: all 0.3s ease;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .provider-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
          border-color: #2490f8;
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
          border-radius: 12px;
          background: #2490f8;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .status-badge {
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
        }

        .status-badge.active {
          background: rgba(36, 144, 248, 0.1);
          color: #2490f8;
        }

        .status-badge.inactive {
          background: rgba(149, 165, 166, 0.1);
          color: #95a5a6;
        }

        .provider-name {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 4px;
        }

        .provider-models {
          font-size: 13px;
          color: var(--text-secondary);
          margin-bottom: 12px;
        }

        .provider-actions {
          display: flex;
          gap: 8px;
          justify-content: center;
          margin-top: auto;
          padding-top: 16px;
          width: 100%;
          border-top: 1px solid #f3f4f6;
        }

        .btn-small {
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 500;
          border-radius: 4px;
          border: none;
          cursor: pointer;
          transition: all 0.2s ease;
          background: #2490f8;
          color: white;
          box-shadow: 0 1px 4px rgba(36, 144, 248, 0.3);
        }

        .btn-small:hover {
          opacity: 0.9;
          transform: translateY(-1px);
          box-shadow: 0 2px 8px rgba(36, 144, 248, 0.4);
        }

        .btn-small.btn-outline {
          background: transparent;
          border: 1px solid #2490f8;
          color: #1a7de6;
          box-shadow: none;
        }

        .btn-small.btn-outline:hover {
          background: rgba(36, 144, 248, 0.08);
          opacity: 1;
          transform: none;
          box-shadow: none;
        }

        .model-table {
          background: var(--bg-secondary);
          border-radius: 12px;
          border: 1px solid var(--border-light);
          overflow: hidden;
        }

        .model-table table {
          width: 100%;
          border-collapse: collapse;
        }

        .model-table th {
          text-align: left;
          padding: 14px 16px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-secondary);
          background: var(--bg-primary);
          border-bottom: 1px solid var(--border-light);
        }

        .model-table td {
          padding: 14px 16px;
          font-size: 14px;
          color: var(--text-primary);
          border-bottom: 1px solid var(--border-light);
        }

        .model-table tr:last-child td {
          border-bottom: none;
        }

        .model-table tr:hover td {
          background: var(--bg-primary);
        }

        .model-id {
          font-family: monospace;
          font-size: 13px !important;
          color: var(--text-secondary) !important;
        }

        /* ===== SecurityManagement - 占位样式（P1-8 后将删除） ===== */
        .coming-soon {
          background: var(--bg-secondary);
          border-radius: 12px;
          border: 1px solid var(--border-light);
          padding: 60px 40px;
          text-align: center;
        }

        .coming-soon-icon {
          color: var(--border);
          margin-bottom: 24px;
        }

        .coming-soon h3 {
          font-size: 20px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 8px;
        }

        .coming-soon p {
          font-size: 14px;
          color: var(--text-secondary);
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
