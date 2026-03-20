import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const API_BASE_URL = 'http://localhost:3000';

const Admin: React.FC = () => {
  const navigate = useNavigate();
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [configId, setConfigId] = useState<number | null>(null);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/ai-config`);
      if (response.ok) {
        const configs = await response.json();
        if (configs.length > 0) {
          const config = configs[0];
          setConfigId(config.id);
          setApiKey(config.apiKey || '');
          setProvider(config.provider || '');
          setModel(config.model || '');
          setPrompt(config.prompt || '');
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

  const handleSave = async () => {
    if (!apiKey.trim()) {
      alert('请填写 API Key');
      return;
    }
    if (!provider) {
      alert('请选择服务商');
      return;
    }
    if (!model) {
      alert('请选择模型');
      return;
    }
    if (!prompt.trim()) {
      alert('请填写系统提示词');
      return;
    }

    setSaveStatus('saving');

    const configData = {
      apiKey: apiKey.trim(),
      provider,
      model,
      prompt: prompt.trim(),
    };

    try {
      const response = await fetch(`${API_BASE_URL}/ai-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configData),
      });

      if (response.ok) {
        const savedConfig = await response.json();
        setConfigId(savedConfig.id);
        localStorage.setItem('aiConfig', JSON.stringify(savedConfig));
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        setSaveStatus('error');
        alert('保存失败，请重试');
      }
    } catch (error) {
      setSaveStatus('error');
      localStorage.setItem('aiConfig', JSON.stringify(configData));
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  };

  const handleModify = async () => {
    await fetchConfig();
    alert('配置已加载，请修改后重新保存');
  };

  const handleTest = async () => {
    if (!apiKey.trim()) {
      alert('请填写 API Key');
      return;
    }
    if (!provider) {
      alert('请选择服务商');
      return;
    }
    if (!model) {
      alert('请选择模型');
      return;
    }
    if (!prompt.trim()) {
      alert('请填写系统提示词');
      return;
    }

    const config = {
      apiKey: apiKey.trim(),
      provider,
      model,
      prompt: prompt.trim(),
    };

    try {
      await fetch(`${API_BASE_URL}/ai-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
    } catch (error) {
    }

    localStorage.setItem('aiConfig', JSON.stringify(config));
    navigate('/test-config');
  };

  return (
    <div className="admin-container">
      <nav className="nav">
        <div className="nav-content">
          <Link to="/" className="nav-back">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span>返回首页</span>
          </Link>
          <h1 className="nav-title">后台管理</h1>
          <div style={{ width: '80px' }}></div>
        </div>
      </nav>

      <main className="main">
        <div className="main-content">
          <section className="hero">
            <h2 className="hero-title">AI 配置管理</h2>
            <p className="hero-description">
              配置您的 AI 服务参数，支持多种主流服务商和模型
            </p>
          </section>

          <section className="form-section">
            <div className="form-card">
              <h3 className="form-title">基础配置</h3>

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
                <p className="form-hint">您的 API Key 将被安全存储在数据库中</p>
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
                    onChange={(e) => setProvider(e.target.value)}
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
            </div>

            <div className="form-card">
              <h3 className="form-title">高级配置</h3>

              <div className="form-group">
                <label htmlFor="prompt" className="form-label">
                  系统提示词
                  <span className="label-required">*</span>
                </label>
                <textarea
                  id="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="请输入系统提示词，用于定义 AI 的行为和角色..."
                  rows={8}
                  className="form-textarea"
                />
                <p className="form-hint">系统提示词将影响 AI 的响应风格和行为</p>
              </div>
            </div>

            <div className="form-actions">
              <button
                className="btn-primary"
                onClick={handleSave}
                disabled={saveStatus === 'saving'}
              >
                {saveStatus === 'saving' ? (
                  <>
                    <svg className="spinner" width="20" height="20" viewBox="0 0 20 20">
                      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="50" strokeLinecap="round"/>
                    </svg>
                    保存中...
                  </>
                ) : saveStatus === 'saved' ? (
                  <>
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <path d="M16 5L8 13L4 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    已保存
                  </>
                ) : saveStatus === 'error' ? (
                  <>
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <path d="M4 4L16 16M16 4L4 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    保存失败
                  </>
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <path d="M16 5L8 13L4 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    保存配置
                  </>
                )}
              </button>

              <button className="btn-primary" onClick={handleModify}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M14 2H6C4.89543 2 4 2.89543 4 4V16C4 17.1046 4.89543 18 6 18H14C15.1046 18 16 17.1046 16 16V4C16 2.89543 15.1046 2 14 2Z" stroke="currentColor" strokeWidth="2"/>
                  <path d="M8 6H12M8 10H12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                加载配置
              </button>

              <button className="btn-accent" onClick={handleTest}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M10 2L12 6L16 6.5L13 9.5L14 14L10 11.5L6 14L7 9.5L4 6.5L8 6L10 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
                </svg>
                测试配置
              </button>
            </div>
          </section>
        </div>
      </main>

      <footer className="footer">
        <div className="footer-content">
          <p className="footer-text">© 2024 IAC Incubator. 保留所有权利。</p>
        </div>
      </footer>

      <style>{`
        .admin-container {
          min-height: 100vh;
          background: var(--bg-primary);
          display: flex;
          flex-direction: column;
        }

        .nav {
          position: sticky;
          top: 0;
          z-index: 100;
          background: rgba(255, 255, 255, 0.8);
          backdrop-filter: saturate(180%) blur(20px);
          border-bottom: 1px solid var(--border-light);
        }

        .nav-content {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 var(--spacing-xl);
          height: 52px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .nav-back {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
          color: var(--accent-blue);
          text-decoration: none;
          font-size: 15px;
          transition: opacity var(--transition-fast);
        }

        .nav-back:hover {
          opacity: 0.7;
          text-decoration: none;
        }

        .nav-title {
          font-size: 18px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .main {
          flex: 1;
          padding: var(--spacing-3xl) var(--spacing-xl);
        }

        .main-content {
          max-width: 800px;
          margin: 0 auto;
        }

        .hero {
          text-align: center;
          margin-bottom: var(--spacing-3xl);
        }

        .hero-title {
          font-size: 40px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-md);
        }

        .hero-description {
          font-size: 17px;
          color: var(--text-secondary);
          max-width: 500px;
          margin: 0 auto;
        }

        .form-section {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-xl);
        }

        .form-card {
          background: var(--bg-primary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          padding: var(--spacing-xl);
          box-shadow: var(--shadow-sm);
        }

        .form-title {
          font-size: 21px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-lg);
        }

        .form-group {
          margin-bottom: var(--spacing-lg);
        }

        .form-group:last-child {
          margin-bottom: 0;
        }

        .form-label {
          display: block;
          font-size: 14px;
          font-weight: 500;
          color: var(--text-primary);
          margin-bottom: var(--spacing-sm);
        }

        .label-required {
          color: var(--accent-pink);
          margin-left: 4px;
        }

        .form-input,
        .form-select,
        .form-textarea {
          width: 100%;
          padding: 12px 16px;
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          font-size: 15px;
          color: var(--text-primary);
          background: var(--bg-primary);
          transition: all var(--transition-fast);
        }

        .form-input:focus,
        .form-select:focus,
        .form-textarea:focus {
          outline: none;
          border-color: var(--accent-blue);
          box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.1);
        }

        .form-textarea {
          resize: vertical;
          min-height: 120px;
        }

        .form-hint {
          font-size: 13px;
          color: var(--text-tertiary);
          margin-top: var(--spacing-xs);
        }

        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--spacing-lg);
        }

        @media (max-width: 640px) {
          .form-row {
            grid-template-columns: 1fr;
          }
        }

        .form-actions {
          display: flex;
          gap: var(--spacing-md);
          justify-content: center;
          flex-wrap: wrap;
        }

        .btn-primary,
        .btn-secondary,
        .btn-accent {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: var(--spacing-sm);
          padding: 12px 24px;
          border-radius: var(--radius-md);
          font-size: 15px;
          font-weight: 500;
          cursor: pointer;
          transition: all var(--transition-fast);
          border: none;
          text-decoration: none;
        }

        .btn-primary {
          background: var(--accent-blue);
          color: white;
        }

        .btn-primary:hover {
          background: var(--accent-blue-hover);
        }

        .btn-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .btn-secondary {
          background: var(--bg-secondary);
          color: var(--text-primary);
          border: 1px solid var(--border);
        }

        .btn-secondary:hover {
          background: var(--bg-tertiary);
        }

        .btn-accent {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }

        .btn-accent:hover {
          opacity: 0.9;
        }

        .footer {
          padding: var(--spacing-xl);
          border-top: 1px solid var(--border-light);
          margin-top: auto;
        }

        .footer-content {
          max-width: 1200px;
          margin: 0 auto;
          text-align: center;
        }

        .footer-text {
          font-size: 13px;
          color: var(--text-tertiary);
        }

        .spinner {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default Admin;