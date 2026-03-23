import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const Experience: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <div className="experience-container">
      <nav className="nav">
        <div className="nav-content">
          <Link to="/incubation" className="nav-back">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span>返回孵化页面</span>
          </Link>
          <h1 className="nav-title">创新体验</h1>
          <div style={{ width: '80px' }}></div>
        </div>
      </nav>

      <section className="experience-hero">
        <div className="hero-glow"></div>
        <div className="hero-content">
          <div className={`hero-badge ${isVisible ? 'animate-in' : ''}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
            <span>互动体验</span>
          </div>
          <h2 className={`hero-title ${isVisible ? 'animate-in' : ''}`}>开始您的创新之旅</h2>
          <p className={`hero-description ${isVisible ? 'animate-in' : ''}`}>
            通过我们的互动工具，体验从创意生成到方案落地的全流程，感受创新的力量！
          </p>
        </div>
      </section>

      <section className="experience-tools">
        <div className="tools-content">
          <h2 className="tools-title">体验工具</h2>
          <div className="tools-grid">
            <div className="tool-card">
              <div className="tool-icon" style={{ background: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                  <path d="M2 17l10 5 10-5"/>
                  <path d="M2 12l10 5 10-5"/>
                </svg>
              </div>
              <h3 className="tool-title">创意生成器</h3>
              <p className="tool-description">
                基于AI的创意生成工具，帮助您快速产生创新想法
              </p>
              <button className="tool-button">开始使用</button>
            </div>

            <div className="tool-card">
              <div className="tool-icon" style={{ background: 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
              </div>
              <h3 className="tool-title">方案设计器</h3>
              <p className="tool-description">
                可视化方案设计工具，帮助您构建完整的创新方案
              </p>
              <button className="tool-button">开始使用</button>
            </div>

            <div className="tool-card">
              <div className="tool-icon" style={{ background: 'linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%)' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                  <line x1="8" y1="21" x2="16" y2="21"/>
                  <line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
              </div>
              <h3 className="tool-title">原型制作</h3>
              <p className="tool-description">
                快速原型制作工具，将您的创意转化为可视化原型
              </p>
              <button className="tool-button">开始使用</button>
            </div>

            <div className="tool-card">
              <div className="tool-icon" style={{ background: 'linear-gradient(135deg, #f39c12 0%, #e67e22 100%)' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </div>
              <h3 className="tool-title">团队协作</h3>
              <p className="tool-description">
                团队协作平台，与您的团队一起推进创新项目
              </p>
              <button className="tool-button">开始使用</button>
            </div>
          </div>
        </div>
      </section>

      <section className="experience-steps">
        <div className="steps-content">
          <h2 className="steps-title">体验流程</h2>
          <div className="steps-container">
            <div className="step-item">
              <div className="step-number">1</div>
              <div className="step-content">
                <h3 className="step-title">选择工具</h3>
                <p className="step-description">
                  从我们提供的工具中选择适合您需求的创新工具
                </p>
              </div>
            </div>
            <div className="step-divider"></div>
            <div className="step-item">
              <div className="step-number">2</div>
              <div className="step-content">
                <h3 className="step-title">开始体验</h3>
                <p className="step-description">
                  按照工具指引，开始您的创新体验之旅
                </p>
              </div>
            </div>
            <div className="step-divider"></div>
            <div className="step-item">
              <div className="step-number">3</div>
              <div className="step-content">
                <h3 className="step-title">获取反馈</h3>
                <p className="step-description">
                  完成体验后，获取专业的反馈和改进建议
                </p>
              </div>
            </div>
            <div className="step-divider"></div>
            <div className="step-item">
              <div className="step-number">4</div>
              <div className="step-content">
                <h3 className="step-title">落地实施</h3>
                <p className="step-description">
                  将体验中产生的创意和方案转化为实际行动
                </p>
              </div>
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
        .experience-container {
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

        .experience-hero {
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

        @keyframes fadeInUp {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .experience-tools {
          padding: var(--spacing-4xl) var(--spacing-xl);
          background: var(--bg-primary);
        }

        .tools-content {
          max-width: 1200px;
          margin: 0 auto;
        }

        .tools-title {
          font-size: 36px;
          font-weight: 700;
          text-align: center;
          color: var(--text-primary);
          margin-bottom: var(--spacing-3xl);
        }

        .tools-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: var(--spacing-xl);
        }

        .tool-card {
          background: var(--bg-secondary);
          padding: var(--spacing-2xl);
          border-radius: var(--radius-lg);
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          text-align: center;
          border: 1px solid transparent;
        }

        .tool-card:hover {
          transform: translateY(-8px);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15);
          border-color: var(--border-light);
        }

        .tool-icon {
          width: 64px;
          height: 64px;
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          margin: 0 auto var(--spacing-lg);
          transition: transform 0.4s ease;
        }

        .tool-card:hover .tool-icon {
          transform: scale(1.1) rotate(-5deg);
        }

        .tool-title {
          font-size: 22px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-sm);
        }

        .tool-description {
          font-size: 15px;
          line-height: 1.6;
          color: var(--text-secondary);
          margin-bottom: var(--spacing-xl);
        }

        .tool-button {
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

        .tool-button:hover {
          background: var(--border-light);
        }

        .experience-steps {
          padding: var(--spacing-4xl) var(--spacing-xl);
          background: var(--bg-secondary);
        }

        .steps-content {
          max-width: 1200px;
          margin: 0 auto;
        }

        .steps-title {
          font-size: 36px;
          font-weight: 700;
          text-align: center;
          color: var(--text-primary);
          margin-bottom: var(--spacing-3xl);
        }

        .steps-container {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: var(--spacing-xl);
        }

        .step-item {
          flex: 1;
          min-width: 200px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .step-number {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          font-weight: 700;
          margin-bottom: var(--spacing-md);
        }

        .step-content h3 {
          font-size: 18px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-sm);
        }

        .step-content p {
          font-size: 14px;
          line-height: 1.5;
          color: var(--text-secondary);
        }

        .step-divider {
          width: 40px;
          height: 2px;
          background: var(--border);
          display: none;
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

        @media (min-width: 768px) {
          .step-divider {
            display: block;
          }
        }

        @media (max-width: 1024px) {
          .experience-hero {
            padding: 80px var(--spacing-lg) 60px;
          }

          .hero-title {
            font-size: 44px;
          }

          .experience-tools,
          .experience-steps {
            padding: var(--spacing-3xl) var(--spacing-lg);
          }

          .tools-title,
          .steps-title {
            font-size: 28px;
          }
        }

        @media (max-width: 768px) {
          .nav-content {
            padding: 0 var(--spacing-md);
          }

          .experience-hero {
            padding: 60px var(--spacing-md) 40px;
          }

          .hero-title {
            font-size: 36px;
          }

          .hero-description {
            font-size: 17px;
          }

          .tools-grid {
            grid-template-columns: 1fr;
          }

          .experience-tools,
          .experience-steps {
            padding: var(--spacing-2xl) var(--spacing-md);
          }

          .steps-container {
            flex-direction: column;
            align-items: center;
          }

          .step-item {
            width: 100%;
            max-width: 300px;
          }
        }

        @media (prefers-color-scheme: dark) {
          .nav {
            background: rgba(29, 29, 31, 0.8);
          }

          .tool-card {
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

export default Experience;