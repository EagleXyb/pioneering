// AdminLayout - 后台管理公共布局（TDesign 重构版）

import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Layout,
  Menu,
  Breadcrumb,
  Dropdown,
  Avatar,
} from 'tdesign-react';
import type { MenuValue } from 'tdesign-react/es/menu';
import type { DropdownOption } from 'tdesign-react/es/dropdown';
import {
  LogoutIcon,
  LockOnIcon,
  AppIcon,
  ViewListIcon,
  SettingIcon,
  InfoCircleIcon,
  SearchIcon,
  ViewModuleIcon,
  CheckCircleIcon,
  FileIcon,
  ChartLineIcon,
  InternetIcon,
  UsergroupIcon,
  LayersIcon,
} from 'tdesign-icons-react';
import { useUser } from '../../contexts/UserContext';
import type { NavSection } from './types';

const { MenuItem, SubMenu: Submenu } = Menu;
const { BreadcrumbItem } = Breadcrumb;
const { Header, Aside, Content } = Layout;

// ==================== 品牌 Logo ====================
const BrandLogo: React.FC = () => (
  <Link
    to="/"
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      textDecoration: 'none',
      color: '#1f2937',
      fontWeight: 600,
      fontSize: 18,
    }}
  >
    <LayersIcon size="28px" style={{ color: '#2490f8' }} />
    <span>IAC Incubator</span>
  </Link>
);

// ==================== 面包屑映射 ====================
const BREADCRUMB_MAP: Record<string, string> = {
  config: 'API Key 配置',
  provider: '服务商管理',
  'model-list': '模型列表',
  'global-settings': '全局设置',
  perception: '问题感知模块',
  retrieval: '知识检索模块',
  generation: '创意生成模块',
  evaluation: '评估反馈模块',
  'access-log': '访问日志',
  'api-monitor': 'API 监控',
  'rate-limit': '限流配置',
  'user-list': '用户列表',
};

// ==================== 侧边栏菜单配置 ====================
interface NavMenuItem {
  key: string;
  label: string;
  icon: React.ReactElement;
}

interface NavSectionItem {
  key: string;
  label: string;
  icon: React.ReactElement;
  items: NavMenuItem[];
}

const NAV_SECTIONS: NavSectionItem[] = [
  {
    key: 'model',
    label: '模型管理',
    icon: <AppIcon />,
    items: [
      { key: 'model:config', label: 'API Key 配置', icon: <LockOnIcon /> },
      { key: 'model:provider', label: '服务商管理', icon: <AppIcon /> },
      { key: 'model:model-list', label: '模型列表', icon: <ViewListIcon /> },
    ],
  },
  {
    key: 'prompt',
    label: 'Prompt 管理',
    icon: <SettingIcon />,
    items: [
      { key: 'prompt:global-settings', label: '全局设置', icon: <SettingIcon /> },
      { key: 'prompt:perception', label: '问题感知模块', icon: <InfoCircleIcon /> },
      { key: 'prompt:retrieval', label: '知识检索模块', icon: <SearchIcon /> },
      { key: 'prompt:generation', label: '创意生成模块', icon: <ViewModuleIcon /> },
      { key: 'prompt:evaluation', label: '评估反馈模块', icon: <CheckCircleIcon /> },
    ],
  },
  {
    key: 'users',
    label: '用户管理',
    icon: <UsergroupIcon />,
    items: [
      { key: 'users:user-list', label: '用户列表', icon: <UsergroupIcon /> },
    ],
  },
  {
    key: 'security',
    label: '安全管理',
    icon: <FileIcon />,
    items: [
      { key: 'security:access-log', label: '访问日志', icon: <FileIcon /> },
      { key: 'security:api-monitor', label: 'API 监控', icon: <ChartLineIcon /> },
      { key: 'security:rate-limit', label: '限流配置', icon: <InternetIcon /> },
    ],
  },
];

// ==================== 顶部导航链接 ====================
const TOP_NAV_LINKS = [
  { to: '/assessment', label: '创新能力测评' },
  { to: '/training', label: '创新能力训练' },
  { to: '/incubation', label: '创新方案孵化' },
  { to: '/', label: '案例中心' },
  { to: '/', label: '开发文档' },
];

// ==================== Props ====================
interface AdminLayoutProps {
  activeSection: NavSection;
  activeNavItem: string;
  onNavItemClick: (section: NavSection, itemKey: string) => void;
  children: React.ReactNode;
}

// ==================== 组件 ====================
export const AdminLayout: React.FC<AdminLayoutProps> = ({
  activeSection,
  activeNavItem,
  onNavItemClick,
  children,
}) => {
  const { userState } = useUser();

  const menuValue = `${activeSection}:${activeNavItem}`;
  const defaultExpandedMenu = NAV_SECTIONS.map(s => s.key);
  const breadcrumbText = BREADCRUMB_MAP[activeNavItem] || activeNavItem;

  const handleMenuChange = (value: MenuValue) => {
    const str = String(value);
    const colonIdx = str.indexOf(':');
    if (colonIdx > 0) {
      const section = str.slice(0, colonIdx) as NavSection;
      const item = str.slice(colonIdx + 1);
      onNavItemClick(section, item);
    }
  };

  // 用户下拉菜单
  const userDropdownOptions: DropdownOption[] = useMemo(() => [
    {
      content: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 0' }}>
          {userState.avatar ? (
            <Avatar size="36px" image={userState.avatar} />
          ) : (
            <Avatar size="36px">{userState.name.charAt(0)}</Avatar>
          )}
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{userState.name}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{userState.email}</div>
          </div>
        </div>
      ),
      value: '__header__',
      disabled: true,
    },
    { content: '个人中心', value: 'profile', prefixIcon: <UsergroupIcon />, divider: true },
    { content: '后台管理', value: 'admin', prefixIcon: <AppIcon /> },
    { content: '退出登录', value: 'logout', prefixIcon: <LogoutIcon />, divider: true },
  ], [userState]);

  const handleUserDropdownClick = (data: DropdownOption) => {
    if (data.value === 'profile') window.location.href = '/profile';
    if (data.value === 'admin') window.location.href = '/admin';
  };

  // 语言下拉菜单
  const languageDropdownOptions: DropdownOption[] = [
    { content: '中文简体', value: 'zh-CN' },
    { content: 'English', value: 'en' },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* ========== 顶部导航 ========== */}
      <Header
        style={{
          height: 60,
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #e5e7eb',
          background: '#fff',
          position: 'sticky',
          top: 0,
          zIndex: 200,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
          <div style={{ flexShrink: 0 }}>
            <BrandLogo />
          </div>
          <nav style={{ display: 'flex', gap: 8 }}>
            {TOP_NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                to={link.to}
                style={{
                  textDecoration: 'none',
                  color: '#6b7280',
                  fontSize: 14,
                  fontWeight: 500,
                  padding: '8px 14px',
                  borderRadius: 6,
                }}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* 语言切换 */}
          <Dropdown options={languageDropdownOptions} popupProps={{ overlayClassName: 'admin-dropdown-popup' }}>
            <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 6, borderRadius: 6 }}>
              <InternetIcon size="18px" />
            </span>
          </Dropdown>
          {/* 用户菜单 */}
          <Dropdown
            options={userDropdownOptions}
            onClick={handleUserDropdownClick}
            popupProps={{ overlayClassName: 'admin-dropdown-popup' }}
          >
            <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              {userState.avatar ? (
                <Avatar size="32px" image={userState.avatar} />
              ) : (
                <Avatar size="32px">{userState.name.charAt(0)}</Avatar>
              )}
            </span>
          </Dropdown>
        </div>
      </Header>

      <Layout>
        {/* ========== 侧边栏 ========== */}
        <Aside
          width="240px"
          style={{
            borderRight: '1px solid #e5e7eb',
            background: '#fff',
            overflowY: 'auto',
            flexShrink: 0,
          }}
        >
          <Menu
            value={menuValue}
            defaultExpanded={defaultExpandedMenu}
            onChange={handleMenuChange}
            expandType="normal"
          >
            {NAV_SECTIONS.map((section) => (
              <Submenu
                key={section.key}
                value={section.key}
                title={section.label}
                icon={section.icon}
              >
                {section.items.map((item) => (
                  <MenuItem key={item.key} value={item.key} icon={item.icon}>
                    {item.label}
                  </MenuItem>
                ))}
              </Submenu>
            ))}
          </Menu>
        </Aside>

        {/* ========== 主内容区 ========== */}
        <Content style={{ padding: '0 24px 24px 32px', overflow: 'auto', minHeight: 'calc(100vh - 60px)' }}>
          <Breadcrumb style={{ padding: '16px 0' }}>
            <BreadcrumbItem>{breadcrumbText}</BreadcrumbItem>
          </Breadcrumb>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
};

export default AdminLayout;