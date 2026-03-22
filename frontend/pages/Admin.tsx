import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const API_BASE_URL = 'http://localhost:3000';

type Step = 'config' | 'test' | 'save' | 'prompt';
type TestStatus = 'idle' | 'testing' | 'success' | 'error';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const Admin: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<Step>('config');
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testResult, setTestResult] = useState<{ message: string; responseTime?: number; error?: string } | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [isConnectionValid, setIsConnectionValid] = useState(false);
  const [configId, setConfigId] = useState<number | null>(null);

  const steps: { key: Step; label: string; number: number }[] = [
    { key: 'config', label: '配置参数', number: 1 },
    { key: 'test', label: '测试连接', number: 2 },
    { key: 'save', label: '保存配置', number: 3 },
    { key: 'prompt', label: '设置提示词', number: 4 },
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
            setCurrentStep('prompt');
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

  const handleNextStep = () => {
    const stepOrder: Step[] = ['config', 'test', 'save', 'prompt'];
    const currentIndex = stepOrder.indexOf(currentStep);
    if (currentIndex < stepOrder.length - 1) {
      setCurrentStep(stepOrder[currentIndex + 1]);
    }
  };

  const handlePrevStep = () => {
    const stepOrder: Step[] = ['config', 'test', 'save', 'prompt'];
    const currentIndex = stepOrder.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(stepOrder[currentIndex - 1]);
    }
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
        handleNextStep();
      } else {
        setSaveStatus('error');
        alert('保存失败，请重试');
      }
    } catch (error) {
      setSaveStatus('error');
      alert('保存失败：' + (error instanceof Error ? error.message : '未知错误'));
    }
  };

  const handleSavePrompt = async () => {
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

  const handleReset = () => {
    setCurrentStep('config');
    setIsConnectionValid(false);
    setTestStatus('idle');
    setTestResult(null);
  };

  const renderStepIndicator = () => (
    <div className="step-indicator">
      {steps.map((step, index) => {
        const isActive = step.key === currentStep;
        const isCompleted = steps.findIndex(s => s.key === currentStep) > index;
        return (
          <div key={step.key} className={`step-item ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}>
            <div className="step-circle">
              {isCompleted ? (
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                  <path d="M16 5L8 13L4 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              ) : (
                step.number
              )}
            </div>
            <span className="step-label">{step.label}</span>
            {index < steps.length - 1 && <div className="step-line" />}
          </div>
        );
      })}
    </div>
  );

  const renderConfigStep = () => (
    <div className="step-content">
      <div className="step-header">
        <h3>步骤 1：配置核心参数</h3>
        <p>请填写 AI 服务商的连接信息</p>
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
      </div>
      <div className="step-actions">
        <button
          className="btn-primary"
          onClick={handleNextStep}
          disabled={!isConfigValid()}
        >
          下一步：测试连接
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M7 4L13 10L7 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );

  const renderTestStep = () => (
    <div className="step-content">
      <div className="step-header">
        <h3>步骤 2：测试连接有效性</h3>
        <p>验证与大模型的连接是否正常</p>
      </div>
      <div className="form-card">
        <div className="config-summary">
          <div className="summary-item">
            <span className="summary-label">服务商</span>
            <span className="summary-value">{provider}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">模型</span>
            <span className="summary-value">{model}</span>
          </div>
        </div>
        <div className="test-area">
          {testStatus === 'idle' && (
            <div className="test-placeholder">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                <path d="M12 6V12L16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <p>点击下方按钮开始测试连接</p>
            </div>
          )}
          {testStatus === 'testing' && (
            <div className="test-loading">
              <svg className="spinner" width="48" height="48" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="50" strokeLinecap="round"/>
              </svg>
              <p>正在测试连接...</p>
            </div>
          )}
          {testStatus === 'success' && testResult && (
            <div className="test-result success">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                <path d="M8 12L11 15L16 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <div className="result-info">
                <h4>连接成功！</h4>
                <p>响应内容：{testResult.message}</p>
                {testResult.responseTime && <p className="response-time">响应时间：{testResult.responseTime}ms</p>}
              </div>
            </div>
          )}
          {testStatus === 'error' && testResult && (
            <div className="test-result error">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                <path d="M15 9L9 15M9 9L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <div className="result-info">
                <h4>连接失败</h4>
                <p>{testResult.error || '请检查配置信息是否正确'}</p>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="step-actions">
        <button className="btn-secondary" onClick={handlePrevStep}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          上一步
        </button>
        <button
          className="btn-primary"
          onClick={handleTestConnection}
          disabled={testStatus === 'testing'}
        >
          {testStatus === 'testing' ? '测试中...' : '测试连接'}
        </button>
        {testStatus === 'success' && (
          <button className="btn-primary" onClick={handleNextStep}>
            下一步：保存配置
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M7 4L13 10L7 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        )}
        {testStatus === 'error' && (
          <button className="btn-accent" onClick={handlePrevStep}>
            返回修改配置
          </button>
        )}
      </div>
    </div>
  );

  const renderSaveStep = () => (
    <div className="step-content">
      <div className="step-header">
        <h3>步骤 3：保存配置</h3>
        <p>连接测试成功后，保存配置信息到数据库</p>
      </div>
      <div className="form-card">
        <div className="save-confirm">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
            <path d="M9 12L11 14L15 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <h4>确认保存配置</h4>
          <div className="confirm-details">
            <p><strong>服务商：</strong>{provider}</p>
            <p><strong>模型：</strong>{model}</p>
          </div>
        </div>
      </div>
      <div className="step-actions">
        <button className="btn-secondary" onClick={handlePrevStep}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          上一步
        </button>
        <button
          className="btn-primary"
          onClick={handleSaveConfig}
          disabled={saveStatus === 'saving'}
        >
          {saveStatus === 'saving' ? '保存中...' : '保存配置'}
        </button>
      </div>
    </div>
  );

  const renderPromptStep = () => (
    <div className="step-content">
      <div className="step-header">
        <h3>步骤 4：设置系统提示词</h3>
        <p>定义 AI 的角色和行为，帮助其更好地完成创新评估任务</p>
      </div>
      <div className="form-card">
        <div className="form-group">
          <label htmlFor="prompt" className="form-label">
            系统提示词
            <span className="label-required">*</span>
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如：你是一位专业的创新评估专家，负责评估创业项目的创新能力和潜力..."
            rows={8}
            className="form-textarea"
          />
          <p className="form-hint">提示词将影响 AI 的响应风格和专业程度</p>
        </div>
      </div>
      <div className="step-actions">
        <button className="btn-secondary" onClick={handlePrevStep}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          上一步
        </button>
        <button
          className="btn-primary"
          onClick={handleSavePrompt}
          disabled={!prompt.trim() || saveStatus === 'saving'}
        >
          {saveStatus === 'saving' ? '保存中...' : '完成配置'}
        </button>
        <button className="btn-accent" onClick={handleReset}>
          重新配置
        </button>
      </div>
    </div>
  );

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 'config': return renderConfigStep();
      case 'test': return renderTestStep();
      case 'save': return renderSaveStep();
      case 'prompt': return renderPromptStep();
      default: return renderConfigStep();
    }
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
              配置并测试您的 AI 服务连接
            </p>
          </section>

          {renderStepIndicator()}

          <section className="form-section">
            {renderCurrentStep()}
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

        .step-indicator {
          display: flex;
          justify-content: center;
          align-items: center;
          margin-bottom: var(--spacing-3xl);
          padding: 0 var(--spacing-xl);
        }

        .step-item {
          display: flex;
          align-items: center;
          position: relative;
        }

        .step-circle {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: var(--bg-secondary);
          border: 2px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 600;
          color: var(--text-tertiary);
          transition: all var(--transition-fast);
        }

        .step-item.active .step-circle {
          background: var(--accent-blue);
          border-color: var(--accent-blue);
          color: white;
        }

        .step-item.completed .step-circle {
          background: #22c55e;
          border-color: #22c55e;
          color: white;
        }

        .step-label {
          margin-left: var(--spacing-sm);
          font-size: 14px;
          color: var(--text-tertiary);
          white-space: nowrap;
        }

        .step-item.active .step-label {
          color: var(--accent-blue);
          font-weight: 600;
        }

        .step-item.completed .step-label {
          color: #22c55e;
        }

        .step-line {
          width: 60px;
          height: 2px;
          background: var(--border);
          margin: 0 var(--spacing-md);
        }

        .step-item.completed + .step-item .step-line,
        .step-item.completed .step-line {
          background: #22c55e;
        }

        @media (max-width: 640px) {
          .step-label {
            display: none;
          }
          .step-line {
            width: 40px;
          }
        }

        .form-section {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-xl);
        }

        .step-content {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-xl);
        }

        .step-header {
          text-align: center;
        }

        .step-header h3 {
          font-size: 24px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-sm);
        }

        .step-header p {
          font-size: 15px;
          color: var(--text-secondary);
        }

        .form-card {
          background: var(--bg-primary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          padding: var(--spacing-xl);
          box-shadow: var(--shadow-sm);
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
          min-height: 150px;
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

        .step-actions {
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

        .config-summary {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--spacing-md);
          margin-bottom: var(--spacing-lg);
        }

        .summary-item {
          background: var(--bg-secondary);
          padding: var(--spacing-md);
          border-radius: var(--radius-md);
        }

        .summary-label {
          display: block;
          font-size: 12px;
          color: var(--text-tertiary);
          margin-bottom: var(--spacing-xs);
        }

        .summary-value {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .test-area {
          min-height: 200px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .test-placeholder,
        .test-loading {
          text-align: center;
          color: var(--text-tertiary);
        }

        .test-placeholder svg,
        .test-loading svg {
          margin-bottom: var(--spacing-md);
          opacity: 0.5;
        }

        .test-result {
          display: flex;
          align-items: flex-start;
          gap: var(--spacing-lg);
          padding: var(--spacing-lg);
          border-radius: var(--radius-md);
          width: 100%;
        }

        .test-result.success {
          background: rgba(34, 197, 94, 0.1);
          border: 1px solid rgba(34, 197, 94, 0.3);
          color: #166534;
        }

        .test-result.success > svg {
          color: #22c55e;
        }

        .test-result.error {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #991b1b;
        }

        .test-result.error > svg {
          color: #ef4444;
        }

        .result-info h4 {
          font-size: 18px;
          font-weight: 600;
          margin-bottom: var(--spacing-sm);
        }

        .result-info p {
          font-size: 14px;
          margin-bottom: var(--spacing-xs);
        }

        .response-time {
          font-size: 12px;
          opacity: 0.8;
        }

        .save-confirm {
          text-align: center;
          padding: var(--spacing-xl);
        }

        .save-confirm > svg {
          color: #22c55e;
          margin-bottom: var(--spacing-lg);
        }

        .save-confirm h4 {
          font-size: 20px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-lg);
        }

        .confirm-details {
          background: var(--bg-secondary);
          padding: var(--spacing-lg);
          border-radius: var(--radius-md);
          text-align: left;
        }

        .confirm-details p {
          margin-bottom: var(--spacing-sm);
          font-size: 14px;
          color: var(--text-secondary);
        }

        .confirm-details p:last-child {
          margin-bottom: 0;
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