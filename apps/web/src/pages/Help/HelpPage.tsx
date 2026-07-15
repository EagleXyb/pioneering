/**
 * 帮助与反馈页 —— 严格参照 apps/web/docs/help-feedback.html 原型一比一还原
 * 布局：900×600 浮动窗口，左侧 230px 导航 + 右侧内容区
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { MessagePlugin } from 'tdesign-react';
import './help.css';

/* ===== 导航分类（SVG 图标从原型 exact copy） ===== */
const NAV_SECTIONS = [
  {
    id: 'account',
    label: '账户管理',
    icon: (
      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    id: 'system',
    label: '系统设置',
    icon: (
      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    id: 'agent',
    label: '智能体设置',
    icon: (
      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
        <path d="M9 19h6v2H9z" />
      </svg>
    ),
  },
  {
    id: 'shortcut',
    label: '快捷键',
    icon: (
      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <path d="M6 10h.01" />
        <path d="M10 10h.01" />
        <path d="M14 10h.01" />
        <path d="M18 10h.01" />
      </svg>
    ),
  },
  {
    id: 'memory',
    label: '记忆',
    icon: (
      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.663 17h4.673M12 3v1M6.343 4.343l-.707-.707M18.364 4.343l.707-.707M4 12h1M20 12h1M12 18.5a1.5 1.5 0 0 1-1.5-1.5c0-1.5 2-3 2-5.5 0-1.5-1-2.5-2.5-2.5S7.5 10 7.5 12c0 2.5 2 4 2 5.5a1.5 1.5 0 0 1-1.5 1.5h-3C4.5 19 4 18.5 4 18s.5-1 1-1h.5A7.5 7.5 0 0 1 12 5.5a7.5 7.5 0 0 1 6.5 11h.5c.5 0 1 .5 1 1s-.5 1-1 1h-3a1.5 1.5 0 0 1-1.5-1.5z" />
      </svg>
    ),
  },
  {
    id: 'model',
    label: '模型',
    icon: (
      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21 16.75-4.14-2.4a.74.74 0 0 0-.72 0l-4.83 2.8a.74.74 0 0 1-.72 0L5.71 14.3a.74.74 0 0 0-.71 0L2 16.36V6.12a.76.76 0 0 1 .38-.65l4.14-2.39a.74.74 0 0 1 .72 0l4.83 2.8a.74.74 0 0 0 .72 0l4.83-2.8a.74.74 0 0 1 .72 0l4.14 2.39a.76.76 0 0 1 .38.65v10.63z" />
        <path d="m2 6 9 5.25" />
        <path d="M12 16.5 3 11.25" />
        <path d="m12 16.5 9-5.25" />
        <path d="M12 16.5V7.5" />
      </svg>
    ),
  },
  {
    id: 'assistant',
    label: '助理设置',
    icon: (
      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    id: 'personalize',
    label: '个性化',
    icon: (
      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
        <path d="M5 3v4" />
        <path d="M19 17v4" />
        <path d="M3 5h4" />
        <path d="M17 19h4" />
      </svg>
    ),
  },
  {
    id: 'data',
    label: '数据管理',
    icon: (
      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="6" rx="2" />
        <path d="M6 9v11" />
        <path d="M18 9v11" />
        <path d="M6 15h12a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2Z" />
      </svg>
    ),
  },
  {
    id: 'security',
    label: '安全中心',
    icon: (
      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    id: 'help',
    label: '帮助与反馈',
    icon: (
      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
] as const;

type NavId = (typeof NAV_SECTIONS)[number]['id'];

export default function HelpPage() {
  const navigate = useNavigate();
  const [active, setActive] = useState<NavId>('help');

  const handleClose = () => navigate('/chat');

  const handleSelectNav = (id: NavId) => {
    if (id === 'help') return;
    setActive(id);
    MessagePlugin.info('该分类暂未开放');
  };

  return (
    <div className="help-page">
      <div className="window">
        {/* 左侧分类导航 */}
        <aside className="sidebar">
          <ul className="nav-list">
            {NAV_SECTIONS.map((s) => (
              <li
                key={s.id}
                className={`nav-item${active === s.id ? ' nav-item--active' : ''}`}
                onClick={() => handleSelectNav(s.id)}
              >
                {s.icon}
                {s.label}
              </li>
            ))}
          </ul>
        </aside>

        {/* 右侧内容区 */}
        <main className="main">
          {/* 关闭按钮 */}
          <div className="close-btn" onClick={handleClose} aria-label="关闭">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>

          <h1 className="page-title">帮助与反馈</h1>

          <ul className="help-list">
            {/* 帮助文档 */}
            <li className="help-item" onClick={() => window.open('https://example.com/docs', '_blank')}>
              <span className="help-item__left">
                <svg className="help-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                帮助文档
              </span>
              <svg className="help-item__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </li>

            {/* 意见反馈 */}
            <li className="help-item" onClick={() => MessagePlugin.info('意见反馈功能正在建设中')}>
              <span className="help-item__left">
                <svg className="help-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                意见反馈
              </span>
            </li>

            {/* 联系我们 */}
            <li className="help-item" onClick={() => window.open('mailto:support@example.com', '_blank')}>
              <span className="help-item__left">
                <svg className="help-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                联系我们
              </span>
              <svg className="help-item__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </li>
          </ul>

          <div className="help-footer">
            <a href="#" onClick={(e) => { e.preventDefault(); MessagePlugin.info('隐私政策'); }}>隐私政策</a>
            <span className="help-footer__divider">|</span>
            <a href="#" onClick={(e) => { e.preventDefault(); MessagePlugin.info('服务协议'); }}>服务协议</a>
          </div>
        </main>
      </div>
    </div>
  );
}
