import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const Assessment: React.FC = () => {
  const navigate = useNavigate();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  const handleBasicAssessment = () => {
    navigate('/basic-assessment');
  };

  return (
    <div className="assessment-container">
      <nav className="nav">
        <div className="nav-content">
          <Link to="/" className="nav-back">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span>返回首页</span>
          </Link>
          <h1 className="nav-title">创新能力测评</h1>
          <div style={{ width: '80px' }}></div>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-glow"></div>
        <div className="hero-content">
          <div className={`hero-badge ${isVisible ? 'animate-in' : ''}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <span>专业评估</span>
          </div>
          <h2 className={`hero-title ${isVisible ? 'animate-in' : ''}`}>发现您的创新潜能</h2>
          <p className={`hero-description ${isVisible ? 'animate-in' : ''}`}>
            智谱新一代测评模型，全面评估您的创新能力维度，提供个性化发展建议
          </p>
        </div>
      </section>

      <section className="process">
        <div className="process-content">
          <div className="steps">
            <div className="step-card" onClick={handleBasicAssessment} style={{ cursor: 'pointer' }}>
              <div className="step-glow" style={{ background: 'radial-gradient(circle at 0% 0%, rgba(36, 144, 248, 0.4) 0%, transparent 60%)' }}></div>
              <div className="step-header">
                <div className="step-icon" style={{ background: '#2490f8' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    <polyline points="2 17 12 22 22 17"/>
                    <polyline points="2 12 12 17 22 12"/>
                  </svg>
                </div>
                <div className="step-number">01</div>
              </div>
              <h4 className="step-title">基础评估</h4>
              <p className="step-description">
                评估您的创新思维基础能力，了解您的创新意识、好奇心和开放性思维
              </p>
            </div>

            <div className="step-card">
              <div className="step-glow" style={{ background: 'radial-gradient(circle at 100% 0%, rgba(36, 144, 248, 0.4) 0%, transparent 60%)' }}></div>
              <div className="step-header">
                <div className="step-icon" style={{ background: '#2490f8' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                </div>
                <div className="step-number">02</div>
              </div>
              <h4 className="step-title">能力测试</h4>
              <p className="step-description">
                通过一系列精心设计的测试题，评估您的发散性思维、问题解决和创造性表达能力
              </p>
            </div>

            <div className="step-card">
              <div className="step-glow" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(36, 144, 248, 0.4) 0%, transparent 60%)' }}></div>
              <div className="step-header">
                <div className="step-icon" style={{ background: '#2490f8' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                    <path d="M9 12h6M12 9v6"/>
                  </svg>
                </div>
                <div className="step-number">03</div>
              </div>
              <h4 className="step-title">结果分析</h4>
              <p className="step-description">
                生成详细的创新能力评估报告，提供针对性的提升建议和发展路径
              </p>
            </div>
          </div>

          <div className="process-cta">
            <button className="btn-primary" onClick={handleBasicAssessment}>
              <span>开始测评</span>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M7 4L13 10L7 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>
      </section>

      <section className="features">
        <div className="features-content">
          <div className="feature-item">
            <div className="feature-icon-circle">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div className="feature-text">
              <h4>快速便捷</h4>
              <p>约 15 分钟完成全部测评</p>
            </div>
          </div>
          <div className="feature-item">
            <div className="feature-icon-circle">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <div className="feature-text">
              <h4>科学准确</h4>
              <p>基于专业心理学模型</p>
            </div>
          </div>
          <div className="feature-item">
            <div className="feature-icon-circle">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
            <div className="feature-text">
              <h4>个性定制</h4>
              <p>针对性的发展建议</p>
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
        .assessment-container {
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
          background: radial-gradient(circle at 50% 0%, rgba(36, 144, 248, 0.15) 0%, transparent 60%);
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
          background: rgba(36, 144, 248, 0.1);
          color: #1a7de6;
          border-radius: 8px;
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

        @keyframes fadeInUp {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .process {
          padding: var(--spacing-4xl) var(--spacing-xl);
          background: var(--bg-primary);
        }

        .process-content {
          max-width: 1400px;
          margin: 0 auto;
        }

        .steps {
          display: flex;
          justify-content: center;
          gap: calc(var(--spacing-lg) - 3px);
          margin-bottom: var(--spacing-3xl);
          flex-wrap: nowrap;
        }

        .step-card {
          background: var(--bg-secondary);
          padding: var(--spacing-2xl);
          border-radius: 8px;
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
          border: 1px solid transparent;
          flex: 1;
          min-width: 300px;
        }

        .step-card:hover {
          transform: translateY(-8px);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15);
          border-color: var(--border-light);
        }

        .step-glow {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 120px;
          opacity: 0;
          transition: opacity 0.4s ease;
          pointer-events: none;
        }

        .step-card:hover .step-glow {
          opacity: 1;
        }

        .step-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: var(--spacing-lg);
          position: relative;
          z-index: 1;
        }

        .step-icon {
          width: 52px;
          height: 52px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          transition: transform 0.4s ease;
        }

        .step-card:hover .step-icon {
          transform: scale(1.1) rotate(-5deg);
        }

        .step-number {
          font-size: 48px;
          font-weight: 700;
          color: var(--border);
          line-height: 1;
        }

        .step-title {
          font-size: 22px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-sm);
          position: relative;
          z-index: 1;
        }

        .step-description {
          font-size: 15px;
          line-height: 1.6;
          color: var(--text-secondary);
          position: relative;
          z-index: 1;
        }

        .process-cta {
          display: flex;
          justify-content: center;
        }

        .btn-primary {
          display: inline-flex;
          align-items: center;
          gap: var(--spacing-sm);
          padding: 14px 36px;
          background: #2490f8;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 17px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 4px 14px 0 rgba(36, 144, 248, 0.4);
        }

        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px 0 rgba(36, 144, 248, 0.5);
        }

        .btn-primary svg {
          transition: transform 0.3s ease;
        }

        .btn-primary:hover svg {
          transform: translateX(4px);
        }

        .features {
          padding: var(--spacing-3xl) var(--spacing-xl);
          background: var(--bg-secondary);
        }

        .features-content {
          max-width: 980px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: var(--spacing-xl);
        }

        .feature-item {
          display: flex;
          align-items: center;
          gap: var(--spacing-md);
          padding: var(--spacing-xl);
          border-radius: 8px;
          transition: all 0.3s ease;
        }

        .feature-item:hover {
          background: var(--bg-primary);
        }

        .feature-icon-circle {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: #2490f8;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          flex-shrink: 0;
          transition: transform 0.3s ease;
        }

        .feature-item:hover .feature-icon-circle {
          transform: scale(1.1);
        }

        .feature-text h4 {
          font-size: 17px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-xs);
        }

        .feature-text p {
          font-size: 14px;
          color: var(--text-secondary);
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

          .process {
            padding: var(--spacing-3xl) var(--spacing-lg);
          }

          .features {
            padding: var(--spacing-2xl) var(--spacing-lg);
          }
        }

        @media (max-width: 1400px) {
          .steps {
            flex-wrap: wrap;
            gap: calc(var(--spacing-lg) - 3px);
          }

          .step-card {
            flex: 1 1 calc(33.333% - (var(--spacing-lg) - 3px));
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

          .steps {
            flex-direction: column;
          }

          .step-card {
            flex: 1 1 100%;
          }

          .process,
          .features {
            padding: var(--spacing-2xl) var(--spacing-md);
          }

          .features-content {
            grid-template-columns: 1fr;
          }

          .feature-item {
            flex-direction: column;
            text-align: center;
          }
        }

        @media (prefers-color-scheme: dark) {
          .nav {
            background: rgba(29, 29, 31, 0.8);
          }

          .step-card {
            background: var(--bg-secondary);
          }

          .hero-badge {
            background: rgba(36, 144, 248, 0.15);
          }
        }
      `}</style>
    </div>
  );
};

export default Assessment;
