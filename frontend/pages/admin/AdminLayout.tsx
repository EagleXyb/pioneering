// 公共布局组件 - 顶部导航和侧边栏

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '../../contexts/UserContext';
import { NavSection, NavSectionConfig } from './types';

// 图标组件
const Icons = {
  Lock: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  ),
  Box: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    </svg>
  ),
  List: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="8" y1="6" x2="21" y2="6"/>
      <line x1="8" y1="12" x2="21" y2="12"/>
      <line x1="8" y1="18" x2="21" y2="18"/>
      <line x1="3" y1="6" x2="3.01" y2="6"/>
      <line x1="3" y1="12" x2="3.01" y2="12"/>
      <line x1="3" y1="18" x2="3.01" y2="18"/>
    </svg>
  ),
  Settings: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  Info: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 16v-4"/>
      <path d="M12 8h.01"/>
    </svg>
  ),
  Search: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8"/>
      <path d="M21 21l-4.35-4.35"/>
    </svg>
  ),
  Layers: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
      <path d="M2 17l10 5 10-5"/>
      <path d="M2 12l10 5 10-5"/>
    </svg>
  ),
  CheckCircle: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
  ),
  FileText: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  ),
  Activity: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>
  ),
  Zap: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  Globe: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="2" y1="12" x2="22" y2="12"></line>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
    </svg>
  ),
  Users: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  Logo: () => (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <path d="M12 2L2 7l10 5 10-5-10-5z" fill="currentColor"/>
      <path d="M2 17l10 5 10-5" stroke="currentColor" strokeWidth="2"/>
      <path d="M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2"/>
    </svg>
  ),
};

interface AdminLayoutProps {
  activeSection: NavSection;
  activeNavItem: string;
  onNavItemClick: (section: NavSection, itemKey: string) => void;
  children: React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  activeSection,
  activeNavItem,
  onNavItemClick,
  children,
}) => {
  const { userState } = useUser();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    model: true,
    prompt: true,
    users: true,
    security: true,
  });
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const languageDropdownRef = React.useRef<HTMLDivElement>(null);

  const toggleSection = (sectionKey: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  };

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
      if (languageDropdownRef.current && !languageDropdownRef.current.contains(event.target as Node)) {
        setShowLanguageDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navSections: NavSectionConfig[] = [
    {
      key: 'model',
      label: '模型管理',
      items: [
        { key: 'config', label: 'API Key 配置', icon: <Icons.Lock /> },
        { key: 'provider', label: '服务商管理', icon: <Icons.Box /> },
        { key: 'model-list', label: '模型列表', icon: <Icons.List /> },
      ],
    },
    {
          key: 'prompt',
          label: 'Prompt 管理',
          items: [
            { key: 'global-settings', label: '全局设置', icon: <Icons.Settings /> },
            { key: 'perception', label: '问题感知模块', icon: <Icons.Info /> },
            { key: 'retrieval', label: '知识检索模块', icon: <Icons.Search /> },
            { key: 'generation', label: '创意生成模块', icon: <Icons.Layers /> },
            { key: 'evaluation', label: '评估反馈模块', icon: <Icons.CheckCircle /> },
          ],
        },
    {
      key: 'users',
      label: '用户管理',
      items: [
        { key: 'user-list', label: '用户列表', icon: <Icons.Users /> },
      ],
    },
    {
      key: 'security',
      label: '安全管理',
      items: [
        { key: 'access-log', label: '访问日志', icon: <Icons.FileText /> },
        { key: 'api-monitor', label: 'API 监控', icon: <Icons.Activity /> },
        { key: 'rate-limit', label: '限流配置', icon: <Icons.Zap /> },
      ],
    },
  ];

  const getBreadcrumb = () => {
    if (activeSection === 'model') {
      if (activeNavItem === 'config') return 'API Key 配置';
      if (activeNavItem === 'provider') return '服务商管理';
      if (activeNavItem === 'model-list') return '模型列表';
    }
    if (activeSection === 'prompt') {
      const names: Record<string, string> = {
        'global-settings': '全局设置',
        'perception': '问题感知模块',
        'retrieval': '知识检索模块',
        'generation': '创意生成模块',
        'evaluation': '评估反馈模块',
      };
      return names[activeNavItem] || activeNavItem;
    }
    if (activeSection === 'security') {
      if (activeNavItem === 'access-log') return '访问日志';
      if (activeNavItem === 'api-monitor') return 'API 监控';
      if (activeNavItem === 'rate-limit') return '限流配置';
    }
    if (activeSection === 'users') {
      if (activeNavItem === 'user-list') return '用户列表';
    }
    return '';
  };

  return (
    <div className="admin-layout">
      <header className="global-nav">
        <div className="global-nav-content">
          <div className="nav-left">
            <div className="brand-section">
              <Link to="/" className="brand-logo">
                <span className="brand-icon"><Icons.Logo /></span>
                <span>IAC Incubator</span>
              </Link>
            </div>
            
            <nav className="main-nav">
              <ul className="nav-links">
                <li><Link to="/assessment" className="nav-link">创新能力测评</Link></li>
                <li><Link to="/training" className="nav-link">创新能力训练</Link></li>
                <li><Link to="/incubation" className="nav-link">创新方案孵化</Link></li>
                <li><Link to="/" className="nav-link">案例中心</Link></li>
                <li><Link to="/" className="nav-link">开发文档</Link></li>
              </ul>
            </nav>
          </div>
          
          <div className="user-section">
            <div className="language-switcher" ref={languageDropdownRef}>
              <button 
                className="language-btn"
                onMouseEnter={() => setShowLanguageDropdown(true)}
                title="语言"
              >
                <Icons.Globe />
              </button>
              
              {showLanguageDropdown && (
                <div 
                  className="language-dropdown"
                  onMouseEnter={() => setShowLanguageDropdown(true)}
                  onMouseLeave={() => setShowLanguageDropdown(false)}
                >
                  <button className="language-option">中文简体</button>
                  <button className="language-option">English</button>
                </div>
              )}
            </div>
            <div className="user-avatar" ref={dropdownRef}>
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
                  
                  <a href="/profile" className="dropdown-item" onClick={() => setShowDropdown(false)}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="6" r="3" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.5"/>
                    </svg>
                    <span>个人中心</span>
                  </a>
                  
                  <a href="/admin" className="dropdown-item" onClick={() => setShowDropdown(false)}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M2 6h12M6 2v12" stroke="currentColor" strokeWidth="1.5"/>
                    </svg>
                    <span>后台管理</span>
                  </a>
                  
                  <div className="dropdown-divider"></div>
                  
                  <button className="dropdown-item dropdown-item-logout" onClick={() => setShowDropdown(false)}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M6 2H3v12h3" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M10 7l3-3-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span>退出登录</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      
      <aside className="sidebar">
        <nav className="sidebar-nav">
          {navSections.map((section) => (
            <div key={section.key} className="nav-section">
              <button
                className="nav-section-header"
                onClick={() => toggleSection(section.key)}
              >
                <h3 className="nav-section-title">{section.label}</h3>
                <svg
                  className={`nav-section-chevron ${expandedSections[section.key] ? 'expanded' : ''}`}
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {expandedSections[section.key] && (
                <ul className="nav-items">
                  {section.items.map((item) => (
                    <li key={item.key}>
                      <button
                        className={`nav-item ${activeSection === section.key && activeNavItem === item.key ? 'active' : ''}`}
                        onClick={() => onNavItemClick(section.key, item.key)}
                      >
                        <span className="nav-label">{item.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </nav>
      </aside>

      <main className="main-content">
        <header className="content-header">
          <div className="breadcrumb">
            <span className="current">{getBreadcrumb()}</span>
          </div>
        </header>

        <div className="content-body">
          {children}
        </div>
      </main>
    </div>
  );
};

export default AdminLayout;
