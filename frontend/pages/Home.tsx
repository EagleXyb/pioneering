import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';

const Home: React.FC = () => {
  const { userState, logout } = useUser();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
              <Link to="/login" className="login-button">
                登录 / 注册
              </Link>
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
                <div className="card-glow" style={{ background: 'radial-gradient(circle at 0% 0%, rgba(36, 144, 248, 0.3) 0%, transparent 50%)' }}></div>
                <div className="card-header">
                  <div className="feature-icon" style={{ background: '#2490f8' }}>
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
                <div className="card-glow" style={{ background: 'radial-gradient(circle at 100% 0%, rgba(36, 144, 248, 0.3) 0%, transparent 50%)' }}></div>
                <div className="card-header">
                  <div className="feature-icon" style={{ background: '#2490f8' }}>
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
                <div className="card-glow" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(36, 144, 248, 0.3) 0%, transparent 50%)' }}></div>
                <div className="card-header">
                  <div className="feature-icon" style={{ background: '#2490f8' }}>
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
          width: 122px;
          padding: 8px 20px;
          background: rgba(36, 144, 248, 0.08);
          color: var(--accent-blue);
          border: none;
          border-radius: 3px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all var(--transition-fast);
          text-decoration: none;
        }

        .login-button:hover {
          background: rgba(36, 144, 248, 0.15);
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
          box-shadow: 0 0 0 3px rgba(36, 144, 248, 0.1);
        }

        .avatar-small {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: #2490f8;
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
          background: #2490f8;
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
          background: rgba(36, 144, 248, 0.05);
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
          background: radial-gradient(circle at 50% 0%, rgba(36, 144, 248, 0.08) 0%, transparent 70%);
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
          width: 130px;
          background: var(--accent-blue);
          color: white;
          padding: 12px 24px;
          border-radius: 3px;
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
            background: rgba(36, 144, 248, 0.1);
          }

          .feature-card {
            background: var(--bg-secondary);
          }

          .benefit-number {
            color: var(--border);
          }
        }
      `}</style>
    </div>
  );
};

export default Home;
