// 模型管理模块

import React from 'react';
import type { TestStatus, SaveStatus, TestResult, ProviderInfo, ModelInfo } from './types';
import { PROVIDER_LIST, MODEL_MAP } from '@shared/constants';

interface ModelManagementProps {
  apiKey: string;
  provider: string;
  model: string;
  testStatus: TestStatus;
  testResult: TestResult | null;
  saveStatus: SaveStatus;
  activeNavItem: string;
  onApiKeyChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onTestConnection: () => void;
  onSaveConfig: () => void;
  isConfigValid: () => boolean;
}

export const ModelManagement: React.FC<ModelManagementProps> = ({
  apiKey,
  provider,
  model,
  testStatus,
  testResult,
  saveStatus,
  activeNavItem,
  onApiKeyChange,
  onProviderChange,
  onModelChange,
  onTestConnection,
  onSaveConfig,
  isConfigValid,
}) => {
  return (
    <>
      {activeNavItem === 'config' && renderApiKeyConfig({
        apiKey, provider, model, testStatus, testResult, saveStatus,
        onApiKeyChange, onProviderChange, onModelChange, onTestConnection, onSaveConfig, isConfigValid,
      })}
      {activeNavItem === 'provider' && renderProviderManagement()}
      {activeNavItem === 'model-list' && renderModelList()}
    </>
  );
};

// API Key 配置
interface ApiKeyConfigProps {
  apiKey: string;
  provider: string;
  model: string;
  testStatus: TestStatus;
  testResult: TestResult | null;
  saveStatus: SaveStatus;
  onApiKeyChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onTestConnection: () => void;
  onSaveConfig: () => void;
  isConfigValid: () => boolean;
}

const renderApiKeyConfig: React.FC<ApiKeyConfigProps> = ({
  apiKey, provider, model, testStatus, testResult, saveStatus,
  onApiKeyChange, onProviderChange, onModelChange, onTestConnection, onSaveConfig, isConfigValid,
}) => (
  <div className="content-panel">
    <div className="panel-header">
      <h2 className="panel-title">API Key 配置</h2>
      <p className="panel-description">配置 AI 服务商的连接信息</p>
    </div>
    <div className="form-card">
      <div className="form-group">
        <label htmlFor="apiKey" className="form-label">
          API Key
          <span className="label-required">*</span>
        </label>
        <input
          type="password"
          id="apiKey"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          placeholder="请输入您的 API Key"
          className="form-input"
        />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="provider" className="form-label">
            服务商
            <span className="label-required">*</span>
          </label>
          <select
            id="provider"
            value={provider}
            onChange={(e) => { onProviderChange(e.target.value); onModelChange(''); }}
            className="form-select"
          >
            <option value="">请选择服务商</option>
            {PROVIDER_LIST.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="model" className="form-label">
            模型
            <span className="label-required">*</span>
          </label>
          <select
            id="model"
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            className="form-select"
            disabled={!provider}
          >
            <option value="">请选择模型</option>
            {provider && MODEL_MAP[provider]?.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-actions">
        <button
          className="btn-secondary"
          onClick={() => onTestConnection()}
          disabled={!isConfigValid() || testStatus === 'testing'}
        >
          {testStatus === 'testing' ? '测试中...' : '测试连接'}
        </button>
        <button
          className="btn-primary"
          onClick={() => onSaveConfig()}
          disabled={!isConfigValid() || saveStatus === 'saving'}
        >
          {saveStatus === 'saving' ? '保存中...' : '保存配置'}
        </button>
      </div>
    </div>
    {testResult && (
      <div className={`test-result ${testStatus}`}>
        {testStatus === 'success' ? (
          <>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M8 12L11 15L16 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <div className="result-info">
              <h4>连接成功</h4>
              <p>{testResult.message}</p>
              {testResult.responseTime && <p className="response-time">响应时间：{testResult.responseTime}ms</p>}
            </div>
          </>
        ) : (
          <>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M15 9L9 15M9 9L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <div className="result-info">
              <h4>连接失败</h4>
              <p>{testResult.error || '请检查配置信息是否正确'}</p>
            </div>
          </>
        )}
      </div>
    )}
  </div>
);

// 服务商管理
const renderProviderManagement = () => {
  const providers: ProviderInfo[] = [
    { id: 'deepseek', name: 'DeepSeek', models: 3, status: 'active' },
    { id: 'glm', name: 'GLM', models: 3, status: 'active' },
    { id: 'minimax', name: 'MiniMax', models: 2, status: 'active' },
    { id: 'kimi', name: 'Kimi', models: 2, status: 'active' },
    { id: 'qwen', name: 'Qwen', models: 3, status: 'active' },
  ];

  return (
    <div className="content-panel">
      <div className="panel-header">
        <h2 className="panel-title">服务商管理</h2>
        <p className="panel-description">管理系统支持的服务商</p>
      </div>
      <div className="provider-grid">
        {providers.map((provider) => (
          <div key={provider.id} className="provider-card">
            <div className="provider-header">
              <div className="provider-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                </svg>
              </div>
              <span className={`status-badge ${provider.status}`}>{provider.status === 'active' ? '已启用' : '已禁用'}</span>
            </div>
            <h3 className="provider-name">{provider.name}</h3>
            <p className="provider-models">{provider.models} 个模型</p>
            <div className="provider-actions">
              <button className="btn-small">配置</button>
              <button className="btn-small btn-outline">详情</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// 模型列表
const renderModelList = () => {
  const models: ModelInfo[] = [];
  for (const [providerId, providerModels] of Object.entries(MODEL_MAP)) {
    const providerName = PROVIDER_LIST.find(p => p.id === providerId)?.name || providerId;
    for (const m of providerModels) {
      models.push({ provider: providerName, name: m.name, id: m.id, status: 'active' });
    }
  }

  return (
    <div className="content-panel">
      <div className="panel-header">
        <h2 className="panel-title">模型列表</h2>
        <p className="panel-description">查看所有可用的 AI 模型</p>
      </div>
      <div className="model-table">
        <table>
          <thead>
            <tr>
              <th>服务商</th>
              <th>模型名称</th>
              <th>模型 ID</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model, index) => (
              <tr key={index}>
                <td>{model.provider}</td>
                <td>{model.name}</td>
                <td className="model-id">{model.id}</td>
                <td><span className={`status-badge ${model.status}`}>{model.status === 'active' ? '启用' : '禁用'}</span></td>
                <td>
                  <button className="btn-small">测试</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ModelManagement;
