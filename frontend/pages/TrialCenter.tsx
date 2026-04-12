import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PanelLeftClose, SquareCheckBig } from 'lucide-react';

const TrialCenter: React.FC = () => {
  const navigate = useNavigate();
  const [isVisible, setIsVisible] = useState(false);
  const [selectedModel, setSelectedModel] = useState('MiniMax-M2.7');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  const tools = [
  {
    id: 1,
    title: '网页获取',
    description: '研读在线论文，产出论文综述的文档',
    icon: (
      <svg width="48" height="48" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="8" width="48" height="48" rx="5" fill="#F5F7FA"/>
        <path d="M20 18h24v4H20zM20 30h16v4H20zM20 42h24v4H20z" fill="#9CA3AF"/>
        <circle cx="36" cy="30" r="8" stroke="#60A5FA" strokeWidth="2"/>
        <path d="M41 35l3 3" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    )
  },
  {
    id: 2,
    title: '调研分析',
    description: '调研多个短视频平台，生成汇报PPT',
    icon: (
      <svg width="48" height="48" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="8" width="48" height="48" rx="5" fill="#F5F7FA"/>
        <rect x="16" y="16" width="32" height="32" rx="4" fill="white" stroke="#E5E7EB"/>
        <rect x="20" y="20" width="12" height="12" rx="2" fill="#F87171"/>
        <path d="M24 26l3 3 6-6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <rect x="20" y="36" width="24" height="4" rx="1" fill="#E5E7EB"/>
      </svg>
    )
  },
  {
    id: 3,
    title: '数据挖掘',
    description: '挖掘市场增长数据，分析数据发展趋势',
    icon: (
      <svg width="48" height="48" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="8" width="48" height="48" rx="5" fill="#F5F7FA"/>
        <rect x="18" y="36" width="8" height="16" rx="2" fill="#60A5FA"/>
        <rect x="28" y="28" width="8" height="24" rx="2" fill="#60A5FA"/>
        <rect x="38" y="20" width="8" height="32" rx="2" fill="#60A5FA"/>
        <circle cx="18" cy="34" r="2" fill="#22C55E"/>
        <circle cx="28" cy="26" r="2" fill="#22C55E"/>
        <circle cx="38" cy="18" r="2" fill="#22C55E"/>
        <path d="M18 34L28 26L38 18" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )
  },
  {
    id: 4,
    title: '文件管理',
    description: '整理本地文件夹，列出Excel清单',
    icon: (
      <svg width="48" height="48" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 20V48a4 4 0 004 4h32a4 4 0 004-4V16a4 4 0 00-4-4H28l-4-4H16a4 4 0 00-4 4v12z" fill="#60A5FA"/>
        <path d="M12 20h36a4 4 0 014 4v24a4 4 0 01-4 4H16a4 4 0 01-4-4V20z" fill="#3B82F6"/>
        <rect x="20" y="32" width="24" height="16" rx="5" fill="white"/>
        <rect x="24" y="36" width="16" height="2" rx="1" fill="#E5E7EB"/>
        <rect x="24" y="40" width="12" height="2" rx="1" fill="#E5E7EB"/>
      </svg>
    )
  }
];

  return (
    <div className="trial-center-container">
      <aside className="sidebar">
        <div className="sidebar-content">
          <div className="sidebar-header">
            <div className="sidebar-logo" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
              <div className="logo-circle">IAC</div>
              <span className="logo-text">IAC Incubator</span>
            </div>
            <div className="sidebar-header-actions">
              <button className="sidebar-action-btn" title="收起侧边栏">
                <PanelLeftClose size={18} strokeWidth={2} />
              </button>
              <button className="sidebar-action-btn" title="新建任务">
                <SquareCheckBig size={18} strokeWidth={2} />
              </button>
            </div>
          </div>

          <button className="new-task-btn-sidebar">
            <SquareCheckBig size={18} strokeWidth={2} />
            新建任务
          </button>

          <div className="sidebar-footer">
            <div 
              className="user-info" 
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              style={{ cursor: 'pointer' }}
            >
              <div className="user-avatar-sidebar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="8" r="4"/>
                  <path d="M4 20c0-4.418 3.582-8 8-8s8 3.582 8 8"/>
                </svg>
              </div>
              <span className="user-name">admin</span>
            </div>
            {isUserMenuOpen && (
              <div className="user-menu">
                <div className="user-menu-header">
                  <div className="user-avatar-large">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="12" cy="8" r="4"/>
                      <path d="M4 20c0-4.418 3.582-8 8-8s8 3.582 8 8"/>
                    </svg>
                  </div>
                  <div className="user-menu-info">
                    <div className="user-menu-name">xueyb</div>
                  </div>
                </div>
                <div className="user-menu-divider"></div>
                <div className="user-menu-item">
                  <span>管理账号</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <polyline points="10 9 9 9 8 9"/>
                  </svg>
                </div>
                <div className="user-menu-item">
                  <span>语言</span>
                  <div className="user-menu-item-right">
                    <span>简体中文</span>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
                <div className="user-menu-item">
                  <span>主题</span>
                  <div className="user-menu-item-right">
                    <span>亮色</span>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
                <div className="user-menu-item">
                  <span>设置</span>
                </div>
                <div className="user-menu-divider"></div>
                <div className="user-menu-item logout">
                  <span>退出登录</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="main-content">
        <div className="main-wrapper">
          <section className="hero-section">
            <div className={`hero-content ${isVisible ? 'animate-in' : ''}`}>
              <h2 className="hero-title">Innovation and Creation</h2>
              <p className="hero-subtitle">激发创新潜能，孵化未来梦想</p>
            </div>
          </section>

          <section className="tools-section">
            <div className="tools-grid">
              {tools.map((tool) => (
                <div key={tool.id} className="tool-card">
                  <div className="tool-icon">
                    {tool.icon}
                  </div>
                  <h3 className="tool-name">{tool.title}</h3>
                  <p className="tool-desc">{tool.description}</p>
                </div>
              ))}
            </div>
          </section>

          <footer className="footer">
            <div className={`input-box ${isInputFocused ? 'focused' : ''}`}>
              <div className="input-area">
                <textarea
                  className="input-textarea"
                  placeholder="帮你整理论文综述、编写 PPT、分析 Excel 等日常工作，输出专业级工作成果。"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onFocus={() => setIsInputFocused(true)}
                  onBlur={() => setIsInputFocused(false)}
                  rows={1}
                />
              </div>
              <div className="toolbar">
                <div className="toolbar-left">
                  <div className="project-selector">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    <span>选择项目</span>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <div className="toolbar-icons">
                    <div className="toolbar-icon" title="代码块">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <path d="M9 12L7 10L9 8" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M15 12L17 10L15 8" strokeLinecap="round" strokeLinejoin="round"/>
                        <line x1="13" y1="7" x2="11" y2="13" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <div className="toolbar-icon" title="上传文件">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                      </svg>
                    </div>
                  </div>
                </div>
                <div className="toolbar-right">
                  <div className="model-selector">
                    <div 
                      className="model-selector-trigger"
                      onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                    >
                      <span>{selectedModel}</span>
                      <svg 
                        width="10" 
                        height="10" 
                        viewBox="0 0 10 10" 
                        fill="none"
                        style={{ transform: isModelDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                      >
                        <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    {isModelDropdownOpen && (
                      <div className="model-dropdown">
                        <div className="model-option" onClick={() => { setSelectedModel('MiniMax-M2.7'); setIsModelDropdownOpen(false); }}>MiniMax-M2.7</div>
                        <div className="model-option" onClick={() => { setSelectedModel('GPT-4'); setIsModelDropdownOpen(false); }}>GPT-4</div>
                        <div className="model-option" onClick={() => { setSelectedModel('Claude-3'); setIsModelDropdownOpen(false); }}>Claude-3</div>
                      </div>
                    )}
                  </div>
                  <button className={`send-btn ${inputValue.trim() ? 'active' : ''}`} disabled={!inputValue.trim()}>
                    <svg width="18" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 19V5M12 5L5 12M12 5L19 12"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </footer>
        </div>
      </main>

      <style>{`
        .trial-center-container {
          min-height: 100vh;
          display: flex;
          background: #EEF0F2;
        }

        .sidebar {
          width: 230px;
          background: #E9EAEB;
          border-right: none;
          display: flex;
          flex-direction: column;
          position: relative;
        }

        .sidebar-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 20px 10px 20px 12px;
          background: #EEEFF2;
          width: 230px;
        }

        .sidebar-header {
          display: flex;
          align-items: center;
          gap: 11px;
          margin-bottom: 32px;
        }

        .sidebar-logo {
          display: flex;
          align-items: center;
          gap: 7px;
          flex: 1;
        }

        .logo-circle {
          width: 25px;
          height: 25px;
          border-radius: 50%;
          background: linear-gradient(135deg, #60A5FA 0%, #3B82F6 100%);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
        }

        .logo-text {
          font-size: 13px;
          font-weight: 500;
          color: #333;
        }

        .sidebar-header-actions {
          display: flex;
          align-items: center;
          gap: 0;
          margin-right: -8px;
        }

        .sidebar-action-btn {
          width: 27px;
          height: 27px;
          border: none;
          border-radius: 3px;
          background: transparent;
          color: #6B7280;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
        }

        .sidebar-action-btn:hover {
          background: #E5E7EB;
          color: #374151;
        }

        .new-task-btn-sidebar {
          width: 100%;
          height: 36px;
          padding: 10px;
          background: #DEE0E4;
          color: #666;
          border: none;
          border-radius: 3px;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
          font-family: inherit;
          text-align: left;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .new-task-btn-sidebar:hover {
          background: #C8C9CA;
        }

        .sidebar-footer {
          margin-top: auto;
          position: relative;
        }

        .user-info {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          border-radius: 3px;
          transition: background 0.2s;
        }

        .user-info:hover {
          background: #F5F5F5;
        }

        .user-avatar-sidebar {
          width: 32px;
          height: 32px;
          background: white;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #666;
        }

        .user-name {
          font-size: 14px;
          color: #333;
        }

        .user-menu {
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translate(-50%, -8px);
          width: 210px;
          background: white;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          margin-bottom: 8px;
          z-index: 1000;
        }

        .user-menu-header {
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .user-avatar-large {
          width: 40px;
          height: 40px;
          background: linear-gradient(135deg, #60A5FA 0%, #3B82F6 100%);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .user-menu-info {
          flex: 1;
        }

        .user-menu-name {
          font-size: 14px;
          font-weight: 500;
          color: #333;
        }

        .user-menu-divider {
          height: 1px;
          background: #E5E7EB;
        }

        .user-menu-item {
          padding: 12px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 14px;
          color: #666;
          cursor: pointer;
          transition: background 0.2s;
        }

        .user-menu-item:hover {
          background: #F9FAFB;
        }

        .user-menu-item-right {
          display: flex;
          align-items: center;
          gap: 4px;
          color: #999;
        }

        .user-menu-item.logout {
          color: #EF4444;
        }

        .user-menu-item.logout:hover {
          background: #FEF2F2;
        }

        .main-content {
          flex: 1;
          padding: 5px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #EEEFF2;
        }

        .main-wrapper {
          background: white;
          border-radius: 8px;
          border: none;
          box-shadow: 3px 4px 6px -1px rgba(0, 0, 0, 0.1), 3px 2px 4px -1px rgba(0, 0, 0, 0.06);
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          padding: 8px;
        }

        .hero-section {
          text-align: center;
          margin-bottom: 0px;
        }

        .hero-content {
          opacity: 0;
          transform: translateY(20px);
        }

        .hero-content.animate-in {
          animation: fadeInUp 0.6s ease forwards;
          margin-top: 160px;
          margin-bottom: 125px;
        }

        @keyframes fadeInUp {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .hero-title {
          font-size: 42px;
          font-weight: 600;
          color: #333;
          margin-bottom: 15px;
        }

        .hero-subtitle {
          font-size: 16px;
          color: #666;
          font-weight: 400;
        }

        .tools-section {
          margin-bottom: 20px;
        }

        .tools-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          width: 880px;
          max-width: 100%;
          margin: 0 auto;
          margin-top: 50px;
        }

        .tool-card {
          background: white;
          padding: 24px 16px;
          border-radius: 5px;
          text-align: left;
          border: 1px solid #F0F0F0;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .tool-card:hover {
          border-color: #E0E0E0;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        }

        .tool-icon {
          margin-bottom: 16px;
        }

        .tool-name {
          font-size: 15px;
          font-weight: 600;
          color: #333;
          margin-bottom: 6px;
        }

        .tool-desc {
          font-size: 12px;
          line-height: 1.5;
          color: #999;
        }

        .footer {
          margin-top: auto;
          display: flex;
          justify-content: center;
        }

        .input-box {
          background: white;
          border-radius: 8px;
          border: 1px solid rgba(0, 0, 0, 0.08);
          box-shadow: 0 2px 16px rgba(0, 0, 0, 0.06);
          transition: all 0.2s ease;
          width: 880px;
          max-width: 100%;
          margin-bottom: 60px;
        }

        .input-box.focused {
          border-color: rgba(139, 92, 246, 0.3);
          box-shadow: 0 2px 20px rgba(139, 92, 246, 0.12);
        }

        .input-area {
          padding: 16px 20px 12px;
          border-radius: 5px 5px 0 0;
          height: 100px;
          border-bottom: none;
        }

        .input-textarea {
          width: 100%;
          min-height: 24px;
          max-height: 200px;
          border: none;
          outline: none;
          resize: none;
          font-size: 14px;
          line-height: 1.6;
          color: #333;
          font-family: inherit;
          background: transparent;
        }

        .input-textarea::placeholder {
          color: #999;
        }

        .toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 20px;
          border-top: none;
          border-radius: 0 0 5px 5px;
          height: 55px;
        }

        .toolbar-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .project-selector {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          background: #F5F5F5;
          border-radius: 3px;
          cursor: pointer;
          color: #666;
          font-size: 12px;
          transition: all 0.2s;
          height: 32px;
        }

        .project-selector:hover {
          background: #EBEBEB;
        }

        .toolbar-icons {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .toolbar-icon {
          width: 32px;
          height: 32px;
          background: transparent;
          border-radius: 3px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #999;
          cursor: pointer;
          transition: all 0.2s;
        }

        .toolbar-icon:hover {
          background: #F5F5F5;
          color: #666;
        }

        .toolbar-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .model-selector {
          position: relative;
        }

        .model-selector-trigger {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          background: transparent;
          border: none;
          border-radius: 3px;
          cursor: pointer;
          font-size: 12px;
          color: #666;
          font-family: inherit;
          transition: all 0.2s;
          height: 32px;
        }

        .model-selector-trigger:hover {
          color: #333;
          background: #F5F5F5;
        }

        .model-dropdown {
          position: absolute;
          bottom: 100%;
          right: 0;
          margin-bottom: 4px;
          background: white;
          border: 1px solid #E5E7EB;
          border-radius: 8px;
          box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.12);
          min-width: 140px;
          z-index: 10;
        }

        .model-option {
          padding: 10px 14px;
          cursor: pointer;
          font-size: 13px;
          color: #333;
          transition: background 0.15s;
        }

        .model-option:hover {
          background: #F5F5F5;
        }

        .send-btn {
          width: 30px;
          height: 30px;
          background: #E5E5E5;
          border: none;
          border-radius: 3px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #999;
          cursor: not-allowed;
          transition: all 0.2s;
        }

        .send-btn.active {
          background: #A78BFA;
          color: white;
          cursor: pointer;
        }

        .send-btn.active:hover {
          background: #8B5CF6;
        }

        @media (max-width: 1024px) {
          .tools-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 768px) {
          .trial-center-container {
            flex-direction: column;
          }

          .sidebar {
            width: 100%;
            border-right: none;
            border-bottom: 1px solid #D1D1D1;
          }

          .sidebar-content {
            padding: 12px 16px;
          }

          .main-wrapper {
            padding: 24px 20px;
          }

          .tools-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (prefers-color-scheme: dark) {
          .trial-center-container {
            background: #1C1C1F;
          }

          .sidebar {
            background: #2C2C2E;
            border-color: #3A3A3C;
          }

          .sidebar-content,
          .main-content {
            background: #1C1C1F;
          }

          .new-task-btn-sidebar,
          .user-avatar-sidebar,
          .main-wrapper,
          .tool-card,
          .input-box,
          .model-dropdown,
          .project-selector {
            background: #3A3A3C;
            border-color: #48484A;
          }

          .logo-text,
          .hero-title,
          .tool-name,
          .model-option {
            color: #F5F5F7;
          }

          .new-task-btn-sidebar,
          .user-name,
          .hero-subtitle,
          .model-selector-trigger,
          .project-selector,
          .toolbar-icon,
          .input-textarea {
            color: #D1D1D6;
          }

          .input-textarea::placeholder {
            color: #98989D;
          }

          .tool-desc {
            color: #98989D;
          }

          .new-task-btn-sidebar:hover {
            background: #48484A;
          }

          .model-option:hover {
            background: #48484A;
          }

          .project-selector:hover {
            background: #48484A;
          }

          .toolbar-icon:hover {
            background: #48484A;
          }

          .send-btn {
            background: #48484A;
          }

          .send-btn.active {
            background: #7C3AED;
          }

          .send-btn.active:hover {
            background: #6D28D9;
          }
        }
      `}</style>
    </div>
  );
};

export default TrialCenter;
