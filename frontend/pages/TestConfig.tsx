import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import llmService from '../services/llmService';

const API_BASE_URL = 'http://localhost:3000';

const TestConfig: React.FC = () => {
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [configId, setConfigId] = useState<number | null>(null);
  const [lastTestTime, setLastTestTime] = useState<string | null>(null);
  const [lastTestInput, setLastTestInput] = useState<string | null>(null);
  const [lastTestResult, setLastTestResult] = useState<string | null>(null);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/ai-config`);
      if (response.ok) {
        const configs = await response.json();
        if (configs.length > 0) {
          const configData = configs[0];
          setConfigId(configData.id);
          setApiKey(configData.apiKey || '');
          setProvider(configData.provider || '');
          setModel(configData.model || '');
          setPrompt(configData.prompt || '');
          setLastTestTime(configData.lastTestTime || null);
          setLastTestInput(configData.lastTestInput || null);
          setLastTestResult(configData.lastTestResult || null);
          localStorage.setItem('aiConfig', JSON.stringify(configData));
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

    setIsSaving(true);

    const configData = {
      apiKey: apiKey.trim(),
      provider,
      model,
      prompt: prompt.trim(),
      lastTestTime,
      lastTestInput,
      lastTestResult,
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
        setIsEditing(false);
        alert('配置保存成功');
      } else {
        alert('保存失败，请重试');
      }
    } catch (error) {
      localStorage.setItem('aiConfig', JSON.stringify(configData));
      setIsEditing(false);
      alert('配置已保存到本地');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoad = () => {
    fetchConfig();
    setIsEditing(false);
    alert('配置已加载');
  };

  const handleCancel = () => {
    fetchConfig();
    setIsEditing(false);
  };

  const handleTest = async () => {
    if (!testInput.trim()) {
      alert('请输入测试内容');
      return;
    }

    if (!apiKey || !provider || !model || !prompt) {
      alert('请先保存完整配置');
      return;
    }

    setIsTesting(true);
    setTestResult('');
    setTestSuccess(false);

    const configData = {
      apiKey: apiKey.trim(),
      provider,
      model,
      prompt: prompt.trim(),
    };

    try {
      const result = await llmService.callLLM(configData, testInput);

      if (result.error) {
        setTestResult(`测试失败: ${result.error}`);
        setTestSuccess(false);
      } else {
        const newTestTime = new Date().toISOString();
        const testResultText = `服务商：${provider}\n模型：${model}\n输入：${testInput}\n\n响应：${result.content}`;
        setTestResult(testResultText);
        setTestSuccess(true);

        setLastTestTime(newTestTime);
        setLastTestInput(testInput);
        setLastTestResult(result.content);

        const successConfig = {
          ...configData,
          lastTestTime: newTestTime,
          lastTestInput: testInput,
          lastTestResult: result.content,
        };

        try {
          await fetch(`${API_BASE_URL}/ai-config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(successConfig),
          });
        } catch (apiError) {
          console.error('保存测试结果失败:', apiError);
        }

        localStorage.setItem('aiConfig', JSON.stringify(successConfig));
      }
    } catch (error) {
      setTestResult(`测试失败: ${error instanceof Error ? error.message : '未知错误'}`);
      setTestSuccess(false);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="test-config-container">
      <nav className="nav">
        <div className="nav-content">
          <Link to="/admin" className="nav-back">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span>返回配置</span>
          </Link>
          <h1 className="nav-title">测试配置</h1>
          <div style={{ width: '80px' }}></div>
        </div>
      </nav>

      <main className="main">
        <div className="main-content">
          <section className="hero">
            <div className="hero-badge">AI 测试</div>
            <h2 className="hero-title">验证您的 AI 配置</h2>
            <p className="hero-description">
              在实际使用前，测试您的 AI 服务配置是否正常工作
            </p>
          </section>

          <section className="config-section">
            <div className="config-card">
              <div className="config-header">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                  <path d="M12 1V3M12 21V23M4.22 4.22L5.64 5.64M18.36 18.36L19.78 19.78M1 12H3M21 12H23M4.22 19.78L5.64 18.36M18.36 5.64L19.78 4.22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <h3>当前配置</h3>
                {!isEditing && (
                  <button className="btn-edit" onClick={() => setIsEditing(true)}>
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                      <path d="M14 2H6C4.89543 2 4 2.89543 4 4V16C4 17.1046 4.89543 18 6 18H14C15.1046 18 16 17.1046 16 16V4C16 2.89543 15.1046 2 14 2Z" stroke="currentColor" strokeWidth="2"/>
                      <path d="M8 6H12M8 10H12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    修改
                  </button>
                )}
              </div>

              {isEditing ? (
                <div className="config-form">
                  <div className="form-group">
                    <label className="form-label">API Key</label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="请输入 API Key"
                      className="form-input"
                    />
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">服务商</label>
                      <select
                        value={provider}
                        onChange={(e) => {
                          setProvider(e.target.value);
                          setModel('');
                        }}
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
                      <label className="form-label">模型</label>
                      <select
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

                  <div className="form-group">
                    <label className="form-label">系统提示词</label>
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="请输入系统提示词"
                      rows={4}
                      className="form-textarea"
                    />
                  </div>

                  <div className="form-actions">
                    <button className="btn-primary" onClick={handleSave} disabled={isSaving}>
                      {isSaving ? '保存中...' : '保存配置'}
                    </button>
                    <button className="btn-secondary" onClick={handleCancel}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="config-info">
                  <div className="config-item">
                    <span className="config-label">服务商</span>
                    <span className="config-value">{provider || '未设置'}</span>
                  </div>
                  <div className="config-item">
                    <span className="config-label">模型</span>
                    <span className="config-value">{model || '未设置'}</span>
                  </div>
                  {lastTestTime && (
                    <>
                      <div className="config-item">
                        <span className="config-label">上次测试时间</span>
                        <span className="config-value">{new Date(lastTestTime).toLocaleString()}</span>
                      </div>
                      <div className="config-item">
                        <span className="config-label">上次测试输入</span>
                        <span className="config-value">{lastTestInput}</span>
                      </div>
                      <div className="config-item">
                        <span className="config-label">上次测试响应</span>
                        <span className="config-value">{lastTestResult}</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="test-card">
              <h3>测试输入</h3>
              <textarea
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="输入您想测试的内容..."
                rows={4}
                className="test-textarea"
              />
              <button
                className="btn-primary test-btn"
                onClick={handleTest}
                disabled={isTesting}
              >
                {isTesting ? (
                  <>
                    <svg className="spinner" width="20" height="20" viewBox="0 0 20 20">
                      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="50" strokeLinecap="round"/>
                    </svg>
                    测试中...
                  </>
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <path d="M10 2L12 6L16 6.5L13 9.5L14 14L10 11.5L6 14L7 9.5L4 6.5L8 6L10 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
                    </svg>
                    开始测试
                  </>
                )}
              </button>
            </div>

            {testResult && (
              <div className={`result-card ${testSuccess ? 'success' : 'error'}`}>
                <h3>测试结果</h3>
                <pre className="result-content">{testResult}</pre>
              </div>
            )}
          </section>
        </div>
      </main>

      <style>{`
        .test-config-container {
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

        .hero-badge {
          display: inline-block;
          padding: 6px 16px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border-radius: var(--radius-full);
          font-size: 13px;
          font-weight: 500;
          margin-bottom: var(--spacing-md);
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

        .config-section {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-xl);
        }

        .config-card {
          background: var(--bg-primary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          padding: var(--spacing-xl);
          box-shadow: var(--shadow-sm);
        }

        .config-header {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
          margin-bottom: var(--spacing-lg);
          color: var(--text-primary);
        }

        .config-header h3 {
          font-size: 18px;
          font-weight: 600;
          flex: 1;
        }

        .btn-edit {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          background: var(--bg-secondary);
          color: var(--text-primary);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          font-size: 14px;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .btn-edit:hover {
          background: var(--bg-tertiary);
        }

        .config-form {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-md);
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .form-label {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-primary);
        }

        .form-input,
        .form-select,
        .form-textarea {
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
          min-height: 100px;
        }

        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--spacing-md);
        }

        @media (max-width: 640px) {
          .form-row {
            grid-template-columns: 1fr;
          }
        }

        .form-actions {
          display: flex;
          gap: var(--spacing-md);
          margin-top: var(--spacing-md);
        }

        .btn-primary,
        .btn-secondary {
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

        .config-info {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-md);
        }

        .config-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .config-label {
          font-size: 13px;
          color: var(--text-tertiary);
          font-weight: 500;
        }

        .config-value {
          font-size: 15px;
          color: var(--text-primary);
          word-break: break-all;
        }

        .test-card {
          background: var(--bg-primary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          padding: var(--spacing-xl);
          box-shadow: var(--shadow-sm);
        }

        .test-card h3 {
          font-size: 18px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-md);
        }

        .test-textarea {
          width: 100%;
          padding: 12px 16px;
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          font-size: 15px;
          color: var(--text-primary);
          background: var(--bg-primary);
          resize: vertical;
          min-height: 100px;
          margin-bottom: var(--spacing-md);
          transition: all var(--transition-fast);
        }

        .test-textarea:focus {
          outline: none;
          border-color: var(--accent-blue);
          box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.1);
        }

        .test-btn {
          width: 100%;
        }

        .result-card {
          background: var(--bg-primary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          padding: var(--spacing-xl);
          box-shadow: var(--shadow-sm);
        }

        .result-card.success {
          border-color: var(--accent-green);
        }

        .result-card.error {
          border-color: var(--accent-pink);
        }

        .result-card h3 {
          font-size: 18px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-md);
        }

        .result-content {
          font-size: 14px;
          color: var(--text-primary);
          white-space: pre-wrap;
          word-break: break-all;
          font-family: var(--font-mono);
          line-height: 1.6;
          margin: 0;
          max-height: 500px;
          overflow-y: auto;
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

export default TestConfig;