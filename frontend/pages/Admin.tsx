import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';

const API_BASE_URL = 'http://localhost:3000';

type NavSection = 'model' | 'prompt' | 'security';
type PromptModule = 'perception' | 'retrieval' | 'generation' | 'evaluation';
type TestStatus = 'idle' | 'testing' | 'success' | 'error';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface NavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
}

const Admin: React.FC = () => {
  const { userState } = useUser();
  const [activeSection, setActiveSection] = useState<NavSection>('model');
  const [activePromptModule, setActivePromptModule] = useState<PromptModule>('perception');
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testResult, setTestResult] = useState<{ message: string; responseTime?: number; error?: string } | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [isConnectionValid, setIsConnectionValid] = useState(false);
  const [configId, setConfigId] = useState<number | null>(null);
  const [prompts, setPrompts] = useState<Record<PromptModule, string>>({
    perception: '',
    retrieval: '',
    generation: '',
    evaluation: '',
  });

  const navSections: { key: NavSection; label: string; items: NavItem[] }[] = [
    {
      key: 'model',
      label: '模型管理',
      items: [
        {
          key: 'config',
          label: 'API Key 配置',
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          ),
        },
        {
          key: 'provider',
          label: '服务商管理',
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            </svg>
          ),
        },
        {
          key: 'model-list',
          label: '模型列表',
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6"/>
              <line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/>
              <line x1="3" y1="6" x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/>
              <line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          ),
        },
      ],
    },
    {
      key: 'prompt',
      label: 'Prompt 管理',
      items: [
        {
          key: 'perception',
          label: '问题感知模块',
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4"/>
              <path d="M12 8h.01"/>
            </svg>
          ),
        },
        {
          key: 'retrieval',
          label: '知识检索模块',
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/>
              <path d="M21 21l-4.35-4.35"/>
            </svg>
          ),
        },
        {
          key: 'generation',
          label: '创意生成模块',
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          ),
        },
        {
          key: 'evaluation',
          label: '评估反馈模块',
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          ),
        },
      ],
    },
    {
      key: 'security',
      label: '安全管理',
      items: [
        {
          key: 'access-log',
          label: '访问日志',
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          ),
        },
        {
          key: 'api-monitor',
          label: 'API 监控',
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          ),
        },
        {
          key: 'rate-limit',
          label: '限流配置',
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
          ),
        },
      ],
    },
  ];

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/ai-config/latest`);
      if (response.ok) {
        const config = await response.json();
        if (config) {
          setConfigId(config.id);
          setApiKey(config.apiKey || '');
          setProvider(config.provider || '');
          setModel(config.model || '');
          setPrompt(config.prompt || '');
          if (config.lastTestTime && config.lastTestResult) {
            setIsConnectionValid(true);
            setTestResult({ message: config.lastTestResult, responseTime: 0 });
          }
          localStorage.setItem('aiConfig', JSON.stringify(config));
        }
      }
    } catch (error) {
      const savedConfig = localStorage.getItem('aiConfig');
      if (savedConfig) {
        const config = JSON.parse(savedConfig);
        setApiKey(config.apiKey || '');
        setProvider(config.provider || '');
        setModel(config.model || '');
        setPrompt(config.prompt || '');
      }
    }
  };

  const isConfigValid = () => {
    return apiKey.trim() && provider && model;
  };

  const handleTestConnection = async () => {
    if (!isConfigValid()) {
      alert('请先填写完整的配置信息（API Key、服务商、模型）');
      return;
    }

    setTestStatus('testing');
    setTestResult(null);

    try {
      const response = await fetch(`${API_BASE_URL}/ai-config/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), provider, model }),
      });

      const result = await response.json();

      if (result.success) {
        setTestStatus('success');
        setTestResult(result);
        setIsConnectionValid(true);
      } else {
        setTestStatus('error');
        setTestResult(result);
        setIsConnectionValid(false);
      }
    } catch (error) {
      setTestStatus('error');
      setTestResult({
        message: '连接失败',
        error: error instanceof Error ? error.message : '网络错误，请检查后端服务',
      });
      setIsConnectionValid(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!isConfigValid()) {
      alert('配置信息不完整');
      return;
    }

    setSaveStatus('saving');

    const configData = {
      apiKey: apiKey.trim(),
      provider,
      model,
      prompt,
      lastTestInput: '连接测试',
      lastTestResult: testResult?.message || '',
      lastTestTime: new Date().toISOString(),
    };

    try {
      const response = await fetch(`${API_BASE_URL}/ai-config/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configData),
      });

      if (response.ok) {
        const savedConfig = await response.json();
        setConfigId(savedConfig.id);
        localStorage.setItem('aiConfig', JSON.stringify(savedConfig));
        setSaveStatus('saved');
        alert('配置保存成功！');
      } else {
        setSaveStatus('error');
        alert('保存失败，请重试');
      }
    } catch (error) {
      setSaveStatus('error');
      alert('保存失败：' + (error instanceof Error ? error.message : '未知错误'));
    }
  };

  const handleSavePrompt = async (module: PromptModule) => {
    const promptText = prompts[module];
    if (!promptText.trim()) {
      alert('请填写提示词内容');
      return;
    }

    setSaveStatus('saving');

    const configData = {
      apiKey: apiKey.trim(),
      provider,
      model,
      prompt: promptText.trim(),
      lastTestInput: '连接测试',
      lastTestResult: testResult?.message || '',
      lastTestTime: new Date().toISOString(),
    };

    try {
      const response = await fetch(`${API_BASE_URL}/ai-config/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configData),
      });

      if (response.ok) {
        const savedConfig = await response.json();
        setConfigId(savedConfig.id);
        localStorage.setItem('aiConfig', JSON.stringify(savedConfig));
        setSaveStatus('saved');
        alert(`${getModuleName(module)}提示词保存成功！`);
      } else {
        setSaveStatus('error');
        alert('保存失败，请重试');
      }
    } catch (error) {
      setSaveStatus('error');
      alert('保存失败：' + (error instanceof Error ? error.message : '未知错误'));
    }
  };

  const getModuleName = (module: PromptModule): string => {
    const names: Record<PromptModule, string> = {
      perception: '问题感知模块',
      retrieval: '知识检索模块',
      generation: '创意生成模块',
      evaluation: '评估反馈模块',
    };
    return names[module];
  };

  const handlePromptChange = (module: PromptModule, value: string) => {
    setPrompts((prev) => ({ ...prev, [module]: value }));
  };

  const renderModelConfig = () => (
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
            onChange={(e) => setApiKey(e.target.value)}
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
              onChange={(e) => { setProvider(e.target.value); setModel(''); }}
              className="form-select"
            >
              <option value="">请选择服务商</option>
              <option value="deepseek">DeepSeek</option>
              <option value="glm">GLM</option>
              <option value="minimax">MiniMax</option>
              <option value="kimi">Kimi</option>
              <option value="qwen">Qwen</option>
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
              onChange={(e) => setModel(e.target.value)}
              className="form-select"
              disabled={!provider}
            >
              <option value="">请选择模型</option>
              {provider === 'deepseek' && (
                <>
                  <option value="deepseek-chat">DeepSeek Chat</option>
                  <option value="deepseek-coder">DeepSeek Coder</option>
                  <option value="deepseek-v2">DeepSeek V2</option>
                </>
              )}
              {provider === 'glm' && (
                <>
                  <option value="glm-4">GLM-4</option>
                  <option value="glm-4v">GLM-4V</option>
                  <option value="glm-3-turbo">GLM-3 Turbo</option>
                </>
              )}
              {provider === 'minimax' && (
                <>
                  <option value="abab-5.5">ABAB-5.5</option>
                  <option value="abab-6">ABAB-6</option>
                </>
              )}
              {provider === 'kimi' && (
                <>
                  <option value="kimi-1">Kimi-1</option>
                  <option value="kimi-2">Kimi-2</option>
                </>
              )}
              {provider === 'qwen' && (
                <>
                  <option value="qwen-2.5">Qwen-2.5</option>
                  <option value="qwen-2">Qwen-2</option>
                  <option value="qwen-1.5">Qwen-1.5</option>
                </>
              )}
            </select>
          </div>
        </div>
        <div className="form-actions">
          <button
            className="btn-secondary"
            onClick={handleTestConnection}
            disabled={!isConfigValid() || testStatus === 'testing'}
          >
            {testStatus === 'testing' ? '测试中...' : '测试连接'}
          </button>
          <button
            className="btn-primary"
            onClick={handleSaveConfig}
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

  const renderProviderManagement = () => (
    <div className="content-panel">
      <div className="panel-header">
        <h2 className="panel-title">服务商管理</h2>
        <p className="panel-description">管理系统支持的服务商</p>
      </div>
      <div className="provider-grid">
        {[
          { id: 'deepseek', name: 'DeepSeek', models: 3, status: 'active' },
          { id: 'glm', name: 'GLM', models: 3, status: 'active' },
          { id: 'minimax', name: 'MiniMax', models: 2, status: 'active' },
          { id: 'kimi', name: 'Kimi', models: 2, status: 'active' },
          { id: 'qwen', name: 'Qwen', models: 3, status: 'active' },
        ].map((provider) => (
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

  const renderModelList = () => (
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
            {[
              { provider: 'DeepSeek', name: 'DeepSeek Chat', id: 'deepseek-chat', status: 'active' },
              { provider: 'DeepSeek', name: 'DeepSeek Coder', id: 'deepseek-coder', status: 'active' },
              { provider: 'GLM', name: 'GLM-4', id: 'glm-4', status: 'active' },
              { provider: 'GLM', name: 'GLM-4V', id: 'glm-4v', status: 'active' },
              { provider: 'MiniMax', name: 'ABAB-6', id: 'abab-6', status: 'active' },
              { provider: 'Kimi', name: 'Kimi-2', id: 'kimi-2', status: 'active' },
              { provider: 'Qwen', name: 'Qwen-2.5', id: 'qwen-2.5', status: 'active' },
            ].map((model, index) => (
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

  const renderPromptModule = (module: PromptModule) => {
    const moduleInfo: Record<PromptModule, { title: string; description: string; placeholder: string }> = {
      perception: {
        title: '问题感知模块',
        description: '定义 AI 如何感知和理解用户提出的问题',
        placeholder: '例如：你是一位专业的问题分析专家，负责深入理解用户提出的每一个问题...',
      },
      retrieval: {
        title: '知识检索模块',
        description: '定义 AI 如何从知识库中检索相关信息',
        placeholder: '例如：你是一位知识检索专家，擅长从海量信息中找到最相关的知识...',
      },
      generation: {
        title: '创意生成模块',
        description: '定义 AI 如何生成创新性的想法和方案',
        placeholder: '例如：你是一位创新思维专家，擅长打破常规思维，产生独特的创意...',
      },
      evaluation: {
        title: '评估反馈模块',
        description: '定义 AI 如何评估创意并提供反馈',
        placeholder: '例如：你是一位专业的创新评估专家，负责评估创业项目的创新能力和潜力...',
      },
    };

    const info = moduleInfo[module];

    return (
      <div className="content-panel">
        <div className="panel-header">
          <h2 className="panel-title">{info.title}</h2>
          <p className="panel-description">{info.description}</p>
        </div>
        <div className="form-card">
          <div className="form-group">
            <label className="form-label">
              提示词内容
              <span className="label-required">*</span>
            </label>
            <textarea
              value={prompts[module]}
              onChange={(e) => handlePromptChange(module, e.target.value)}
              placeholder={info.placeholder}
              rows={10}
              className="form-textarea"
            />
            <p className="form-hint">提示词将影响 AI 的响应风格和专业程度，建议根据具体业务场景进行定制</p>
          </div>
          <div className="form-actions">
            <button className="btn-primary" onClick={() => handleSavePrompt(module)}>
              保存提示词
            </button>
            <button className="btn-secondary" onClick={() => handlePromptChange(module, '')}>
              重置
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderSecuritySection = (itemKey: string) => {
    const content: Record<string, { title: string; description: string; icon: React.ReactNode }> = {
      'access-log': {
        title: '访问日志',
        description: '查看所有 API 访问记录',
        icon: (
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        ),
      },
      'api-monitor': {
        title: 'API 监控',
        description: '实时监控 API 调用情况',
        icon: (
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
          </svg>
        ),
      },
      'rate-limit': {
        title: '限流配置',
        description: '配置 API 调用频率限制',
        icon: (
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        ),
      },
    };

    const info = content[itemKey] || content['access-log'];

    return (
      <div className="content-panel">
        <div className="panel-header">
          <h2 className="panel-title">{info.title}</h2>
          <p className="panel-description">{info.description}</p>
        </div>
        <div className="coming-soon">
          <div className="coming-soon-icon">{info.icon}</div>
          <h3>功能开发中</h3>
          <p>该功能正在紧张开发中，敬请期待...</p>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    if (activeSection === 'model') {
      switch (activePromptModule) {
        case 'config': return renderModelConfig();
        case 'provider': return renderProviderManagement();
        case 'model-list': return renderModelList();
        default: return renderModelConfig();
      }
    }

    if (activeSection === 'prompt') {
      return renderPromptModule(activePromptModule);
    }

    if (activeSection === 'security') {
      return renderSecuritySection(activePromptModule);
    }

    return renderModelConfig();
  };

  const [activeNavItem, setActiveNavItem] = useState<string>('config');
  const [showDropdown, setShowDropdown] = useState(false);
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const languageDropdownRef = React.useRef<HTMLDivElement>(null);

  // 点击外部关闭下拉菜单
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
      if (languageDropdownRef.current && !languageDropdownRef.current.contains(event.target as Node)) {
        setShowLanguageDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 模拟登出
  const handleLogout = () => {
    setShowDropdown(false);
    // 实际项目中这里应该清除登录状态
  };

  const handleNavItemClick = (section: NavSection, itemKey: string) => {
    setActiveSection(section);
    setActiveNavItem(itemKey);
    if (section === 'prompt' || section === 'security') {
      setActivePromptModule(itemKey as PromptModule);
    }
  };

  return (
    <div className="admin-layout">
      <header className="global-nav">
        <div className="global-nav-content">
          <div className="nav-left">
            <div className="brand-section">
              <Link to="/" className="brand-logo">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" fill="currentColor"/>
                  <path d="M2 17l10 5 10-5" stroke="currentColor" strokeWidth="2"/>
                  <path d="M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2"/>
                </svg>
                <span>IAC Incubator</span>
              </Link>
            </div>
            
            <nav className="main-nav">
              <ul className="nav-links">
                <li><Link to="/assessment" className="nav-link">创新能力测评</Link></li>
                <li><Link to="/training" className="nav-link">创新能力训练</Link></li>
                <li><Link to="/incubation" className="nav-link">创新方案孵化</Link></li>
                <li><Link to="/" className="nav-link">案例中心</Link></li>
                <li><Link to="/" className="nav-link">开发文档</Link></li>
              </ul>
            </nav>
          </div>
          
          <div className="user-section">
            <div className="language-switcher" ref={languageDropdownRef}>
              <button 
                className="language-btn"
                onMouseEnter={() => setShowLanguageDropdown(true)}
                title="语言"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="2" y1="12" x2="22" y2="12"></line>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
              </button>
              
              {showLanguageDropdown && (
                <div 
                  className="language-dropdown"
                  onMouseEnter={() => setShowLanguageDropdown(true)}
                  onMouseLeave={() => setShowLanguageDropdown(false)}
                >
                  <button className="language-option">中文简体</button>
                  <button className="language-option">English</button>
                </div>
              )}
            </div>
            <div className="user-avatar" ref={dropdownRef}>
              <button 
                className="avatar-button" 
                onClick={() => setShowDropdown(!showDropdown)}
              >
                {userState.avatar ? (
                  <img 
                    src={userState.avatar} 
                    alt="用户头像" 
                    className="avatar-small-image"
                    onError={(e) => {
                      console.error('头像加载失败');
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="avatar-small">
                    {userState.name.charAt(0)}
                  </div>
                )}
              </button>
              
              {showDropdown && (
                <div className="dropdown-menu">
                  <div className="dropdown-header">
                    {userState.avatar ? (
                      <img 
                        src={userState.avatar} 
                        alt="用户头像" 
                        className="avatar-medium-image"
                        onError={(e) => {
                          console.error('头像加载失败');
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="avatar-medium">{userState.name.charAt(0)}</div>
                    )}
                    <div className="user-info">
                      <div className="user-name">{userState.name}</div>
                      <div className="user-email">{userState.email}</div>
                    </div>
                  </div>
                  
                  <div className="dropdown-divider"></div>
                  
                  <a 
                    href="/profile" 
                    className="dropdown-item"
                    onClick={() => setShowDropdown(false)}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="6" r="3" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.5"/>
                    </svg>
                    <span>个人中心</span>
                  </a>
                  
                  <a 
                    href="/admin" 
                    className="dropdown-item"
                    onClick={() => setShowDropdown(false)}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M2 6h12M6 2v12" stroke="currentColor" strokeWidth="1.5"/>
                    </svg>
                    <span>后台管理</span>
                  </a>
                  
                  <div className="dropdown-divider"></div>
                  
                  <button 
                    className="dropdown-item dropdown-item-logout"
                    onClick={handleLogout}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M6 2H3v12h3" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M10 7l3-3-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span>退出登录</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      
      <aside className="sidebar">
        <nav className="sidebar-nav">
          {navSections.map((section) => (
            <div key={section.key} className="nav-section">
              <h3 className="nav-section-title">{section.label}</h3>
              <ul className="nav-items">
                {section.items.map((item) => (
                  <li key={item.key}>
                    <button
                      className={`nav-item ${activeSection === section.key && activeNavItem === item.key ? 'active' : ''}`}
                      onClick={() => handleNavItemClick(section.key, item.key)}
                    >
                      <span className="nav-icon">{item.icon}</span>
                      <span className="nav-label">{item.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <main className="main-content">
        <header className="content-header">
          <div className="breadcrumb">
            <span className="current">
              {activeSection === 'model' && (activeNavItem === 'config' ? 'API Key 配置' : activeNavItem === 'provider' ? '服务商管理' : '模型列表')}
              {activeSection === 'prompt' && getModuleName(activePromptModule)}
              {activeSection === 'security' && (activeNavItem === 'access-log' ? '访问日志' : activeNavItem === 'api-monitor' ? 'API 监控' : '限流配置')}
            </span>
          </div>

        </header>

        <div className="content-body">
          {renderContent()}
        </div>
      </main>

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

        .brand-logo svg {
          color: #43e97b;
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
          padding: 6px 12px;
          background: #f3f4f6;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s ease;
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

        .language-switcher {
          position: relative;
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
          border: 1px solid #e5e7eb;
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
          background: #43e97b;
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
          background: #43e97b;
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

        .content-wrapper {
          display: flex;
          flex: 1;
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

        .sidebar-header {
          padding: 16px 20px;
          border-bottom: 1px solid #e5e7eb;
        }

        .logo {
          display: flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
          color: #374151;
          font-weight: 600;
          font-size: 16px;
        }

        .logo svg {
          color: #43e97b;
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

        .nav-section-title {
          padding: 8px 20px;
          font-size: 14px;
          font-weight: 600;
          line-height: 13px;
          letter-spacing: 1px;
          color: rgb(134, 134, 139);
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
          padding: 10px 16px;
          background: none;
          border: none;
          cursor: pointer;
          color: #6b7280;
          font-size: 14px;
          text-align: left;
          transition: all 0.2s ease;
          border-radius: 3px;
          margin: 0 auto;
          width: calc(100% - 16px);
          max-width: 180px;
        }

        .nav-item:hover {
          background: #f3f4f6;
          color: #374151;
        }

        .nav-item.active {
          background: #f0fdf4;
          color: #15803d;
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

        .sidebar-footer {
          padding: 16px 20px;
          border-top: 1px solid var(--border-light);
        }

        .user-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .user-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: var(--border-light);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
        }

        .user-details {
          display: flex;
          flex-direction: column;
        }

        .user-name {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-primary);
        }

        .user-role {
          font-size: 12px;
          color: var(--text-secondary);
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
          background: white;
          border-bottom: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: sticky;
          top: 60px;
          z-index: 50;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
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

        .header-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .btn-icon {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          border: none;
          background: var(--border-light);
          color: var(--text-secondary);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }

        .btn-icon:hover {
          background: var(--border);
          color: var(--text-primary);
        }

        .content-body {
          flex: 1;
          padding: 20px;
          overflow-y: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }

        .content-body::-webkit-scrollbar {
          display: none;
        }

        .content-panel {
          max-width: 1000px;
        }

        .panel-header {
          margin-bottom: 20px;
        }

        .panel-title {
          font-size: 16px;
          font-weight: 600;
          color: #374151;
          margin-bottom: 8px;
          width: 1000px;
          height: 22px;
          line-height: 22px;
          padding: 0px;
          border-radius: 0px;
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
          border-color: #43e97b;
        }

        .form-textarea {
          resize: vertical;
          min-height: 150px;
          font-family: inherit;
          height: 320px;
          width: 950px;
          border-radius: 8px;
          color: #1D1D1F;
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
          padding: 12px 24px;
          background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 2px 8px rgba(67, 233, 123, 0.3);
        }

        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(67, 233, 123, 0.4);
        }

        .btn-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        .btn-secondary {
          padding: 12px 24px;
          background: var(--bg-primary);
          color: var(--text-primary);
          border: 1px solid var(--border);
          border-radius: 8px;
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
          background: rgba(67, 233, 123, 0.1);
          border: 1px solid rgba(67, 233, 123, 0.3);
          color: #27ae60;
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
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 16px;
        }

        .provider-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: 12px;
          padding: 20px;
          transition: all 0.3s ease;
        }

        .provider-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
        }

        .provider-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }

        .provider-icon {
          width: 40px;
          height: 40px;
          border-radius: 8px;
          background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
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
          background: rgba(67, 233, 123, 0.1);
          color: #27ae60;
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
          margin-bottom: 16px;
        }

        .provider-actions {
          display: flex;
          gap: 8px;
        }

        .btn-small {
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 500;
          border-radius: 6px;
          border: none;
          cursor: pointer;
          transition: all 0.2s ease;
          background: var(--border-light);
          color: var(--text-primary);
        }

        .btn-small:hover {
          background: var(--border);
        }

        .btn-small.btn-outline {
          background: transparent;
          border: 1px solid var(--border);
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
    </div>
  );
};

export default Admin;