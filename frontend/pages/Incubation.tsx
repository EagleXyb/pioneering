import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const Incubation: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <div className="incubation-container">
      <nav className="nav">
        <div className="nav-content">
          <Link to="/" className="nav-back">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span>返回首页</span>
          </Link>
          <h1 className="nav-title">创新方案孵化</h1>
          <div style={{ width: '80px' }}></div>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-glow"></div>
        <div className="hero-content">
          <div className={`hero-badge ${isVisible ? 'animate-in' : ''}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
            <span>全流程孵化</span>
          </div>
          <h2 className={`hero-title ${isVisible ? 'animate-in' : ''}`}>从创意到落地</h2>
          <p className={`hero-description ${isVisible ? 'animate-in' : ''}`}>
            基于创新训练模型的超智套餐，让企业和个人都能灵活选择，实现创新Tokens自由，以更低成本响应的创新需求！
          </p>
          <div className={`hero-cta ${isVisible ? 'animate-in' : ''}`}>
            <Link to="/experience" className="cta-button">
              立即体验
            </Link>
          </div>
        </div>
      </section>

      <section className="incubation-stages">
        <div className="stages-content">
          <div className="stages-grid">
            <div className="stage-card">
              <div className="stage-glow" style={{ background: 'radial-gradient(circle at 0% 0%, rgba(67, 233, 123, 0.4) 0%, transparent 60%)' }}></div>
              <div className="stage-number">01</div>
              <div className="stage-icon" style={{ background: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M8 12h8"/>
                  <path d="M12 8v8"/>
                </svg>
              </div>
              <h3 className="stage-title">创意生成</h3>
              <p className="stage-description">
                头脑风暴、创意收集、问题定义，帮助您捕捉每一个灵感火花
              </p>
              <ul className="stage-features">
                <li>创意库管理</li>
                <li>思维导图工具</li>
                <li>灵感记录</li>
              </ul>
            </div>

            <div className="stage-card">
              <div className="stage-glow" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(52, 152, 219, 0.4) 0%, transparent 60%)' }}></div>
              <div className="stage-number">02</div>
              <div className="stage-icon" style={{ background: 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                  <line x1="12" y1="22.08" x2="12" y2="12"/>
                </svg>
              </div>
              <h3 className="stage-title">方案设计</h3>
              <p className="stage-description">
                市场分析、竞品研究、商业模式设计，让创意变得可落地
              </p>
              <ul className="stage-features">
                <li>市场调研工具</li>
                <li>商业模式画布</li>
                <li>可行性分析</li>
              </ul>
            </div>

            <div className="stage-card">
              <div className="stage-glow" style={{ background: 'radial-gradient(circle at 100% 0%, rgba(155, 89, 182, 0.4) 0%, transparent 60%)' }}></div>
              <div className="stage-number">03</div>
              <div className="stage-icon" style={{ background: 'linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%)' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
              </div>
              <h3 className="stage-title">原型开发</h3>
              <p className="stage-description">
                快速原型、用户测试、迭代优化，验证您的创新方案
              </p>
              <ul className="stage-features">
                <li>原型设计工具</li>
                <li>用户测试平台</li>
                <li>迭代管理</li>
              </ul>
            </div>

            <div className="stage-card">
              <div className="stage-glow" style={{ background: 'radial-gradient(circle at 0% 0%, rgba(243, 156, 18, 0.4) 0%, transparent 60%)' }}></div>
              <div className="stage-number">04</div>
              <div className="stage-icon" style={{ background: 'linear-gradient(135deg, #f39c12 0%, #e67e22 100%)' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 0 1 9-9"/>
                </svg>
              </div>
              <h3 className="stage-title">资源对接</h3>
              <p className="stage-description">
                导师资源、资金对接、市场推广，助力您的方案成功落地
              </p>
              <ul className="stage-features">
                <li>导师库对接</li>
                <li>融资资源</li>
                <li>市场推广</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="pricing">
        <div className="pricing-content">
          <h2 className="pricing-title">选择适合您的孵化套餐</h2>
          <div className="pricing-grid">
            <div className="pricing-card">
              <div className="pricing-header">
                <h3 className="pricing-name">个人版</h3>
                <div className="pricing-price">
                  <span className="currency">¥</span>
                  <span className="amount">299</span>
                  <span className="period">/月</span>
                </div>
              </div>
              <ul className="pricing-features">
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>创意生成工具</span>
                </li>
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>基础方案设计</span>
                </li>
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>10个创新项目</span>
                </li>
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>社区支持</span>
                </li>
              </ul>
              <button className="pricing-btn">开始使用</button>
            </div>

            <div className="pricing-card featured">
              <div className="pricing-badge">推荐</div>
              <div className="pricing-header">
                <h3 className="pricing-name">团队版</h3>
                <div className="pricing-price">
                  <span className="currency">¥</span>
                  <span className="amount">999</span>
                  <span className="period">/月</span>
                </div>
              </div>
              <ul className="pricing-features">
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>包含个人版全部功能</span>
                </li>
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>无限创新项目</span>
                </li>
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>团队协作功能</span>
                </li>
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>专业导师咨询</span>
                </li>
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>优先资源对接</span>
                </li>
              </ul>
              <button className="pricing-btn featured">立即升级</button>
            </div>

            <div className="pricing-card">
              <div className="pricing-header">
                <h3 className="pricing-name">企业版</h3>
                <div className="pricing-price">
                  <span className="currency">¥</span>
                  <span className="amount">定制</span>
                </div>
              </div>
              <ul className="pricing-features">
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>包含团队版全部功能</span>
                </li>
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>私有化部署</span>
                </li>
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>定制化功能</span>
                </li>
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>专属客户经理</span>
                </li>
                <li>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>SLA保障</span>
                </li>
              </ul>
              <button className="pricing-btn">联系我们</button>
            </div>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="footer-content">
          <p className="footer-text">© 2024 IAC Incubator. 保留所有权利。</p>
        </div>
      </footer>

      <style>{`
        .incubation-container {
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

        .hero {
          padding: 100px var(--spacing-xl) 80px;
          background: var(--gradient-hero);
          text-align: center;
          position: relative;
          overflow: hidden;
        }

        .hero-glow {
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 100%;
          height: 100%;
          background: radial-gradient(circle at 50% 0%, rgba(67, 233, 123, 0.15) 0%, transparent 60%);
          pointer-events: none;
        }

        .hero-content {
          max-width: 720px;
          margin: 0 auto;
          position: relative;
          z-index: 1;
        }

        .hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 16px;
          background: rgba(67, 233, 123, 0.1);
          color: #43e97b;
          border-radius: var(--radius-full);
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.5px;
          margin-bottom: var(--spacing-lg);
          opacity: 0;
          transform: translateY(20px);
        }

        .hero-badge.animate-in {
          animation: fadeInUp 0.6s ease forwards;
          animation-delay: 0.1s;
        }

        .hero-title {
          font-size: 56px;
          font-weight: 700;
          letter-spacing: -0.01em;
          line-height: 1.1;
          color: var(--text-primary);
          margin-bottom: var(--spacing-md);
          opacity: 0;
          transform: translateY(20px);
        }

        .hero-title.animate-in {
          animation: fadeInUp 0.6s ease forwards;
          animation-delay: 0.2s;
        }

        .hero-description {
          font-size: 20px;
          line-height: 1.5;
          color: var(--text-secondary);
          opacity: 0;
          transform: translateY(20px);
        }

        .hero-description.animate-in {
          animation: fadeInUp 0.6s ease forwards;
          animation-delay: 0.3s;
        }

        .hero-cta {
          margin-top: var(--spacing-xl);
          opacity: 0;
          transform: translateY(20px);
        }

        .hero-cta.animate-in {
          animation: fadeInUp 0.6s ease forwards;
          animation-delay: 0.4s;
        }

        .cta-button {
          display: inline-block;
          padding: 16px 32px;
          background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
          color: white;
          border-radius: var(--radius-md);
          font-size: 16px;
          font-weight: 600;
          text-decoration: none;
          transition: all 0.3s ease;
          box-shadow: 0 4px 14px 0 rgba(67, 233, 123, 0.4);
        }

        .cta-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px 0 rgba(67, 233, 123, 0.5);
        }

        @keyframes fadeInUp {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .incubation-stages {
          padding: var(--spacing-4xl) var(--spacing-xl);
          background: var(--bg-primary);
        }

        .stages-content {
          max-width: 1200px;
          margin: 0 auto;
        }

        .stages-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: var(--spacing-xl);
        }

        .stage-card {
          background: var(--bg-secondary);
          padding: var(--spacing-2xl);
          border-radius: var(--radius-lg);
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
          border: 1px solid transparent;
        }

        .stage-card:hover {
          transform: translateY(-8px);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15);
          border-color: var(--border-light);
        }

        .stage-glow {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 120px;
          opacity: 0;
          transition: opacity 0.4s ease;
          pointer-events: none;
        }

        .stage-card:hover .stage-glow {
          opacity: 1;
        }

        .stage-number {
          font-size: 56px;
          font-weight: 700;
          color: var(--border);
          line-height: 1;
          margin-bottom: var(--spacing-md);
          position: relative;
          z-index: 1;
        }

        .stage-icon {
          width: 56px;
          height: 56px;
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          margin-bottom: var(--spacing-lg);
          transition: transform 0.4s ease;
          position: relative;
          z-index: 1;
        }

        .stage-card:hover .stage-icon {
          transform: scale(1.1) rotate(-5deg);
        }

        .stage-title {
          font-size: 22px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-sm);
          position: relative;
          z-index: 1;
        }

        .stage-description {
          font-size: 15px;
          line-height: 1.6;
          color: var(--text-secondary);
          margin-bottom: var(--spacing-lg);
          position: relative;
          z-index: 1;
        }

        .stage-features {
          list-style: none;
          padding: 0;
          margin: 0;
          position: relative;
          z-index: 1;
        }

        .stage-features li {
          font-size: 14px;
          color: var(--text-secondary);
          padding: 6px 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .stage-features li::before {
          content: '•';
          color: var(--accent-blue);
          font-weight: bold;
        }

        .pricing {
          padding: var(--spacing-4xl) var(--spacing-xl);
          background: var(--bg-secondary);
        }

        .pricing-content {
          max-width: 1200px;
          margin: 0 auto;
        }

        .pricing-title {
          font-size: 36px;
          font-weight: 700;
          text-align: center;
          color: var(--text-primary);
          margin-bottom: var(--spacing-3xl);
        }

        .pricing-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: var(--spacing-xl);
          align-items: start;
        }

        .pricing-card {
          background: var(--bg-primary);
          padding: var(--spacing-2xl);
          border-radius: var(--radius-lg);
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          border: 2px solid transparent;
          position: relative;
        }

        .pricing-card:hover {
          transform: translateY(-8px);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15);
        }

        .pricing-card.featured {
          border-color: #43e97b;
          transform: scale(1.05);
        }

        .pricing-card.featured:hover {
          transform: scale(1.05) translateY(-8px);
        }

        .pricing-badge {
          position: absolute;
          top: -12px;
          left: 50%;
          transform: translateX(-50%);
          background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
          color: white;
          padding: 4px 16px;
          border-radius: var(--radius-full);
          font-size: 12px;
          font-weight: 600;
        }

        .pricing-header {
          text-align: center;
          margin-bottom: var(--spacing-xl);
        }

        .pricing-name {
          font-size: 24px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-md);
        }

        .pricing-price {
          display: flex;
          align-items: baseline;
          justify-content: center;
          gap: 4px;
        }

        .currency {
          font-size: 24px;
          color: var(--text-secondary);
        }

        .amount {
          font-size: 48px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .period {
          font-size: 16px;
          color: var(--text-secondary);
        }

        .pricing-features {
          list-style: none;
          padding: 0;
          margin: 0 0 var(--spacing-xl);
        }

        .pricing-features li {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 0;
          color: var(--text-secondary);
          font-size: 15px;
        }

        .pricing-features li svg {
          color: #43e97b;
          flex-shrink: 0;
        }

        .pricing-btn {
          width: 100%;
          padding: 14px;
          background: var(--bg-secondary);
          color: var(--text-primary);
          border: 2px solid var(--border);
          border-radius: var(--radius-md);
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .pricing-btn:hover {
          background: var(--border-light);
        }

        .pricing-btn.featured {
          background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
          color: white;
          border: none;
          box-shadow: 0 4px 14px 0 rgba(67, 233, 123, 0.4);
        }

        .pricing-btn.featured:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px 0 rgba(67, 233, 123, 0.5);
        }

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

        @media (max-width: 1024px) {
          .hero {
            padding: 80px var(--spacing-lg) 60px;
          }

          .hero-title {
            font-size: 44px;
          }

          .incubation-stages,
          .pricing {
            padding: var(--spacing-3xl) var(--spacing-lg);
          }

          .pricing-card.featured {
            transform: none;
          }

          .pricing-card.featured:hover {
            transform: translateY(-8px);
          }
        }

        @media (max-width: 768px) {
          .nav-content {
            padding: 0 var(--spacing-md);
          }

          .hero {
            padding: 60px var(--spacing-md) 40px;
          }

          .hero-title {
            font-size: 36px;
          }

          .hero-description {
            font-size: 17px;
          }

          .stages-grid,
          .pricing-grid {
            grid-template-columns: 1fr;
          }

          .incubation-stages,
          .pricing {
            padding: var(--spacing-2xl) var(--spacing-md);
          }

          .pricing-title {
            font-size: 28px;
          }
        }

        @media (prefers-color-scheme: dark) {
          .nav {
            background: rgba(29, 29, 31, 0.8);
          }

          .stage-card,
          .pricing-card {
            background: var(--bg-secondary);
          }

          .hero-badge {
            background: rgba(67, 233, 123, 0.15);
          }
        }
      `}</style>
    </div>
  );
};

export default Incubation;
