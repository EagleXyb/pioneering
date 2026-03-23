import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';

const Home: React.FC = () => {
  const { userState, login, logout } = useUser();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    logout();
    setShowDropdown(false);
  };

  const handleOpenLogin = () => {
    setShowLoginModal(true);
    document.body.style.overflow = 'hidden';
  };

  const handleCloseLogin = () => {
    setShowLoginModal(false);
    setIsLogin(true);
    setFormData({ username: '', email: '', password: '', confirmPassword: '' });
    setErrors({});
    document.body.style.overflow = 'auto';
  };

  const handleModalClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleCloseLogin();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (validateForm()) {
      console.log(isLogin ? '登录成功' : '注册成功', formData);
      await login(formData.email, formData.username || undefined);
      handleCloseLogin();
    }
  };

  const switchMode = () => {
    setIsLogin(!isLogin);
    setErrors({});
    setFormData({ username: '', email: '', password: '', confirmPassword: '' });
  };

  return (
    <div className="home-container">
      <nav className="nav">
        <div className="nav-content">
          <div className="nav-logo">
            <span className="logo-icon">💡</span>
            <span className="logo-text">IAC Incubator</span>
          </div>
          
          <div className="nav-right">
            {userState.isLoggedIn ? (
              <div className="user-menu" ref={dropdownRef}>
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
                    
                    <Link 
                      to="/profile" 
                      className="dropdown-item"
                      onClick={() => setShowDropdown(false)}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="6" r="3" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.5"/>
                      </svg>
                      <span>个人中心</span>
                    </Link>
                    
                    <Link 
                      to="/admin" 
                      className="dropdown-item"
                      onClick={() => setShowDropdown(false)}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M2 6h12M6 2v12" stroke="currentColor" strokeWidth="1.5"/>
                      </svg>
                      <span>后台管理</span>
                    </Link>
                    
                    <div className="dropdown-divider"></div>
                    
                    <button 
                      className="dropdown-item dropdown-item-logout"
                      onClick={handleLogout}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M6 2H3v12h3" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M12 8H6M9 5l3 3-3 3" stroke="currentColor" strokeWidth="1.5"/>
                      </svg>
                      <span>退出登录</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button className="login-button" onClick={handleOpenLogin}>
                登录 / 注册
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Hero 区域 */}
      <section className="hero">
        <div className="hero-content">
          <h1 className="hero-title">
            创新创造孵化器
          </h1>
          <h2 className="hero-subtitle">
            激发创新潜能，孵化未来梦想
          </h2>
          <p className="hero-description">
            通过科学的测评体系、系统的训练方法和专业的孵化服务，助力您的创新之路
          </p>
          <div className="hero-cta">
            <Link to="/assessment" className="btn-primary">
              开始测评
            </Link>
          </div>
        </div>
      </section>

      {/* 功能区域 */}
        <section className="features">
          <div className="features-content">
            <div className="section-header">
              <h2 className="section-title">核心功能</h2>
              <p className="section-description">
                全方位的创新支持体系，为您的创意保驾护航
              </p>
            </div>

            <div className="feature-grid">
              <Link to="/assessment" className="feature-card">
                <div className="card-glow" style={{ background: 'radial-gradient(circle at 0% 0%, rgba(255, 107, 107, 0.3) 0%, transparent 50%)' }}></div>
                <div className="card-header">
                  <div className="feature-icon" style={{ background: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%)' }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
                    </svg>
                  </div>
                </div>
                <h3 className="feature-title">创新能力测评</h3>
                <p className="feature-description">
                  智谱新一代测评模型，全面评估您的创新能力维度，提供个性化发展建议
                </p>
              </Link>

              <Link to="/training" className="feature-card">
                <div className="card-glow" style={{ background: 'radial-gradient(circle at 100% 0%, rgba(79, 172, 254, 0.3) 0%, transparent 50%)' }}></div>
                <div className="card-header">
                  <div className="feature-icon" style={{ background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <polygon points="10 8 16 12 10 16 10 8"/>
                    </svg>
                  </div>
                </div>
                <h3 className="feature-title">创新能力训练</h3>
                <p className="feature-description">
                  面向创新场景深度优化的训练模型，让创新思维更灵活，在多样化的创新任务中具备执行能力
                </p>
              </Link>

              <Link to="/incubation" className="feature-card">
                <div className="card-glow" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(67, 233, 123, 0.3) 0%, transparent 50%)' }}></div>
                <div className="card-header">
                  <div className="feature-icon" style={{ background: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                    </svg>
                  </div>
                </div>
                <h3 className="feature-title">创新方案孵化</h3>
                <p className="feature-description">
                  基于创新训练模型的超智套餐，让企业和个人都能灵活选择，实现创新Tokens自由，以更低成本响应的创新需求！
                </p>
              </Link>
            </div>
          </div>
        </section>

      {/* 特性展示 */}
      <section className="benefits">
        <div className="benefits-content">
          <div className="benefit-item">
            <div className="benefit-number">01</div>
            <h3 className="benefit-title">科学评估</h3>
            <p className="benefit-text">
              采用国际领先的评估模型，多维度精准分析创新能力
            </p>
          </div>
          <div className="benefit-item">
            <div className="benefit-number">02</div>
            <h3 className="benefit-title">个性定制</h3>
            <p className="benefit-text">
              根据评估结果，为您量身打造专属的成长路径
            </p>
          </div>
          <div className="benefit-item">
            <div className="benefit-number">03</div>
            <h3 className="benefit-title">全程陪伴</h3>
            <p className="benefit-text">
              专业导师团队全程指导，助您突破创新瓶颈
            </p>
          </div>
        </div>
      </section>

      {/* 页脚 */}
      <footer className="footer">
        <div className="footer-content">
          <p className="footer-text">© 2024 IAC Incubator. 保留所有权利。</p>
        </div>
      </footer>

      {/* 登录弹框 */}
      {showLoginModal && (
        <div className="login-modal-overlay" onClick={handleModalClick}>
          <div className="login-modal" ref={modalRef}>
            <button className="modal-close" onClick={handleCloseLogin}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
            
            <div className="modal-content">
              {/* 左侧品牌区域 */}
              <div className="modal-brand">
                <div className="brand-content">
                  <div className="brand-logo">
                    <span className="logo-icon-large">💡</span>
                    <span className="logo-text-large">IAC Incubator</span>
                  </div>
                  <h2 className="brand-title">激发创新潜能<br/>孵化未来梦想</h2>
                  <p className="brand-description">通过科学的测评体系、系统的训练方法和专业的孵化服务，助力您的创新之路</p>
                </div>
              </div>
              
              {/* 右侧表单区域 */}
              <div className="modal-form-container">
                <div className="form-header">
                  <h1>{isLogin ? '欢迎回来' : '创建账户'}</h1>
                  <p>{isLogin ? '登录您的账户继续探索' : '注册账户开启创新之旅'}</p>
                </div>

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
                        <input type="checkbox" />
                        <span>记住我</span>
                      </label>
                      <a href="#" className="forgot-link">忘记密码？</a>
                    </div>
                  )}

                  <button type="submit" className="submit-button">
                    {isLogin ? '登录' : '注册'}
                  </button>
                </form>

                <div className="switch-mode">
                  <span>{isLogin ? '还没有账户？' : '已有账户？'}</span>
                  <button onClick={switchMode} className="switch-button">
                    {isLogin ? '立即注册' : '立即登录'}
                  </button>
                </div>

                <div className="divider">
                  <span>或</span>
                </div>

                <div className="social-buttons">
                  <button type="button" className="social-button wechat">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                      <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178A1.17 1.17 0 014.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178 1.17 1.17 0 01-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 01.598.082l1.584.926a.272.272 0 00.14.045c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.49.49 0 01.176-.553c1.527-1.122 2.5-2.79 2.5-4.635 0-3.122-2.965-5.984-7.058-6.107zm-2.082 3.056c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.97-.982zm4.168 0c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.969-.982z"/>
                    </svg>
                    <span>微信登录</span>
                  </button>
                  <button type="button" className="social-button github">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
                    </svg>
                    <span>GitHub 登录</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .home-container {
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

        .nav-logo {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
        }

        .logo-icon {
          font-size: 24px;
        }

        .logo-text {
          font-size: 21px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .nav-right {
          display: flex;
          align-items: center;
          gap: var(--spacing-md);
        }

        .login-button {
          display: inline-block;
          padding: 8px 20px;
          background: rgba(0, 113, 227, 0.08);
          color: var(--accent-blue);
          border: none;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all var(--transition-fast);
          text-decoration: none;
        }

        .login-button:hover {
          background: rgba(0, 113, 227, 0.15);
        }

        /* 登录弹框样式 */
        .login-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          animation: fadeIn 0.3s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .login-modal {
          width: 1010px;
          height: 660px;
          background: var(--bg-primary);
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          position: relative;
          animation: slideUp 0.3s ease;
        }

        @keyframes slideUp {
          from { 
            opacity: 0;
            transform: translateY(20px);
          }
          to { 
            opacity: 1;
            transform: translateY(0);
          }
        }

        .modal-close {
          position: absolute;
          top: 16px;
          right: 16px;
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.05);
          border: none;
          border-radius: 50%;
          cursor: pointer;
          z-index: 10;
          transition: all var(--transition-fast);
          color: var(--text-secondary);
        }

        .modal-close:hover {
          background: rgba(0, 0, 0, 0.1);
          color: var(--text-primary);
        }

        .modal-content {
          display: flex;
          height: 100%;
        }

        /* 左侧品牌区域 */
        .modal-brand {
          width: 400px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .brand-content {
          text-align: center;
          color: white;
        }

        .brand-logo {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: 48px;
        }

        .logo-icon-large {
          font-size: 48px;
        }

        .logo-text-large {
          font-size: 28px;
          font-weight: 600;
        }

        .brand-title {
          font-size: 32px;
          font-weight: 600;
          line-height: 1.3;
          margin-bottom: 24px;
          color: white;
        }

        .brand-description {
          font-size: 15px;
          line-height: 1.6;
          opacity: 0.9;
          color: white;
        }

        /* 右侧表单区域 */
        .modal-form-container {
          flex: 1;
          padding: 48px 56px;
          overflow-y: auto;
        }

        .form-header {
          text-align: center;
          margin-bottom: 32px;
        }

        .form-header h1 {
          font-size: 28px;
          font-weight: 600;
          margin-bottom: 8px;
        }

        .form-header p {
          font-size: 15px;
          color: var(--text-secondary);
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .form-group label {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-primary);
        }

        .form-group input {
          height: 44px;
          padding: 0 16px;
          border: 1px solid var(--border);
          border-radius: 8px;
          font-size: 15px;
          transition: all var(--transition-fast);
          background: var(--bg-primary);
        }

        .form-group input:focus {
          outline: none;
          border-color: var(--accent-blue);
          box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.1);
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
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
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

        .submit-button {
          height: 48px;
          background: var(--accent-blue);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 17px;
          font-weight: 500;
          cursor: pointer;
          transition: all var(--transition-fast);
          margin-top: 8px;
        }

        .submit-button:hover {
          background: var(--accent-blue-hover);
        }

        .switch-mode {
          text-align: center;
          margin-top: 20px;
          font-size: 14px;
          color: var(--text-secondary);
        }

        .switch-button {
          color: var(--accent-blue);
          font-weight: 500;
          margin-left: 4px;
          cursor: pointer;
        }

        .switch-button:hover {
          text-decoration: underline;
        }

        .divider {
          display: flex;
          align-items: center;
          margin: 24px 0;
        }

        .divider::before,
        .divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--border-light);
        }

        .divider span {
          padding: 0 16px;
          font-size: 13px;
          color: var(--text-tertiary);
        }

        .social-buttons {
          display: flex;
          gap: 12px;
        }

        .social-button {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          height: 44px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--bg-primary);
          font-size: 14px;
          color: var(--text-primary);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .social-button:hover {
          background: var(--bg-secondary);
        }

        .social-button.wechat svg {
          color: #07C160;
        }

        .social-button.github svg {
          color: var(--text-primary);
        }

        .user-menu {
          position: relative;
        }

        .avatar-button {
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px;
          border-radius: 50%;
          transition: all var(--transition-fast);
        }

        .avatar-button:hover {
          box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.1);
        }

        .avatar-small {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          font-weight: 600;
          color: white;
        }

        .avatar-small-image {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          object-fit: cover;
        }

        .avatar-medium-image {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          object-fit: cover;
        }

        .dropdown-menu {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          min-width: 240px;
          background: var(--bg-primary);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-lg);
          border: 1px solid var(--border-light);
          overflow: hidden;
          animation: dropdownFadeIn 0.2s ease;
          z-index: 1000;
        }

        @keyframes dropdownFadeIn {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .dropdown-header {
          display: flex;
          align-items: center;
          gap: var(--spacing-md);
          padding: var(--spacing-md);
          background: var(--bg-secondary);
        }

        .avatar-medium {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          font-weight: 600;
          color: white;
          flex-shrink: 0;
        }

        .user-info {
          flex: 1;
          min-width: 0;
        }

        .user-name {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 2px;
        }

        .user-email {
          font-size: 13px;
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .dropdown-divider {
          height: 1px;
          background: var(--border-light);
          margin: var(--spacing-xs) 0;
        }

        .dropdown-item {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
          padding: 10px var(--spacing-md);
          color: var(--text-primary);
          text-decoration: none;
          font-size: 14px;
          transition: background var(--transition-fast);
          cursor: pointer;
          width: 100%;
          border: none;
          background: none;
          text-align: left;
        }

        .dropdown-item:hover {
          background: rgba(0, 113, 227, 0.05);
          text-decoration: none;
        }

        .dropdown-item svg {
          color: var(--text-secondary);
        }

        .dropdown-item-logout {
          color: var(--accent-pink);
        }

        .dropdown-item-logout svg {
          color: var(--accent-pink);
        }

        /* Hero 区域 */
        .hero {
          padding: 120px var(--spacing-xl) 100px;
          background: var(--gradient-hero);
          position: relative;
          overflow: hidden;
        }

        .hero::before {
          content: '';
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 100%;
          height: 100%;
          background: radial-gradient(circle at 50% 0%, rgba(0, 113, 227, 0.08) 0%, transparent 70%);
          pointer-events: none;
        }

        .hero-content {
          max-width: 980px;
          margin: 0 auto;
          text-align: center;
          position: relative;
          z-index: 1;
        }

        .hero-title {
          font-size: 64px;
          font-weight: 600;
          letter-spacing: -0.015em;
          line-height: 1.05;
          color: var(--text-primary);
          margin-bottom: var(--spacing-md);
        }

        .hero-subtitle {
          font-size: 32px;
          font-weight: 500;
          letter-spacing: 0.004em;
          line-height: 1.25;
          color: var(--text-primary);
          margin-bottom: var(--spacing-lg);
        }

        .hero-description {
          font-size: 21px;
          line-height: 1.381;
          color: var(--text-secondary);
          max-width: 600px;
          margin: 0 auto var(--spacing-2xl);
        }

        .hero-cta {
          display: flex;
          gap: var(--spacing-md);
          justify-content: center;
          align-items: center;
        }

        .btn-primary {
          display: inline-block;
          background: var(--accent-blue);
          color: white;
          padding: 12px 24px;
          border-radius: var(--radius-full);
          font-size: 17px;
          font-weight: 500;
          text-decoration: none;
          transition: all var(--transition-base);
        }

        .btn-primary:hover {
          background: var(--accent-blue-hover);
          transform: scale(1.02);
          text-decoration: none;
        }

        /* 功能区域 */
        .features {
          padding: var(--spacing-4xl) var(--spacing-xl);
          background: var(--bg-primary);
        }

        .features-content {
          max-width: 1400px;
          margin: 0 auto;
        }

        .section-header {
          text-align: center;
          margin-bottom: var(--spacing-3xl);
        }

        .section-title {
          font-size: 48px;
          font-weight: 600;
          letter-spacing: -0.003em;
          line-height: 1.08349;
          color: var(--text-primary);
          margin-bottom: var(--spacing-md);
        }

        .section-description {
          font-size: 19px;
          line-height: 1.4211;
          color: var(--text-secondary);
          max-width: 600px;
          margin: 0 auto;
        }

        .feature-grid {
          display: flex;
          justify-content: center;
          gap: calc(var(--spacing-lg) - 5px);
          padding: 20px 0;
          flex-wrap: nowrap;
        }

        .feature-card {
          background: var(--bg-secondary);
          padding: var(--spacing-2xl);
          border-radius: 10px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: pointer;
          text-decoration: none;
          border: 1px solid transparent;
          position: relative;
          overflow: hidden;
          width: 450px;
        }

        .feature-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%, rgba(255,255,255,0.05) 100%);
          opacity: 0;
          transition: opacity 0.3s ease;
          pointer-events: none;
        }

        .feature-card:hover {
          transform: translateY(-8px) scale(1.02);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15);
          border-color: var(--border-light);
          text-decoration: none;
        }

        .feature-card:hover::before {
          opacity: 1;
        }

        .card-glow {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 150px;
          opacity: 0;
          transition: opacity 0.4s ease;
          pointer-events: none;
        }

        .feature-card:hover .card-glow {
          opacity: 1;
        }

        .card-header {
          position: relative;
          z-index: 1;
        }

        .feature-icon {
          width: 48px;
          height: 48px;
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: var(--spacing-lg);
          color: white;
          transition: transform 0.3s ease;
        }

        .feature-card:hover .feature-icon {
          transform: scale(1.1) rotate(5deg);
        }

        .feature-title {
          font-size: 24px;
          font-weight: 600;
          letter-spacing: 0;
          line-height: 1.16667;
          color: var(--text-primary);
          margin-bottom: var(--spacing-md);
          position: relative;
          z-index: 1;
        }

        .feature-description {
          font-size: 14px;
          line-height: 1.6;
          color: var(--text-secondary);
          position: relative;
          z-index: 1;
        }

        /* 特性展示 */
        .benefits {
          padding: var(--spacing-4xl) var(--spacing-xl);
          background: var(--bg-secondary);
        }

        .benefits-content {
          max-width: 1200px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: var(--spacing-2xl);
        }

        .benefit-item {
          text-align: center;
        }

        .benefit-number {
          font-size: 56px;
          font-weight: 600;
          color: var(--border);
          line-height: 1;
          margin-bottom: var(--spacing-md);
        }

        .benefit-title {
          font-size: 21px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-sm);
        }

        .benefit-text {
          font-size: 15px;
          line-height: 1.46668;
          color: var(--text-secondary);
        }

        /* 页脚 */
        .footer {
          padding: var(--spacing-xl);
          background: var(--bg-secondary);
          border-top: 1px solid var(--border-light);
          margin-top: auto;
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
          .hero {
            padding: 80px var(--spacing-lg) 60px;
          }

          .hero-title {
            font-size: 48px;
          }

          .hero-subtitle {
            font-size: 24px;
          }

          .hero-description {
            font-size: 17px;
          }

          .section-title {
            font-size: 40px;
          }

          .features {
            padding: var(--spacing-3xl) var(--spacing-lg);
          }

          .benefits {
            padding: var(--spacing-3xl) var(--spacing-lg);
          }
        }

        @media (max-width: 1400px) {
          .feature-grid {
            flex-wrap: wrap;
          }
        }

        @media (max-width: 768px) {
          .nav-content {
            padding: 0 var(--spacing-md);
          }

          .login-button {
            padding: 6px 16px;
            font-size: 13px;
          }

          .avatar-small {
            width: 32px;
            height: 32px;
            font-size: 14px;
          }

          .dropdown-menu {
            min-width: 200px;
            right: -8px;
          }

          .avatar-medium {
            width: 40px;
            height: 40px;
            font-size: 18px;
          }

          .user-name {
            font-size: 14px;
          }

          .user-email {
            font-size: 12px;
          }

          .hero {
            padding: 60px var(--spacing-md) 40px;
          }

          .hero-title {
            font-size: 36px;
          }

          .hero-subtitle {
            font-size: 21px;
          }

          .hero-description {
            font-size: 15px;
          }

          .section-title {
            font-size: 32px;
          }

          .section-description {
            font-size: 17px;
          }

          .feature-card {
            width: 100%;
            max-width: 450px;
          }

          .benefits-content {
            grid-template-columns: 1fr;
          }

          .features,
          .benefits {
            padding: var(--spacing-2xl) var(--spacing-md);
          }
        }

        /* 暗色主题适配 */
        @media (prefers-color-scheme: dark) {
          .nav {
            background: rgba(29, 29, 31, 0.8);
          }

          .dropdown-menu {
            background: var(--bg-secondary);
            border-color: var(--border);
          }

          .dropdown-header {
            background: var(--bg-primary);
          }

          .dropdown-item:hover {
            background: rgba(0, 113, 227, 0.1);
          }

          .feature-card {
            background: var(--bg-secondary);
          }

          .benefit-number {
            color: var(--border);
          }

          .login-modal {
            background: var(--bg-secondary);
          }

          .modal-close {
            background: rgba(255, 255, 255, 0.1);
            color: var(--text-secondary);
          }

          .modal-close:hover {
            background: rgba(255, 255, 255, 0.15);
            color: var(--text-primary);
          }

          .form-group input {
            background: var(--bg-primary);
            border-color: var(--border);
          }

          .social-button {
            background: var(--bg-primary);
            border-color: var(--border);
          }

          .social-button:hover {
            background: var(--bg-secondary);
          }
        }

        /* 响应式 - 弹框 */
        @media (max-width: 1100px) {
          .login-modal {
            width: 90%;
            max-width: 800px;
            height: auto;
            max-height: 90vh;
          }

          .modal-brand {
            width: 320px;
            padding: 32px;
          }

          .brand-title {
            font-size: 28px;
          }

          .modal-form-container {
            padding: 32px 40px;
          }
        }

        @media (max-width: 768px) {
          .login-modal {
            width: 95%;
            max-height: 85vh;
          }

          .modal-content {
            flex-direction: column;
          }

          .modal-brand {
            width: 100%;
            padding: 24px;
          }

          .brand-logo {
            margin-bottom: 16px;
          }

          .brand-title {
            font-size: 24px;
            margin-bottom: 12px;
          }

          .brand-description {
            font-size: 14px;
          }

          .modal-form-container {
            padding: 24px;
          }

          .form-header h1 {
            font-size: 24px;
          }

          .social-buttons {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
};

export default Home;
