import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import llmService from '../services/llmService';

const BasicAssessment: React.FC = () => {
  const [config, setConfig] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    // 获取AI配置信息
    const savedConfig = localStorage.getItem('aiConfig');
    if (savedConfig) {
      const parsedConfig = JSON.parse(savedConfig);
      setConfig(parsedConfig);
      
      // 自动触发测试
      handleTest(parsedConfig);
    } else {
      setError('未找到AI配置信息，请先在后台管理页面配置AI服务');
    }
  }, []);

  const handleTest = async (configData: any) => {
    if (!configData) {
      setError('配置信息不完整');
      return;
    }

    setIsTesting(true);
    setTestResult('');
    setError('');

    try {
      // 使用固定的评估提示词
      const testInput = '请进行创新能力基础评估';
      
      const result = await llmService.callLLM(configData, testInput);
      
      if (result.error) {
        setError(`评估失败: ${result.error}`);
      } else {
        setTestResult(result.content);
      }
    } catch (error) {
      setError(`评估失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="basic-assessment-container">
      {/* 导航栏 */}
      <nav className="nav">
        <div className="nav-content">
          <Link to="/assessment" className="nav-back">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span>返回测评</span>
          </Link>
          <h1 className="nav-title">基础评估</h1>
          <div style={{ width: '80px' }}></div>
        </div>
      </nav>

      {/* 主内容 */}
      <main className="main">
        <div className="main-content">
          {/* Hero 区域 */}
          <section className="hero">
            <div className="hero-badge">AI 驱动</div>
            <h2 className="hero-title">创新能力基础评估</h2>
            <p className="hero-description">
              基于AI智能分析，全面评估您的创新思维基础能力
            </p>
          </section>

          {/* 配置信息卡片 */}
          {config && (
            <section className="config-section">
              <div className="config-card">
                <div className="config-header">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  <h3 className="config-title">当前AI配置</h3>
                </div>
                
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
              </div>
            </section>
          )}

          {/* 错误提示 */}
          {error && (
            <section className="error-section">
              <div className="error-card">
                <div className="error-header">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                    <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  <h3 className="error-title">错误提示</h3>
                </div>
                <p className="error-message">{error}</p>
                <Link to="/admin" className="btn-primary">
                  前往配置页面
                </Link>
              </div>
            </section>
          )}

          {/* 加载状态 */}
          {isTesting && (
            <section className="loading-section">
              <div className="loading-card">
                <div className="loading-spinner">
                  <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                    <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="none" strokeDasharray="100" strokeLinecap="round"/>
                  </svg>
                </div>
                <h3 className="loading-title">正在评估中...</h3>
                <p className="loading-message">AI正在分析您的创新能力，请稍候</p>
              </div>
            </section>
          )}

          {/* 评估结果 */}
          {testResult && !isTesting && (
            <section className="result-section">
              <div className="result-card">
                <div className="result-header">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                  <h3 className="result-title">评估结果</h3>
                </div>
                <div className="result-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{testResult}</ReactMarkdown>
                </div>
                <div className="result-footer">
                  <p className="result-time">评估时间：{new Date().toLocaleString('zh-CN')}</p>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>

      {/* 页脚 */}
      <footer className="footer">
        <div className="footer-content">
          <p className="footer-text">© 2024 IAC Incubator. 保留所有权利。</p>
        </div>
      </footer>

      <style>{`
        .basic-assessment-container {
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
          border-radius: 3px;
          transition: background var(--transition-fast);
        }

        .nav-back:hover {
          background: rgba(36, 144, 248, 0.1);
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
          background: rgba(36, 144, 248, 0.1);
          color: #2490f8;
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

        /* 错误卡片 */
        .error-section {
          margin-bottom: var(--spacing-xl);
        }

        .error-card {
          background: var(--bg-primary);
          padding: var(--spacing-2xl);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
          border: 1px solid var(--accent-pink);
          text-align: center;
        }

        .error-header {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--spacing-md);
          margin-bottom: var(--spacing-lg);
          color: var(--accent-pink);
        }

        .error-title {
          font-size: 21px;
          font-weight: 600;
          margin: 0;
        }

        .error-message {
          font-size: 15px;
          color: var(--text-secondary);
          margin-bottom: var(--spacing-xl);
        }

        /* 加载状态 */
        .loading-section {
          margin-bottom: var(--spacing-xl);
        }

        .loading-card {
          background: var(--bg-primary);
          padding: var(--spacing-4xl);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
          border: 1px solid var(--border-light);
          text-align: center;
        }

        .loading-spinner {
          margin-bottom: var(--spacing-xl);
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .loading-title {
          font-size: 21px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-sm);
        }

        .loading-message {
          font-size: 15px;
          color: var(--text-secondary);
        }

        /* 结果卡片 */
        .result-section {
          margin-bottom: var(--spacing-xl);
        }

        .result-card {
          background: var(--bg-primary);
          padding: var(--spacing-2xl);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
          border: 1px solid var(--border-light);
          border-left: 4px solid var(--accent-green);
        }

        .result-header {
          display: flex;
          align-items: center;
          gap: var(--spacing-md);
          margin-bottom: var(--spacing-xl);
          color: var(--accent-green);
        }

        .result-title {
          font-size: 21px;
          font-weight: 600;
          margin: 0;
        }

        .result-content {
          background: var(--bg-secondary);
          padding: var(--spacing-lg);
          border-radius: var(--radius-sm);
          overflow-x: auto;
          margin-bottom: var(--spacing-lg);
        }

        .result-content h1,
        .result-content h2,
        .result-content h3,
        .result-content h4,
        .result-content h5,
        .result-content h6 {
          color: var(--text-primary);
          margin-top: var(--spacing-lg);
          margin-bottom: var(--spacing-md);
        }

        .result-content h1 { font-size: 28px; font-weight: 600; }
        .result-content h2 { font-size: 24px; font-weight: 600; }
        .result-content h3 { font-size: 20px; font-weight: 600; }
        .result-content h4 { font-size: 18px; font-weight: 600; }

        .result-content p {
          font-size: 15px;
          line-height: 1.6;
          color: var(--text-primary);
          margin-bottom: var(--spacing-md);
        }

        .result-content ul,
        .result-content ol {
          margin-left: var(--spacing-xl);
          margin-bottom: var(--spacing-md);
        }

        .result-content li {
          font-size: 15px;
          line-height: 1.6;
          color: var(--text-primary);
          margin-bottom: var(--spacing-xs);
        }

        .result-content code {
          background: var(--bg-primary);
          padding: 2px 6px;
          border-radius: var(--radius-sm);
          font-family: var(--font-mono);
          font-size: 14px;
        }

        .result-content pre {
          background: var(--bg-primary);
          padding: var(--spacing-md);
          border-radius: var(--radius-sm);
          overflow-x: auto;
          margin-bottom: var(--spacing-md);
        }

        .result-content pre code {
          background: none;
          padding: 0;
        }

        .result-content blockquote {
          border-left: 4px solid var(--accent-blue);
          padding-left: var(--spacing-md);
          margin: var(--spacing-md) 0;
          color: var(--text-secondary);
        }

        .result-content table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: var(--spacing-md);
        }

        .result-content th,
        .result-content td {
          border: 1px solid var(--border);
          padding: var(--spacing-sm) var(--spacing-md);
          text-align: left;
        }

        .result-content th {
          background: var(--bg-primary);
          font-weight: 600;
        }

        .result-content a {
          color: var(--accent-blue);
          text-decoration: none;
        }

        .result-content a:hover {
          text-decoration: underline;
        }

        .result-content hr {
          border: none;
          border-top: 1px solid var(--border);
          margin: var(--spacing-lg) 0;
        }

        .result-footer {
          padding-top: var(--spacing-md);
          border-top: 1px solid var(--border-light);
        }

        .result-time {
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0;
        }

        /* 按钮 */
        .btn-primary {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: var(--spacing-sm);
          padding: 12px 24px;
          background: var(--accent-blue);
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          font-size: 15px;
          font-weight: 500;
          cursor: pointer;
          transition: all var(--transition-base);
          text-decoration: none;
        }

        .btn-primary:hover {
          background: var(--accent-blue-hover);
          transform: scale(1.01);
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

          .config-card,
          .error-card,
          .loading-card,
          .result-card {
            padding: var(--spacing-lg);
          }
        }

        /* 暗色主题适配 */
        @media (prefers-color-scheme: dark) {
          .nav {
            background: rgba(29, 29, 31, 0.8);
          }

          .config-card,
          .error-card,
          .loading-card,
          .result-card {
            background: var(--bg-secondary);
            border-color: var(--border);
          }

          .config-item {
            background: var(--bg-primary);
          }

          .result-content {
            background: var(--bg-primary);
          }
        }
      `}</style>
    </div>
  );
};

export default BasicAssessment;
