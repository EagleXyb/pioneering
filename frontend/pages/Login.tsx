import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useUser();
  const [loginTab, setLoginTab] = useState('account');
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (error) setError('');
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await login(formData.username, formData.password);
      navigate('/');
    } catch (err: any) {
      setError(err.message || '登录失败，请检查用户名和密码');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      {/* 顶部Logo */}
      <div className="login-top-nav">
        <Link to="/" className="login-logo">
          <span className="logo-icon">💡</span>
          <span className="logo-text">IAC Incubator</span>
        </Link>
        <div className="login-nav-right">
          <button className="lang-button">简体中文 ▼</button>
        </div>
      </div>

      <div className="login-content">
        {/* 左侧品牌区域 */}
        <div className="login-left">
          <div className="brand-header">
            <h1 className="brand-title">
              ArkClaw <span className="brand-highlight">立即订阅</span>
            </h1>
            <p className="brand-subtitle">7*24小时在线的专属智能伙伴</p>
          </div>
          
          <div className="brand-mascot">
            <span className="mascot-emoji">🦀</span>
          </div>

          <div className="feature-grid">
            <div className="feature-card">
              <div className="feature-icon">🖥️</div>
              <h3>零门槛免运维</h3>
              <p>开箱即用免部署，7×24小时在线，50+技能，做80%工作生活学习一站搞定</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">👥</div>
              <h3>多位智能伙伴协同</h3>
              <p>支持多位智能伙伴共享Tokens能力，可联动Coding Plan共享额度</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🛡️</div>
              <h3>官方托管安全合规</h3>
              <p>环境隔离、无公网IP、NAT出网，大模型防火墙捕挡风险，AI安全体系开箱即用</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">✈️</div>
              <h3>飞书原生协同</h3>
              <p>飞书原生深度集成，无缝打通字节生态，免配置权限，一站式满足全场景办公</p>
            </div>
          </div>
        </div>

        {/* 右侧登录区域 */}
        <div className="login-right">
          <div className="login-card">
            <h2 className="card-title">欢迎来到 IAC Incubator</h2>

            {/* 登录选项卡 */}
            <div className="login-tabs">
              <button 
                className={`tab-button ${loginTab === 'account' ? 'active' : ''}`}
                onClick={() => setLoginTab('account')}
              >
                账号登录
              </button>
              <button 
                className={`tab-button ${loginTab === 'phone' ? 'active' : ''}`}
                onClick={() => setLoginTab('phone')}
              >
                手机号登录
              </button>
            </div>

            <form onSubmit={handleSubmit} className="login-form">
              {loginTab === 'account' ? (
                <>
                  <div className="form-group">
                    <input
                      type="text"
                      name="username"
                      value={formData.username}
                      onChange={handleChange}
                      placeholder="请输入账号/账号ID"
                    />
                  </div>

                  <div className="form-group password-group">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      value={formData.password}
                      onChange={handleChange}
                      placeholder="请输入登录密码"
                    />
                    <button 
                      type="button" 
                      className="toggle-password"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      )}
                    </button>
                  </div>

                  <div className="form-hint">
                    <span>登录即为您已阅读并同意Incubator</span>
                    <a href="#" className="hint-link">服务条款</a>
                    <span>和</span>
                    <a href="#" className="hint-link">隐私政策</a>
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <input
                      type="text"
                      placeholder="请输入手机号"
                    />
                  </div>
                  <div className="form-group code-group">
                    <input
                      type="text"
                      placeholder="请输入验证码"
                    />
                    <button type="button" className="get-code-btn">获取验证码</button>
                  </div>
                </>
              )}

              {error && <div className="login-error">{error}</div>}

              <button type="submit" className="submit-button" disabled={isLoading}>
                {isLoading ? '登录中...' : loginTab === 'account' ? '登录' : '登录 / 注册'}
              </button>
            </form>

            <div className="login-links">
              <a href="#" className="login-link">忘记账号</a>
              <span className="link-divider">|</span>
              <a href="#" className="login-link">忘记密码</a>
              <span className="link-divider">|</span>
              <a href="#" className="login-link">IAM子用户登录</a>
              <span className="link-divider">|</span>
              <a href="#" className="login-link">企业联邦登录</a>
            </div>

            <div className="divider">
              <span>其他登录方式</span>
            </div>

            <div className="social-buttons">
              <button type="button" className="social-button">
                <span className="social-icon">👤</span>
              </button>
              <button type="button" className="social-button">
                <span className="social-icon">🦋</span>
              </button>
            </div>

            <div className="register-prompt">
              <span>没有账号？</span>
              <Link to="#" className="register-link">现在就注册</Link>
            </div>
          </div>

          <div className="footer-text">
            <p>© 版权所有 北京火山引擎科技有限公司2026</p>
            <p className="footer-links">
              <a href="#">京公网安备 11010802032137号</a>
              <span>|</span>
              <a href="#">京ICP备20180137号-3</a>
              <span>|</span>
              <a href="#">增值电信业务经营许可证：</a>
              <a href="#">京ICP证02002419</a>
            </p>
          </div>
        </div>
      </div>

      <style>{`
        .login-container {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          background: linear-gradient(135deg, #f8f9ff 0%, #f0f4ff 35%, #e8f0ff 65%, #f5f8ff 100%);
          position: relative;
          overflow: hidden;
        }

        .login-container::before {
          content: '';
          position: absolute;
          top: -50%;
          left: -50%;
          width: 200%;
          height: 200%;
          background: 
            radial-gradient(circle at 20% 80%, rgba(36, 144, 248, 0.08) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(36, 144, 248, 0.06) 0%, transparent 50%),
            radial-gradient(circle at 40% 40%, rgba(100, 149, 237, 0.04) 0%, transparent 40%);
          animation: float 25s ease-in-out infinite;
          pointer-events: none;
        }

        .login-container::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%232490f8' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
          opacity: 0.6;
          pointer-events: none;
        }

        @keyframes float {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          25% { transform: translate(2%, 3%) rotate(1deg); }
          50% { transform: translate(-1%, 2%) rotate(0deg); }
          75% { transform: translate(3%, -2%) rotate(-1deg); }
        }

        /* 顶部导航 */
        .login-top-nav {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 24px 48px;
          position: relative;
          z-index: 1;
        }

        .login-logo {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
          text-decoration: none;
        }

        .logo-icon {
          font-size: 24px;
        }

        .logo-text {
          font-size: 21px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .login-nav-right {
          display: flex;
          align-items: center;
        }

        .lang-button {
          background: none;
          border: none;
          color: #64748b;
          font-size: 14px;
          cursor: pointer;
        }

        /* 主内容区域 */
        .login-content {
          flex: 1;
          display: flex;
          max-width: 1400px;
          width: 100%;
          margin: 0 auto;
          padding: 40px 48px;
          gap: 80px;
          position: relative;
          z-index: 1;
        }

        /* 左侧品牌区域 */
        .login-left {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding-top: 40px;
        }

        .brand-header {
          margin-bottom: 32px;
        }

        .brand-title {
          font-size: 40px;
          font-weight: 700;
          color: #1f2937;
          margin: 0 0 12px 0;
        }

        .brand-highlight {
          color: #ff6b35;
        }

        .brand-subtitle {
          font-size: 18px;
          color: #64748b;
          margin: 0;
        }

        .brand-mascot {
          display: flex;
          justify-content: center;
          margin: 24px 0;
        }

        .mascot-emoji {
          font-size: 80px;
        }

        .feature-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
          margin-top: 24px;
        }

        .feature-card {
          background: rgba(255, 255, 255, 0.8);
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 20px;
          backdrop-filter: blur(10px);
        }

        .feature-icon {
          font-size: 24px;
          margin-bottom: 12px;
        }

        .feature-card h3 {
          font-size: 16px;
          font-weight: 600;
          color: #1f2937;
          margin: 0 0 8px 0;
        }

        .feature-card p {
          font-size: 13px;
          color: #64748b;
          margin: 0;
          line-height: 1.6;
        }

        /* 右侧登录区域 */
        .login-right {
          width: 440px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .login-card {
          background: white;
          border-radius: 10px;
          padding: 40px 36px;
          width: 450px;
          max-width: 100%;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
        }

        .card-title {
          font-size: 22px;
          font-weight: 600;
          color: #1f2937;
          margin: 0 0 28px 0;
          text-align: left;
          letter-spacing: -0.02em;
        }

        /* 登录选项卡 */
        .login-tabs {
          display: flex;
          justify-content: flex-start;
          gap: 40px;
          margin-bottom: 24px;
        }

        .tab-button {
          background: none;
          border: none;
          font-size: 16px;
          font-weight: 500;
          color: #64748b;
          cursor: pointer;
          padding: 10px 0;
          position: relative;
          transition: all 0.2s;
        }

        .tab-button:hover {
          color: #1f2937;
        }

        .tab-button.active {
          color: var(--accent-blue);
          font-weight: 600;
        }

        .tab-button.active::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 100%;
          height: 3px;
          background: var(--accent-blue);
          border-radius: 2px;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .form-group {
          position: relative;
        }

        .form-group input {
          width: 100%;
          height: 40px;
          padding: 0 16px;
          border: 1px solid #e2e8f0;
          border-radius: 3px;
          font-size: 14px;
          background: #ffffff;
          transition: all 0.2s;
          box-sizing: border-box;
        }

        .form-group input:focus {
          outline: none;
          border-color: var(--accent-blue);
          background: white;
        }

        .form-group input::placeholder {
          color: #94a3b8;
          font-size: 13px;
        }

        .password-group {
          position: relative;
        }

        .toggle-password {
          position: absolute;
          right: 3px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          padding: 8px 10px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          color: #94a3b8;
        }

        .toggle-password:hover {
          background: rgba(0, 0, 0, 0.05);
          color: #64748b;
        }

        .toggle-password:active {
          transform: translateY(-50%) scale(0.95);
        }

        .code-group {
          display: flex;
          gap: 10px;
        }

        .code-group input {
          flex: 1;
        }

        .get-code-btn {
          white-space: nowrap;
          padding: 0 20px;
          height: 40px;
          border: 1px solid var(--accent-blue);
          background: white;
          color: var(--accent-blue);
          border-radius: 3px;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .get-code-btn:hover {
          background: rgba(36, 144, 248, 0.05);
        }

        .form-hint {
          font-size: 12px;
          color: #64748b;
          text-align: left;
          margin-top: -2px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .hint-link {
          color: var(--accent-blue);
          text-decoration: none;
          font-weight: 500;
        }

        .submit-button {
          height: 40px;
          background: var(--accent-blue);
          color: white;
          border: none;
          border-radius: 3px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          margin-top: 16px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .submit-button:hover {
          background: var(--accent-blue-hover);
        }

        .submit-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .login-error {
          color: #e74c3c;
          font-size: 13px;
          text-align: center;
          margin-top: 12px;
          padding: 8px 12px;
          background: #fef2f2;
          border-radius: 4px;
          border: 1px solid #fecaca;
        }

        .login-links {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 12px;
          margin-top: 20px;
          flex-wrap: wrap;
        }

        .login-link {
          font-size: 13px;
          color: #64748b;
          text-decoration: none;
        }

        .login-link:hover {
          color: var(--accent-blue);
        }

        .link-divider {
          color: #e2e8f0;
          font-size: 13px;
        }

        .divider {
          display: flex;
          align-items: center;
          margin: 28px 0;
        }

        .divider::before,
        .divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: #e2e8f0;
        }

        .divider span {
          padding: 0 20px;
          font-size: 12px;
          color: #94a3b8;
        }

        .social-buttons {
          display: flex;
          justify-content: center;
          gap: 16px;
        }

        .social-button {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: 2px solid #e2e8f0;
          background: white;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
        }

        .social-button:hover {
          background: #f8fafc;
          border-color: var(--accent-blue);
        }

        .social-icon {
          font-size: 22px;
        }

        .register-prompt {
          text-align: center;
          margin-top: 24px;
          font-size: 14px;
        }

        .register-prompt span {
          color: #64748b;
        }

        .register-link {
          color: var(--accent-blue);
          text-decoration: none;
          font-weight: 600;
        }

        .register-link:hover {
          text-decoration: underline;
        }

        .footer-text {
          margin-top: 32px;
          text-align: center;
        }

        .footer-text p {
          font-size: 12px;
          color: #94a3b8;
          margin: 4px 0;
        }

        .footer-links {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .footer-links a {
          color: #94a3b8;
          text-decoration: none;
          font-size: 12px;
        }

        .footer-links span {
          color: #cbd5e1;
        }

        /* 响应式 */
        @media (max-width: 1200px) {
          .login-content {
            gap: 40px;
          }

          .feature-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 960px) {
          .login-left {
            display: none;
          }

          .login-right {
            width: 100%;
            max-width: 440px;
          }
        }

        @media (max-width: 480px) {
          .login-top-nav {
            padding: 16px 20px;
          }

          .login-content {
            padding: 20px;
          }

          .login-card {
            padding: 24px;
          }
        }
      `}</style>
    </div>
  );
};

export default Login;
