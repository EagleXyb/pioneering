import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [rememberMe, setRememberMe] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 从localStorage加载保存的登录信息
  useEffect(() => {
    if (isLogin) {
      console.log('加载保存的登录信息');
      const savedEmail = localStorage.getItem('loginEmail');
      const savedPassword = localStorage.getItem('loginPassword');
      console.log('从localStorage读取:', { savedEmail, savedPassword });
      if (savedEmail && savedPassword) {
        setFormData(prev => ({
          ...prev,
          email: savedEmail,
          password: savedPassword
        }));
        setRememberMe(true);
        console.log('成功加载保存的登录信息');
      }
    }
  }, [isLogin]); // 依赖isLogin，当从注册模式切换到登录模式时也执行

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    if (type === 'checkbox') {
      setRememberMe(checked);
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
      // 清除对应字段的错误
      if (errors[name]) {
        setErrors(prev => ({ ...prev, [name]: '' }));
      }
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.email) {
      newErrors.email = '请输入邮箱地址';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = '请输入有效的邮箱地址';
    }

    if (!formData.password) {
      newErrors.password = '请输入密码';
    } else if (formData.password.length < 6) {
      newErrors.password = '密码至少需要6个字符';
    }

    if (!isLogin) {
      if (!formData.username) {
        newErrors.username = '请输入用户名';
      }
      if (formData.password !== formData.confirmPassword) {
        newErrors.confirmPassword = '两次输入的密码不一致';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (validateForm()) {
      // 模拟登录/注册成功
      console.log(isLogin ? '登录成功' : '注册成功', formData);
      
      // 处理记住我功能
      if (isLogin) {
        console.log('处理记住我功能:', { rememberMe, email: formData.email, password: formData.password });
        if (rememberMe) {
          // 保存登录信息到localStorage
          localStorage.setItem('loginEmail', formData.email);
          localStorage.setItem('loginPassword', formData.password);
          console.log('登录信息已保存到localStorage');
        } else {
          // 清除保存的登录信息
          localStorage.removeItem('loginEmail');
          localStorage.removeItem('loginPassword');
          console.log('已清除localStorage中的登录信息');
        }
      }
      
      navigate('/');
    }
  };

  const switchMode = () => {
    setIsLogin(!isLogin);
    setErrors({});
    setRememberMe(false);
    setFormData({
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
    });
  };

  return (
    <div className="login-container">
      {/* 左侧品牌区域 */}
      <div className="login-brand">
        <div className="brand-content">
          <h2>激发创新潜能</h2>
          <h2>孵化未来梦想</h2>
        </div>
      </div>

      {/* 右侧登录区域 */}
      <div className="login-card">
        {/* Logo */}
        <Link to="/" className="login-logo">
          <span className="logo-icon">💡</span>
          <span className="logo-text">IAC Incubator</span>
        </Link>

        {/* 标题 */}
        <div className="login-header">
          <h1>{isLogin ? '欢迎回来' : '创建账户'}</h1>
          <p>{isLogin ? '登录您的账户继续探索' : '注册账户开启创新之旅'}</p>
        </div>

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="login-form">
          {!isLogin && (
            <div className="form-group">
              <label htmlFor="username">用户名</label>
              <input
                type="text"
                id="username"
                name="username"
                value={formData.username}
                onChange={handleChange}
                placeholder="请输入用户名"
                className={errors.username ? 'error' : ''}
              />
              {errors.username && <span className="error-message">{errors.username}</span>}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email">邮箱</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="请输入邮箱地址"
              className={errors.email ? 'error' : ''}
            />
            {errors.email && <span className="error-message">{errors.email}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="password">密码</label>
            <input
              type="password"
              id="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="请输入密码"
              className={errors.password ? 'error' : ''}
            />
            {errors.password && <span className="error-message">{errors.password}</span>}
          </div>

          {!isLogin && (
            <div className="form-group">
              <label htmlFor="confirmPassword">确认密码</label>
              <input
                type="password"
                id="confirmPassword"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                placeholder="请再次输入密码"
                className={errors.confirmPassword ? 'error' : ''}
              />
              {errors.confirmPassword && <span className="error-message">{errors.confirmPassword}</span>}
            </div>
          )}

          {isLogin && (
            <div className="form-options">
              <label className="checkbox-label">
                <input type="checkbox" name="rememberMe" checked={rememberMe} onChange={handleChange} />
                <span>记住我</span>
              </label>
              <Link to="/forgot-password" className="forgot-link">忘记密码？</Link>
            </div>
          )}

          <button type="submit" className="submit-button">
            {isLogin ? '登录' : '注册'}
          </button>
        </form>

        {/* 切换登录/注册 */}
        <div className="switch-mode">
          <span>{isLogin ? '还没有账户？' : '已有账户？'}</span>
          <button onClick={switchMode} className="switch-button">
            {isLogin ? '立即注册' : '立即登录'}
          </button>
        </div>

        {/* 第三方登录 */}
        <div className="divider">
          <span>或</span>
        </div>

        <div className="social-buttons">
          <button className="social-button wechat">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178A1.17 1.17 0 014.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178 1.17 1.17 0 01-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 01.598.082l1.584.926a.272.272 0 00.14.045c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.49.49 0 01.176-.553c1.527-1.122 2.5-2.79 2.5-4.635 0-3.122-2.965-5.984-7.058-6.107zm-2.082 3.056c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.97-.982zm4.168 0c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.969-.982z"/>
            </svg>
            <span>微信登录</span>
          </button>
          <button className="social-button github">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
            </svg>
            <span>GitHub 登录</span>
          </button>
        </div>
      </div>

      <style>{`
        .login-container {
          min-height: 100vh;
          display: flex;
          align-items: stretch;
          background: var(--gradient-hero);
          position: relative;
        }

        .login-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 100%;
          height: 100%;
          background: radial-gradient(circle at 50% 0%, rgba(36, 144, 248, 0.08) 0%, transparent 70%);
          pointer-events: none;
        }

        /* 左侧品牌区域 */
        .login-brand {
          width: 480px;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #2490f8;
          position: relative;
          z-index: 1;
        }

        .brand-content {
          text-align: center;
          color: white;
        }

        .brand-content h2 {
          font-size: 36px;
          font-weight: 600;
          margin: 12px 0;
          letter-spacing: 2px;
        }

        /* 右侧登录区域 */
        .login-card {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: var(--spacing-2xl);
          position: relative;
          z-index: 1;
        }

        .login-logo {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--spacing-sm);
          margin-bottom: var(--spacing-2xl);
          text-decoration: none;
        }

        .logo-icon {
          font-size: 32px;
        }

        .logo-text {
          font-size: 24px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .login-header {
          text-align: center;
          margin-bottom: var(--spacing-xl);
        }

        .login-header h1 {
          font-size: 28px;
          font-weight: 600;
          margin-bottom: var(--spacing-sm);
        }

        .login-header p {
          font-size: 15px;
          color: var(--text-secondary);
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-md);
          width: 300px;
          letter-spacing: normal;
          text-align: left;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-xs);
          width: 100%;
        }

        .form-group label {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-primary);
        }

        .form-group input {
          width: 100%;
          height: 44px;
          padding: 0 var(--spacing-md);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          font-size: 15px;
          transition: all var(--transition-fast);
          background: var(--bg-primary);
        }

        .form-group input:focus {
          outline: none;
          border-color: var(--accent-blue);
          box-shadow: 0 0 0 3px rgba(36, 144, 248, 0.1);
        }

        .form-group input.error {
          border-color: var(--accent-pink);
        }

        .form-group input::placeholder {
          color: var(--text-tertiary);
        }

        .error-message {
          font-size: 13px;
          color: var(--accent-pink);
        }

        .form-options {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: var(--spacing-xs);
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          font-size: 14px;
          color: var(--text-secondary);
          cursor: pointer;
        }

        .checkbox-label input {
          width: 16px;
          height: 16px;
          cursor: pointer;
        }

        .forgot-link {
          font-size: 14px;
          color: var(--accent-blue);
        }

        .forgot-link:hover {
          text-decoration: underline;
        }

        .submit-button {
          width: 420px;
          height: 48px;
          background: var(--accent-blue);
          color: white;
          border: none;
          border-radius: var(--radius-md);
          font-size: 17px;
          font-weight: 500;
          cursor: pointer;
          transition: all var(--transition-fast);
          margin-top: var(--spacing-sm);
        }

        .submit-button:hover {
          background: var(--accent-blue-hover);
        }

        .switch-mode {
          text-align: center;
          margin-top: var(--spacing-lg);
          font-size: 14px;
          color: var(--text-secondary);
        }

        .switch-button {
          color: var(--accent-blue);
          font-weight: 500;
          margin-left: var(--spacing-xs);
        }

        .switch-button:hover {
          text-decoration: underline;
        }

        .divider {
          display: flex;
          align-items: center;
          margin: var(--spacing-xl) 0;
        }

        .divider::before,
        .divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--border-light);
        }

        .divider span {
          padding: 0 var(--spacing-md);
          font-size: 13px;
          color: var(--text-tertiary);
        }

        .social-buttons {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-sm);
        }

        .social-button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--spacing-sm);
          height: 44px;
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          background: var(--bg-primary);
          font-size: 15px;
          color: var(--text-primary);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .social-button:hover {
          background: var(--bg-secondary);
          border-color: var(--border);
        }

        .social-button.wechat svg {
          color: #2490f8;
        }

        .social-button.github svg {
          color: var(--text-primary);
        }

        /* 暗色主题适配 */
        @media (prefers-color-scheme: dark) {
          .login-card {
            background: var(--bg-primary);
          }

          .form-group input {
            background: var(--bg-secondary);
            border-color: var(--border);
          }

          .social-button {
            background: var(--bg-secondary);
            border-color: var(--border);
          }

          .social-button:hover {
            background: var(--bg-tertiary);
          }
        }

        /* 响应式 */
        @media (max-width: 960px) {
          .login-brand {
            display: none;
          }

          .login-card {
            width: 100%;
          }
        }

        @media (max-width: 480px) {
          .login-card {
            padding: var(--spacing-xl);
          }

          .login-form,
          .form-group,
          .form-group input,
          .submit-button {
            width: 100%;
          }

          .login-header h1 {
            font-size: 24px;
          }

          .logo-text {
            font-size: 20px;
          }
        }
      `}</style>
    </div>
  );
};

export default Login;
