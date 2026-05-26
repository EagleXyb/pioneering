// 模型管理模块（TDesign 重构版）

import React from 'react';
import { Button, Form, Input, Select, Alert } from 'tdesign-react';
import { CheckCircleFilledIcon, CloseCircleFilledIcon } from 'tdesign-icons-react';
import type { TestStatus, SaveStatus, TestResult, ProviderInfo, ModelInfo } from './types';
import { PROVIDER_LIST, MODEL_MAP } from '@shared/constants';

const { FormItem } = Form;

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

export const ModelManagement: React.FC<ModelManagementProps> = (props) => {
  const { activeNavItem } = props;

  return (
    <div className="content-body">
      {activeNavItem === 'config' && <ApiKeyConfig {...props} />}
      {activeNavItem === 'provider' && <ProviderManagement />}
      {activeNavItem === 'model-list' && <ModelList />}
    </div>
  );
};

// ==================== API Key 配置 ====================
const ApiKeyConfig: React.FC<ModelManagementProps> = ({
  apiKey, provider, model, testStatus, testResult, saveStatus,
  onApiKeyChange, onProviderChange, onModelChange, onTestConnection, onSaveConfig, isConfigValid,
}) => {
  const providerOptions = PROVIDER_LIST.map(p => ({ label: p.name, value: p.id }));
  const modelOptions = provider
    ? MODEL_MAP[provider]?.map(m => ({ label: m.name, value: m.id })) ?? []
    : [];

  return (
    <div>
      <div className="panel-header">
        <div className="header-left">
          <h2 className="panel-title">API Key 配置</h2>
        </div>
        <p className="panel-description">配置 AI 服务商的连接信息</p>
      </div>

      <div className="form-card">
        <Form layout="vertical" labelWidth={0}>
          <FormItem label="API Key" requiredMark>
            <Input
              type="password"
              placeholder="请输入您的 API Key"
              value={apiKey}
              onChange={(value) => onApiKeyChange(value as string)}
            />
          </FormItem>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <FormItem label="服务商" requiredMark>
              <Select
                placeholder="请选择服务商"
                value={provider}
                options={providerOptions}
                onChange={(value) => {
                  onProviderChange(value as string);
                  onModelChange('');
                }}
              />
            </FormItem>

            <FormItem label="模型" requiredMark>
              <Select
                placeholder="请选择模型"
                value={model}
                options={modelOptions}
                disabled={!provider}
                onChange={(value) => onModelChange(value as string)}
              />
            </FormItem>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            <Button
              variant="outline"
              onClick={onTestConnection}
              disabled={!isConfigValid() || testStatus === 'testing'}
              loading={testStatus === 'testing'}
            >
              测试连接
            </Button>
            <Button
              theme="primary"
              onClick={onSaveConfig}
              disabled={!isConfigValid() || saveStatus === 'saving'}
              loading={saveStatus === 'saving'}
            >
              保存配置
            </Button>
          </div>
        </Form>
      </div>

      {/* 测试结果 */}
      {testResult && (
        <div style={{ marginTop: 20 }}>
          {testStatus === 'success' ? (
            <Alert
              theme="success"
              title={`连接成功${testResult.responseTime ? `（响应时间：${testResult.responseTime}ms）` : ''}`}
              message={testResult.message}
              icon={<CheckCircleFilledIcon />}
            />
          ) : (
            <Alert
              theme="error"
              title="连接失败"
              message={testResult.error || '请检查配置信息是否正确'}
              icon={<CloseCircleFilledIcon />}
            />
          )}
        </div>
      )}
    </div>
  );
};

// ==================== 服务商管理 ====================
const ProviderManagement: React.FC = () => {
  const providers: ProviderInfo[] = [
    { id: 'deepseek', name: 'DeepSeek', models: 3, status: 'active' },
    { id: 'glm', name: 'GLM', models: 3, status: 'active' },
    { id: 'minimax', name: 'MiniMax', models: 2, status: 'active' },
    { id: 'kimi', name: 'Kimi', models: 2, status: 'active' },
    { id: 'qwen', name: 'Qwen', models: 3, status: 'active' },
  ];

  return (
    <div>
      <div className="panel-header">
        <div className="header-left">
          <h2 className="panel-title">服务商管理</h2>
        </div>
        <p className="panel-description">管理系统支持的服务商</p>
      </div>
      <div className="provider-grid">
        {providers.map((item) => (
          <div key={item.id} className="provider-card">
            <div className="provider-header">
              <div className="provider-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                </svg>
              </div>
              <span className={`status-badge ${item.status}`}>{item.status === 'active' ? '已启用' : '已禁用'}</span>
            </div>
            <h3 className="provider-name">{item.name}</h3>
            <p className="provider-models">{item.models} 个模型</p>
            <div className="provider-actions">
              <Button size="small">配置</Button>
              <Button size="small" variant="outline">详情</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ==================== 模型列表 ====================
const ModelList: React.FC = () => {
  const models: ModelInfo[] = [];
  for (const [providerId, providerModels] of Object.entries(MODEL_MAP)) {
    const providerName = PROVIDER_LIST.find(p => p.id === providerId)?.name || providerId;
    for (const m of providerModels) {
      models.push({ provider: providerName, name: m.name, id: m.id, status: 'active' });
    }
  }

  return (
    <div>
      <div className="panel-header">
        <div className="header-left">
          <h2 className="panel-title">模型列表</h2>
        </div>
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
            {models.map((item, index) => (
              <tr key={index}>
                <td>{item.provider}</td>
                <td>{item.name}</td>
                <td className="model-id">{item.id}</td>
                <td><span className={`status-badge ${item.status}`}>{item.status === 'active' ? '启用' : '禁用'}</span></td>
                <td><Button size="small">测试</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ModelManagement;