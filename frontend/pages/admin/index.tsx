// 后台管理主入口 - 组装所有模块

import React, { useState } from 'react';
import { NavSection, PromptModule } from './types';
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
        .admin-layout {
          display: flex;
          flex-direction: column;
          min-height: 100vh;
          background: var(--bg-primary);
        }

        .global-nav {
          height: 60px;
          background: white;
          border-bottom: 1px solid #e5e7eb;
          position: sticky;
          top: 0;
          z-index: 200;
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
        }

        .global-nav-content {
          width: 100%;
          margin: 0;
          padding: 0 20px;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .nav-left {
          display: flex;
          align-items: center;
          gap: 40px;
        }

        .brand-section {
          flex: 0 0 auto;
        }

        .brand-logo {
          display: flex;
          align-items: center;
          gap: 12px;
          text-decoration: none;
          color: var(--text-primary);
          font-weight: 600;
          font-size: 18px;
        }

        .brand-logo:hover {
          text-decoration: none;
        }

        .brand-icon {
          display: flex;
          align-items: center;
          color: #2490f8;
        }

        .main-nav {
          flex: 0 0 auto;
        }

        .nav-links {
          display: flex;
          gap: 24px;
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .nav-link {
          text-decoration: none;
          color: #6b7280;
          font-size: 14px;
          font-weight: 500;
          padding: 8px 12px;
          border-radius: 6px;
          transition: all 0.2s ease;
        }

        .nav-link:hover {
          color: #374151;
          background-color: #f3f4f6;
          text-decoration: none;
        }

        .user-section {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-right: 10px;
        }

        .language-switcher {
          position: relative;
        }

        .language-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          padding: 0;
          background: transparent;
          border: none;
          border-radius: 50%;
          cursor: pointer;
          transition: all 0.2s ease;
          color: #6b7280;
        }

        .language-btn:hover {
          background: #f3f4f6;
          color: #374151;
        }

        .language-dropdown {
          position: absolute;
          top: 100%;
          right: 50%;
          transform: translateX(50%);
          margin-top: 8px;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
          width: 100px;
          z-index: 1000;
        }

        .language-option {
          display: block;
          width: 100%;
          padding: 8px 12px;
          text-align: center;
          border: none;
          background: none;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .language-option:hover {
          background: #f3f4f6;
        }

        .user-avatar {
          position: relative;
        }

        .avatar-button {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: #f3f4f6;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease;
          border: none;
          padding: 0;
        }

        .avatar-button:hover {
          background: #e5e7eb;
          color: #374151;
        }

        .avatar-small {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: #2490f8;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 14px;
        }

        .avatar-medium {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: #2490f8;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 16px;
        }

        .avatar-small-image {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          object-fit: cover;
        }

        .avatar-medium-image {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          object-fit: cover;
        }

        .dropdown-menu {
          position: absolute;
          top: 100%;
          right: 8px;
          margin-top: 8px;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
          min-width: 240px;
          z-index: 1000;
        }

        .dropdown-header {
          padding: 16px;
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .user-info {
          flex: 1;
          min-width: 0;
        }

        .user-name {
          font-size: 14px;
          font-weight: 600;
          color: #1f2937;
          margin-bottom: 4px;
        }

        .user-email {
          font-size: 12px;
          color: #6b7280;
        }

        .dropdown-divider {
          height: 1px;
          background: #e5e7eb;
        }

        .dropdown-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 16px;
          text-decoration: none;
          color: #374151;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .dropdown-item:hover {
          background: #f3f4f6;
        }

        .dropdown-item-logout {
          color: #ef4444;
          border: none;
          background: none;
          width: 100%;
          text-align: left;
        }

        .dropdown-item-logout:hover {
          background: #fee2e2;
        }

        .sidebar {
          width: 215px;
          background: white;
          border-right: 1px solid #e5e7eb;
          display: flex;
          flex-direction: column;
          position: fixed;
          top: 60px;
          left: 0;
          bottom: 0;
          z-index: 100;
          box-shadow: 1px 0 3px rgba(0, 0, 0, 0.05);
        }

        .sidebar-nav {
          flex: 1;
          overflow-y: auto;
          padding: 16px 0;
          width: 215px;
          height: 816px;
        }

        .nav-section {
          margin-bottom: 24px;
        }

        .nav-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 8px 20px;
          background: none;
          border: none;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .nav-section-header:hover {
          background: #f3f4f6;
        }

        .nav-section-title {
          font-size: 14px;
          font-weight: 600;
          line-height: 13px;
          letter-spacing: 1px;
          color: rgb(134, 134, 139);
          margin: 0;
        }

        .nav-section-chevron {
          color: #9ca3af;
          transition: transform 0.2s ease;
        }

        .nav-section-chevron.expanded {
          transform: rotate(180deg);
        }

        .nav-items {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 9px 16px;
          background: none;
          border: none;
          cursor: pointer;
          color: #6b7280;
          font-size: 14px;
          text-align: left;
          transition: all 0.2s ease;
          border-radius: 4px;
          margin: 0 auto;
          width: calc(100% - 16px);
          max-width: 180px;
        }

        .nav-item:hover {
          background: #f3f4f6;
          color: #374151;
        }

        .nav-item.active {
          background: rgba(36, 144, 248, 0.08);
          color: #2490f8;
          font-weight: 500;
        }

        .nav-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
        }

        .nav-label {
          flex: 1;
        }

        .main-content {
          flex: 1;
          margin-left: 215px;
          display: flex;
          flex-direction: column;
          min-height: calc(100vh - 60px);
          margin-top: 0;
          background: #f9fafb;
        }

        .content-header {
          height: 56px;
          padding: 0 24px;
          background: #f9fafb;
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: sticky;
          top: 60px;
          z-index: 50;
        }

        .breadcrumb {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          color: var(--text-secondary);
        }

        .breadcrumb .current {
          color: var(--text-primary);
          font-weight: 500;
        }

        .content-body {
          flex: 1;
          padding: 20px 20px 20px 32px;
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
          height: 22px;
          line-height: 22px;
          padding: 0px;
          border-radius: 0px;
        }

        .header-actions {
          display: flex;
          align-items: center;
        }

        .panel-description {
          font-size: 14px;
          color: #6b7280;
        }

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

        @media (max-width: 1024px) {
          .sidebar {
            width: 220px;
          }

          .main-content {
            margin-left: 220px;
          }

          .form-row {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 768px) {
          .sidebar {
            transform: translateX(-100%);
            transition: transform 0.3s ease;
          }

          .sidebar.open {
            transform: translateX(0);
          }

          .main-content {
            margin-left: 0;
          }
        }
      `}</style>
    </>
  );
};

export default Admin;
