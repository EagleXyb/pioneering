import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const Training: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <div className="training-container">
      <nav className="nav">
        <div className="nav-content">
          <Link to="/" className="nav-back">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span>返回首页</span>
          </Link>
          <h1 className="nav-title">创新能力训练</h1>
          <div style={{ width: '80px' }}></div>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-glow"></div>
        <div className="hero-content">
          <div className={`hero-badge ${isVisible ? 'animate-in' : ''}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <polygon points="10 8 16 12 10 16 10 8"/>
            </svg>
            <span>系统训练</span>
          </div>
          <h2 className={`hero-title ${isVisible ? 'animate-in' : ''}`}>激活创新思维</h2>
          <p className={`hero-description ${isVisible ? 'animate-in' : ''}`}>
            面向创新场景深度优化的训练模型，让创新思维更灵活，在多样化的创新任务中具备执行能力
          </p>
        </div>
      </section>

      <section className="training-courses">
        <div className="courses-content">
          <div className="course-grid">
            <div className="course-card">
              <div className="course-glow" style={{ background: 'radial-gradient(circle at 0% 0%, rgba(36, 144, 248, 0.4) 0%, transparent 60%)' }}></div>
              <div className="course-header">
                <div className="course-icon" style={{ background: '#2490f8' }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 19l7-7 3 3-7 7-3-3z"/>
                    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
                    <path d="M2 2l7.586 7.586"/>
                    <circle cx="11" cy="11" r="2"/>
                  </svg>
                </div>
                <div className="course-level">初级</div>
              </div>
              <h3 className="course-title">发散思维入门</h3>
              <p className="course-description">
                学习基础的发散思维技巧，培养多角度思考问题的能力
              </p>
              <div className="course-meta">
                <span className="meta-item">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  3小时
                </span>
                <span className="meta-item">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                  12节课
                </span>
              </div>
              <button className="course-btn">开始学习</button>
            </div>

            <div className="course-card">
              <div className="course-glow" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(155, 89, 182, 0.4) 0%, transparent 60%)' }}></div>
              <div className="course-header">
                <div className="course-icon" style={{ background: 'linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%)' }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                </div>
                <div className="course-level" style={{ background: 'linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%)' }}>中级</div>
              </div>
              <h3 className="course-title">创造性问题解决</h3>
              <p className="course-description">
                掌握系统化的创新问题解决方法论，突破思维定式
              </p>
              <div className="course-meta">
                <span className="meta-item">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  5小时
                </span>
                <span className="meta-item">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                  18节课
                </span>
              </div>
              <button className="course-btn" style={{ background: 'linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%)', boxShadow: '0 4px 14px 0 rgba(155, 89, 182, 0.4)' }}>开始学习</button>
            </div>

            <div className="course-card">
              <div className="course-glow" style={{ background: 'radial-gradient(circle at 100% 0%, rgba(243, 156, 18, 0.4) 0%, transparent 60%)' }}></div>
              <div className="course-header">
                <div className="course-icon" style={{ background: 'linear-gradient(135deg, #f39c12 0%, #e67e22 100%)' }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                  </svg>
                </div>
                <div className="course-level" style={{ background: 'linear-gradient(135deg, #f39c12 0%, #e67e22 100%)' }}>高级</div>
              </div>
              <h3 className="course-title">创新领导力</h3>
              <p className="course-description">
                培养团队创新领导力，打造持续创新的组织文化
              </p>
              <div className="course-meta">
                <span className="meta-item">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  8小时
                </span>
                <span className="meta-item">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                  24节课
                </span>
              </div>
              <button className="course-btn" style={{ background: 'linear-gradient(135deg, #f39c12 0%, #e67e22 100%)', boxShadow: '0 4px 14px 0 rgba(243, 156, 18, 0.4)' }}>开始学习</button>
            </div>
          </div>
        </div>
      </section>

      <section className="features">
        <div className="features-content">
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
              <h4>专业课程</h4>
              <p>由创新专家精心设计</p>
            </div>
          </div>
          <div className="feature-item">
            <div className="feature-icon-circle">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            </div>
            <div className="feature-text">
              <h4>渐进学习</h4>
              <p>从基础到高级循序渐进</p>
            </div>
          </div>
          <div className="feature-item">
            <div className="feature-icon-circle">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12.01" y2="18"/>
              </svg>
            </div>
            <div className="feature-text">
              <h4>实践演练</h4>
              <p>理论结合实际案例</p>
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
        .training-container {
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
          color: #2490f8;
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

        .training-courses {
          padding: var(--spacing-4xl) var(--spacing-xl);
          background: var(--bg-primary);
        }

        .courses-content {
          max-width: 1200px;
          margin: 0 auto;
        }

        .course-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: var(--spacing-xl);
        }

        .course-card {
          background: var(--bg-secondary);
          padding: var(--spacing-2xl);
          border-radius: var(--radius-lg);
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
          border: 1px solid transparent;
          display: flex;
          flex-direction: column;
        }

        .course-card:hover {
          transform: translateY(-8px);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15);
          border-color: var(--border-light);
        }

        .course-glow {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 120px;
          opacity: 0;
          transition: opacity 0.4s ease;
          pointer-events: none;
        }

        .course-card:hover .course-glow {
          opacity: 1;
        }

        .course-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: var(--spacing-lg);
          position: relative;
          z-index: 1;
        }

        .course-icon {
          width: 56px;
          height: 56px;
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          transition: transform 0.4s ease;
        }

        .course-card:hover .course-icon {
          transform: scale(1.1) rotate(-5deg);
        }

        .course-level {
          padding: 4px 12px;
          background: #2490f8;
          color: white;
          border-radius: var(--radius-full);
          font-size: 12px;
          font-weight: 600;
        }

        .course-title {
          font-size: 22px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-sm);
          position: relative;
          z-index: 1;
        }

        .course-description {
          font-size: 15px;
          line-height: 1.6;
          color: var(--text-secondary);
          margin-bottom: var(--spacing-lg);
          position: relative;
          z-index: 1;
          flex: 1;
        }

        .course-meta {
          display: flex;
          gap: var(--spacing-lg);
          margin-bottom: var(--spacing-lg);
          position: relative;
          z-index: 1;
        }

        .meta-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 14px;
          color: var(--text-secondary);
        }

        .course-btn {
          width: 100%;
          padding: 12px;
          background: #2490f8;
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 4px 14px 0 rgba(36, 144, 248, 0.4);
          position: relative;
          z-index: 1;
        }

        .course-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px 0 rgba(36, 144, 248, 0.5);
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
          border-radius: var(--radius-lg);
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

          .training-courses {
            padding: var(--spacing-3xl) var(--spacing-lg);
          }

          .features {
            padding: var(--spacing-2xl) var(--spacing-lg);
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

          .course-grid {
            grid-template-columns: 1fr;
          }

          .training-courses,
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

          .course-card {
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

export default Training;
