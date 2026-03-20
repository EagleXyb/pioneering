import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import llmService from '../services/llmService';

const TestConfig: React.FC = () => {
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [config, setConfig] = useState<any>(null);
  const [testSuccess, setTestSuccess] = useState(false);

  useEffect(() => {
    const savedConfig = localStorage.getItem('aiConfig');
    if (savedConfig) {
      const parsedConfig = JSON.parse(savedConfig);
      setConfig(parsedConfig);
    }
  }, []);

  const handleTest = async () => {
    if (!testInput.trim()) {
      alert('请输入测试内容');
      return;
    }

    if (!config) {
      alert('请先在后台管理页面保存配置');
      return;
    }

    setIsTesting(true);
    setTestResult('');
    setTestSuccess(false);

    try {
      const result = await llmService.callLLM(config, testInput);
      
      if (result.error) {
        setTestResult(`测试失败: ${result.error}`);
        setTestSuccess(false);
      } else {
        // 测试成功，保存配置信息
        const testResultText = `服务商：${config.provider}\n模型：${config.model}\n输入：${testInput}\n\n响应：${result.content}`;
        setTestResult(testResultText);
        setTestSuccess(true);
        
        // 保存最后一次成功的测试配置
        const successConfig = {
          ...config,
          lastTestInput: testInput,
          lastTestResult: result.content,
          lastTestTime: new Date().toISOString()
        };
        localStorage.setItem('aiConfig', JSON.stringify(successConfig));
        
        // 更新当前配置状态
        setConfig(successConfig);
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
      {/* 导航栏 */}
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

      {/* 主内容 */}
      <main className="main">
        <div className="main-content">
          {/* Hero 区域 */}
          <section className="hero">
            <div className="hero-badge">AI 测试</div>
            <h2 className="hero-title">验证您的 AI 配置</h2>
            <p className="hero-description">
              在实际使用前，测试您的 AI 服务配置是否正常工作
            </p>
          </section>

          {/* 配置信息卡片 */}
          <section className="config-section">
            <div className="config-card">
              <div className="config-header">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <h3 className="config-title">当前配置信息</h3>
              </div>
              
              {config ? (
                <div className="config-grid">
                  <div className="config-item">
                    <div className="config-label">服务商</div>
                    <div className="config-value">{config.provider}</div>
                  </div>
                  <div className="config-item">
                    <div className="config-label">模型</div>
                    <div className="config-value">{config.model}</div>
                  </div>
                  <div className="config-item">
                    <div className="config-label">API Key</div>
                    <div className="config-value">{config.apiKey ? '***' + config.apiKey.slice(-4) : '未设置'}</div>
                  </div>
                </div>
              ) : (
                <div className="config-empty">
                  <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                    <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="2"/>
                    <path d="M24 14v12M24 30v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  <p>暂无保存的配置</p>
                  <Link to="/admin" className="link-primary">前往配置页面</Link>
                </div>
              )}
            </div>
          </section>

          {/* 测试区域 */}
          <section className="test-section">
            <div className="test-card">
              <h3 className="test-title">测试输入</h3>
              
              <div className="form-group">
                <label htmlFor="testInput" className="form-label">
                  输入测试内容
                </label>
                <textarea
                  id="testInput"
                  value={testInput}
                  onChange={(e) => setTestInput(e.target.value)}
                  placeholder="请输入要测试的内容，例如：请介绍一下创新能力..."
                  rows={4}
                  className="form-textarea"
                  disabled={!config || isTesting}
                />
              </div>

              <button 
                className={`btn-primary ${isTesting ? 'btn-loading' : ''}`}
                onClick={handleTest}
                disabled={isTesting || !config}
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

            {/* 测试结果 */}
            {testResult && (
              <div className={`result-card ${testSuccess ? 'result-success' : 'result-error'}`}>
                <div className="result-header">
                  {testSuccess ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                      <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  )}
                  <h3 className="result-title">
                    {testSuccess ? '测试成功' : '测试失败'}
                  </h3>
                </div>
                <div className="result-content">
                  <pre>{testResult}</pre>
                </div>
                {testSuccess && (
                  <div className="result-footer">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M13 3L6 10L3 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    <span>配置信息已自动保存</span>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* 页脚 */}
      <footer className="footer">
        <div className="footer-content">
          <p className="footer-text">© 2024 IAC Incubator. 保留所有权利。</p>
        </div>
      </footer>

      <style>{`
        .test-config-container {
          min-height: 100vh;
          background: var(--bg-primary);
          display: flex;
          flex-direction: column;
        }

        /* 导航栏 */
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
          gap: var(--spacing-xs);
          color: var(--accent-blue);
          text-decoration: none;
          font-size: 14px;
          padding: var(--spacing-sm) var(--spacing-md);
          border-radius: var(--radius-sm);
          transition: background var(--transition-fast);
        }

        .nav-back:hover {
          background: rgba(0, 113, 227, 0.1);
          text-decoration: none;
        }

        .nav-title {
          font-size: 17px;
          font-weight: 600;
          color: var(--text-primary);
        }

        /* 主内容 */
        .main {
          flex: 1;
          padding: var(--spacing-3xl) var(--spacing-xl);
          background: var(--gradient-hero);
        }

        .main-content {
          max-width: 980px;
          margin: 0 auto;
        }

        /* Hero */
        .hero {
          text-align: center;
          margin-bottom: var(--spacing-3xl);
        }

        .hero-badge {
          display: inline-block;
          padding: 6px 16px;
          background: rgba(102, 126, 234, 0.1);
          color: #667eea;
          border-radius: var(--radius-full);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.5px;
          margin-bottom: var(--spacing-md);
        }

        .hero-title {
          font-size: 40px;
          font-weight: 600;
          letter-spacing: -0.002em;
          line-height: 1.1;
          color: var(--text-primary);
          margin-bottom: var(--spacing-md);
        }

        .hero-description {
          font-size: 19px;
          line-height: 1.4211;
          color: var(--text-secondary);
        }

        /* 配置卡片 */
        .config-section {
          margin-bottom: var(--spacing-xl);
        }

        .config-card {
          background: var(--bg-primary);
          padding: var(--spacing-2xl);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
          border: 1px solid var(--border-light);
        }

        .config-header {
          display: flex;
          align-items: center;
          gap: var(--spacing-md);
          margin-bottom: var(--spacing-xl);
          color: var(--text-primary);
        }

        .config-title {
          font-size: 21px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .config-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: var(--spacing-xl);
        }

        .config-item {
          padding: var(--spacing-md);
          background: var(--bg-secondary);
          border-radius: var(--radius-sm);
        }

        .config-label {
          font-size: 13px;
          color: var(--text-secondary);
          margin-bottom: var(--spacing-xs);
        }

        .config-value {
          font-size: 17px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .config-empty {
          text-align: center;
          padding: var(--spacing-3xl);
          color: var(--text-secondary);
        }

        .config-empty svg {
          color: var(--border);
          margin-bottom: var(--spacing-md);
        }

        .config-empty p {
          margin-bottom: var(--spacing-md);
        }

        .link-primary {
          color: var(--accent-blue);
          text-decoration: none;
          font-weight: 500;
        }

        .link-primary:hover {
          text-decoration: underline;
        }

        /* 测试区域 */
        .test-section {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-xl);
        }

        .test-card, .result-card {
          background: var(--bg-primary);
          padding: var(--spacing-2xl);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
          border: 1px solid var(--border-light);
        }

        .test-title, .result-title {
          font-size: 21px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-xl);
        }

        .form-group {
          margin-bottom: var(--spacing-xl);
        }

        .form-label {
          display: block;
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-sm);
        }

        .form-textarea {
          width: 100%;
          padding: 12px 16px;
          background: var(--bg-primary);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          font-size: 15px;
          color: var(--text-primary);
          font-family: var(--font-sans);
          line-height: 1.46668;
          resize: vertical;
          transition: all var(--transition-fast);
        }

        .form-textarea:focus {
          outline: none;
          border-color: var(--accent-blue);
          box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.1);
        }

        .form-textarea:disabled {
          background: var(--bg-secondary);
          cursor: not-allowed;
        }

        /* 按钮 */
        .btn-primary {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: var(--spacing-sm);
          width: 100%;
          padding: 12px 24px;
          background: var(--accent-blue);
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          font-size: 15px;
          font-weight: 500;
          cursor: pointer;
          transition: all var(--transition-base);
        }

        .btn-primary:hover:not(:disabled) {
          background: var(--accent-blue-hover);
          transform: scale(1.01);
        }

        .btn-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .btn-loading {
          background: var(--text-secondary);
        }

        .spinner {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        /* 结果卡片 */
        .result-card {
          border-left: 4px solid var(--accent-green);
        }

        .result-success {
          border-left-color: var(--accent-green);
        }

        .result-error {
          border-left-color: var(--accent-pink);
        }

        .result-header {
          display: flex;
          align-items: center;
          gap: var(--spacing-md);
          margin-bottom: var(--spacing-lg);
          color: var(--accent-green);
        }

        .result-error .result-header {
          color: var(--accent-pink);
        }

        .result-title {
          margin: 0;
        }

        .result-content {
          background: var(--bg-secondary);
          padding: var(--spacing-lg);
          border-radius: var(--radius-sm);
          overflow-x: auto;
        }

        .result-content pre {
          margin: 0;
          font-family: var(--font-mono);
          font-size: 14px;
          line-height: 1.6;
          color: var(--text-primary);
          white-space: pre-wrap;
          word-wrap: break-word;
        }

        .result-footer {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          margin-top: var(--spacing-md);
          padding-top: var(--spacing-md);
          border-top: 1px solid var(--border-light);
          font-size: 13px;
          color: var(--text-secondary);
        }

        .result-footer svg {
          color: var(--accent-green);
        }

        /* 页脚 */
        .footer {
          padding: var(--spacing-xl);
          background: var(--bg-secondary);
          border-top: 1px solid var(--border-light);
        }

        .footer-content {
          max-width: 1200px;
          margin: 0 auto;
          text-align: center;
        }

        .footer-text {
          font-size: 12px;
          color: var(--text-secondary);
        }

        /* 响应式 */
        @media (max-width: 1024px) {
          .main {
            padding: var(--spacing-2xl) var(--spacing-lg);
          }

          .hero-title {
            font-size: 32px;
          }

          .config-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 768px) {
          .nav-content {
            padding: 0 var(--spacing-md);
          }

          .main {
            padding: var(--spacing-xl) var(--spacing-md);
          }

          .hero-title {
            font-size: 28px;
          }

          .hero-description {
            font-size: 17px;
          }

          .config-card, .test-card, .result-card {
            padding: var(--spacing-lg);
          }
        }

        /* 暗色主题适配 */
        @media (prefers-color-scheme: dark) {
          .nav {
            background: rgba(29, 29, 31, 0.8);
          }

          .config-card, .test-card, .result-card {
            background: var(--bg-secondary);
            border-color: var(--border);
          }

          .config-item {
            background: var(--bg-primary);
          }

          .form-textarea {
            background: var(--bg-primary);
            border-color: var(--border);
          }

          .result-content {
            background: var(--bg-primary);
          }
        }
      `}</style>
    </div>
  );
};

export default TestConfig;