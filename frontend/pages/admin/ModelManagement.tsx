// 模型管理模块（TDesign 重构版）

import React from 'react';
import { Button, Form, Input, Select, Alert, Card, Tabs, Switch } from 'tdesign-react';
import {
  CheckCircleFilledIcon,
  CloseCircleFilledIcon,
  AddIcon,
  SearchIcon,
  BrowseIcon,
  AppIcon,
  ViewModuleIcon,
  ChartLineIcon,
  FileIcon,
  InternetIcon,
  ChevronRightIcon,
  CopyIcon,
} from 'tdesign-icons-react';
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
  onApiKeyChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onTestConnection: () => void;
  onSaveConfig: () => void;
  isConfigValid: () => boolean;
}

export const ModelManagement: React.FC<ModelManagementProps> = (props) => {
  const [activeTab, setActiveTab] = React.useState<string>('config');

  return (
    <div className="content-body">
      <Tabs
        value={activeTab}
        onChange={(val) => setActiveTab(val as string)}
        theme="normal"
        style={{ marginBottom: 16 }}
      >
        <Tabs.TabPanel value="config" label="API Key 配置" />
        <Tabs.TabPanel value="provider" label="服务商管理" />
        <Tabs.TabPanel value="model-list" label="模型列表" />
      </Tabs>

      {activeTab === 'config' && <ApiKeyConfig {...props} />}
      {activeTab === 'provider' && <ProviderManagement />}
      {activeTab === 'model-list' && <ModelList />}
    </div>
  );
};

// ==================== API Key 配置 ====================
const ApiKeyConfig: React.FC<ModelManagementProps> = ({
  apiKey, provider, model, testStatus, testResult, saveStatus,
  onApiKeyChange, onProviderChange, onModelChange, onTestConnection, onSaveConfig, isConfigValid,
}) => {
  const providerOptions = PROVIDER_LIST.map(p => ({ label: p.name, value: p.id }));

  const [apiEndpoint, setApiEndpoint] = React.useState('');
  const [contextInput, setContextInput] = React.useState('64096');
  const [contextOutput, setContextOutput] = React.useState('8192');
  const [showApiKey, setShowApiKey] = React.useState(false);
  const [advancedExpanded, setAdvancedExpanded] = React.useState(false);
  const [toolCallEnabled, setToolCallEnabled] = React.useState(false);
  const [imageInputEnabled, setImageInputEnabled] = React.useState(false);
  const [reasoningMode, setReasoningMode] = React.useState('');
  const [customProtocol, setCustomProtocol] = React.useState('');
  const [compatProtocol, setCompatProtocol] = React.useState('');

  const selectedModelInfo = provider && model
    ? MODEL_MAP[provider]?.find(m => m.id === model)
    : null;

  const handleCopyApiKey = () => {
    navigator.clipboard.writeText(apiKey);
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* ===== 左栏：基础连接 ===== */}
        <div className="form-card">
          <div className="config-section-header">
            <span className="section-title">基础连接</span>
            <span className="section-priority">P0</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <FormItem label="供应商名称" requiredMark>
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
            <FormItem label="API Endpoint" requiredMark>
              <Input
                placeholder="https://api.example.com/v1"
                value={apiEndpoint}
                onChange={(val) => setApiEndpoint(val as string)}
              />
            </FormItem>
          </div>

          <FormItem label="API Key" requiredMark>
            <Input
              type={showApiKey ? 'text' : 'password'}
              placeholder="请输入您的 API Key"
              value={apiKey}
              onChange={(value) => onApiKeyChange(value as string)}
              suffixIcon={
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <BrowseIcon
                    style={{ cursor: 'pointer', color: '#999' }}
                    onClick={() => setShowApiKey(!showApiKey)}
                  />
                  <CopyIcon
                    style={{ cursor: 'pointer', color: '#999' }}
                    onClick={handleCopyApiKey}
                  />
                </div>
              }
            />
          </FormItem>

          <div style={{ marginTop: 4 }}>
            <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)' }}>连接测试</span>
            <div style={{ marginTop: 8 }}>
              <Button
                theme="primary"
                size="small"
                onClick={onTestConnection}
                disabled={!isConfigValid() || testStatus === 'testing'}
                loading={testStatus === 'testing'}
              >
                测试连接
              </Button>
            </div>
          </div>
        </div>

        {/* ===== 右栏：模型定义 + 高级配置 ===== */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 模型定义 */}
          <div className="form-card">
            <div className="config-section-header">
              <span className="section-title">模型定义</span>
              <span className="section-priority">P0</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <FormItem label="模型名称" requiredMark>
                <Input
                  placeholder="请输入模型名称"
                  value={selectedModelInfo?.name || ''}
                  suffixIcon={
                    selectedModelInfo?.id
                      ? <span style={{ fontSize: 12, color: '#999' }}>({selectedModelInfo.id})</span>
                      : undefined
                  }
                />
              </FormItem>
              <FormItem label="模型标识" requiredMark>
                <Input
                  placeholder="请输入模型标识"
                  value={model}
                  onChange={(value) => onModelChange(value as string)}
                />
              </FormItem>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <FormItem label="上下文窗口 — 输入容量" requiredMark>
                <Input
                  placeholder="请输入"
                  value={contextInput}
                  onChange={(val) => setContextInput(val as string)}
                  suffix={<span style={{ color: '#999', fontSize: 13 }}>tokens</span>}
                />
              </FormItem>
              <FormItem label="上下文窗口 — 最大输出" requiredMark>
                <Input
                  placeholder="请输入"
                  value={contextOutput}
                  onChange={(val) => setContextOutput(val as string)}
                  suffix={<span style={{ color: '#999', fontSize: 13 }}>tokens</span>}
                />
              </FormItem>
            </div>
          </div>

          {/* 高级配置 */}
          <div
            className="form-card"
            style={{ cursor: 'pointer' }}
            onClick={() => setAdvancedExpanded(!advancedExpanded)}
          >
            <div className="config-section-header">
              <span className="section-title">高级配置</span>
              <span className="section-priority">P1</span>
              <ChevronRightIcon
                size="16px"
                style={{
                  marginLeft: 'auto',
                  transition: 'transform 0.2s',
                  transform: advancedExpanded ? 'rotate(90deg)' : 'none',
                  color: '#999',
                }}
              />
            </div>

            {advancedExpanded && (
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
                    <span style={{ fontSize: 14, color: 'rgba(0,0,0,0.7)' }}>工具调用</span>
                    <Switch size="small" value={toolCallEnabled} onChange={(val) => setToolCallEnabled(val as boolean)} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
                    <span style={{ fontSize: 14, color: 'rgba(0,0,0,0.7)' }}>图片输入</span>
                    <Switch size="small" value={imageInputEnabled} onChange={(val) => setImageInputEnabled(val as boolean)} />
                  </div>
                </div>

                <FormItem label="推理模式">
                  <Select
                    placeholder="请选择推理模式"
                    value={reasoningMode}
                    options={[
                      { label: '标准模式', value: 'standard' },
                      { label: '思维链', value: 'chain-of-thought' },
                      { label: '深度推理', value: 'deep-reasoning' },
                    ]}
                    onChange={(val) => setReasoningMode(val as string)}
                  />
                </FormItem>

                <FormItem label="自定义协议">
                  <Input
                    placeholder="请输入自定义协议地址"
                    value={customProtocol}
                    onChange={(val) => setCustomProtocol(val as string)}
                  />
                </FormItem>

                <FormItem label="兼容协议">
                  <Input
                    placeholder="如 openai-compatible 等"
                    value={compatProtocol}
                    onChange={(val) => setCompatProtocol(val as string)}
                  />
                </FormItem>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 操作按钮行 */}
      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
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

      {/* 测试结果 */}
      {testResult && (
        <div style={{ marginTop: 16 }}>
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
  const [searchText, setSearchText] = React.useState('');

  const providers: Array<ProviderInfo & { description: string; icon: React.ReactNode }> = [
    {
      id: 'deepseek', name: 'DeepSeek', models: 3, status: 'active',
      description: 'DeepSeek 大语言模型服务，提供高性能的对话生成、代码补全与推理能力，支持长上下文处理。',
      icon: <AppIcon size="26px" />,
    },
    {
      id: 'glm', name: 'GLM', models: 3, status: 'active',
      description: '智谱 GLM 系列模型，具备强大的中文理解能力与多轮对话表现，适用于知识问答场景。',
      icon: <ViewModuleIcon size="26px" />,
    },
    {
      id: 'minimax', name: 'MiniMax', models: 2, status: 'inactive',
      description: 'MiniMax 开源大模型，专注于多模态理解与创意内容生成，提供灵活的 API 接入方案。',
      icon: <ChartLineIcon size="26px" />,
    },
    {
      id: 'kimi', name: 'Kimi', models: 2, status: 'active',
      description: 'Kimi 智能助手底层模型，擅长超长文档阅读与深度推理分析，支持百万级上下文窗口。',
      icon: <FileIcon size="26px" />,
    },
    {
      id: 'qwen', name: 'Qwen', models: 3, status: 'active',
      description: '通义千问系列大模型，阿里云出品，覆盖从轻量到旗舰的全尺寸模型矩阵，性价比优异。',
      icon: <InternetIcon size="26px" />,
    },
  ];

  const filteredProviders = searchText
    ? providers.filter(p => p.name.toLowerCase().includes(searchText.toLowerCase()))
    : providers;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 操作栏 */}
      <div className="provider-toolbar">
        <Button theme="primary" icon={<AddIcon />}>新建服务商</Button>
        <Input
          placeholder="请输入你需要搜索的内容"
          value={searchText}
          onChange={(val) => setSearchText(val as string)}
          prefixIcon={<SearchIcon />}
          style={{ width: 320 }}
        />
      </div>

      {/* 卡片网格 */}
      <div className="provider-card-grid">
        {filteredProviders.map((item) => {
          const initial = item.name.charAt(0).toUpperCase();
          return (
            <Card key={item.id} className="provider-list-card" hoverShadow bordered>
              {/* 顶部：图标 + 状态标签 */}
              <div className="provider-card-header">
                <div className="provider-icon-circle">{item.icon}</div>
                <span className={`provider-status-tag ${item.status}`}>
                  {item.status === 'active' ? '已启用' : '已禁用'}
                </span>
              </div>

              {/* 中间：标题 + 描述 */}
              <div className="provider-card-body">
                <h4 className="provider-card-title">{item.name}</h4>
                <p className="provider-card-desc">{item.description}</p>
              </div>

              {/* 底部：首字母徽标 + 加号 | 更多操作 */}
              <div className="provider-card-footer">
                <div className="provider-footer-left">
                  <span className="provider-initial-badge">{initial}</span>
                  <button className="provider-add-btn">+</button>
                </div>
                <button className="provider-more-btn">
                  <svg width="4" height="16" viewBox="0 0 4 16" fill="currentColor">
                    <circle cx="2" cy="3" r="2"/>
                    <circle cx="2" cy="8" r="2"/>
                    <circle cx="2" cy="13" r="2"/>
                  </svg>
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      {/* 无结果 */}
      {filteredProviders.length === 0 && (
        <div className="provider-empty">
          <BrowseIcon size="48px" />
          <p>暂无匹配的服务商</p>
        </div>
      )}

      <style>{`
        .provider-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .provider-card-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }

        /* ===== 卡片容器 ===== */
        .provider-list-card {
          border-radius: 6px !important;
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.06) !important;
          transition: all 0.2s ease;
          overflow: hidden;
        }
        .provider-list-card:hover {
          box-shadow: 0 6px 16px 0 rgba(0, 0, 0, 0.08) !important;
        }

        /* ===== 顶部：图标 + 状态标签 ===== */
        .provider-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 20px 16px;
        }

        .provider-icon-circle {
          width: 48px;
          height: 48px;
          border-radius: 6px;
          background: #e8f0fe;
          color: #0052d9;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          flex-shrink: 0;
        }

        .provider-status-tag {
          display: inline-flex;
          align-items: center;
          padding: 2px 8px;
          border-radius: 3px;
          font-size: 12px;
          font-weight: 500;
          line-height: 1;
          flex-shrink: 0;
        }
        .provider-status-tag.active {
          background: #e8f8f2;
          color: #2ba471;
        }
        .provider-status-tag.inactive {
          background: #f3f3f3;
          color: #999;
        }

        /* ===== 中间：标题 + 描述 ===== */
        .provider-card-body {
          padding: 0 20px 16px;
        }

        .provider-card-title {
          font-size: 16px;
          font-weight: 600;
          color: rgba(0, 0, 0, 0.9);
          margin: 0 0 8px 0;
          line-height: 1.4;
        }

        .provider-card-desc {
          font-size: 13px;
          color: rgba(0, 0, 0, 0.4);
          margin: 0;
          line-height: 1.75;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        /* ===== 底部：首字母徽标 + 加号 | 更多 ===== */
        .provider-card-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 20px 16px;
        }

        .provider-footer-left {
          display: flex;
          align-items: center;
          gap: 0;
        }

        .provider-initial-badge {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: #e8f0fe;
          color: #0052d9;
          font-size: 14px;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .provider-add-btn {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: #d6e4fc;
          color: #0052d9;
          border: none;
          font-size: 15px;
          font-weight: 400;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          margin-left: -8px;
          position: relative;
          z-index: 1;
          transition: background 0.2s;
        }
        .provider-add-btn:hover {
          background: #bdd4f9;
        }

        .provider-more-btn {
          width: 32px;
          height: 32px;
          border: none;
          background: transparent;
          color: #999;
          cursor: pointer;
          border-radius: 3px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        .provider-more-btn:hover {
          background: #f3f3f3;
          color: #555;
        }

        /* 覆盖 TDesign Card 内部样式 */
        .provider-list-card .t-card__body {
          padding: 0 !important;
        }
        .provider-list-card .t-card__actions {
          display: none !important;
        }

        /* ===== 空状态 ===== */
        .provider-empty {
          grid-column: 1 / -1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 64px 0;
          color: #dcdcdc;
        }

        /* ===== 响应式 ===== */
        @media (max-width: 1200px) {
          .provider-card-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 768px) {
          .provider-card-grid {
            grid-template-columns: 1fr;
          }
          .provider-toolbar {
            flex-direction: column;
            gap: 12px;
            align-items: stretch;
          }
          .provider-toolbar input {
            width: 100% !important;
          }
        }

        /* ===== API Key 配置：双栏布局 ===== */
        .config-section-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 16px;
        }
        .section-title {
          font-size: 15px;
          font-weight: 600;
          color: rgba(0, 0, 0, 0.9);
        }
        .section-priority {
          display: inline-flex;
          align-items: center;
          padding: 1px 8px;
          border-radius: 3px;
          background: #f0f2f5;
          color: #999;
          font-size: 12px;
          font-weight: 500;
          line-height: 18px;
        }

        @media (max-width: 960px) {
          div[style*="grid-template-columns: 1fr 1fr"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
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