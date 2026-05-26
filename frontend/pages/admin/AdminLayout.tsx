// AdminLayout - 后台管理组合导航布局（TDesign HeadMenu + Aside Menu）

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
  LockOnIcon,
  HomeIcon,
  NotificationFilledIcon,
} from 'tdesign-icons-react';
import { useUser } from '../../contexts/UserContext';
import type { NavSection } from './types';

const { HeadMenu, MenuItem, SubMenu: Submenu } = Menu;
const { BreadcrumbItem } = Breadcrumb;
const { Header, Aside, Content, Footer } = Layout;

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

// ==================== 顶部菜单配置（业务导航） ====================
const TOP_MENU_ITEMS: { value: string; label: string; to: string }[] = [
  { value: 'assessment', label: '创新能力测评', to: '/assessment' },
  { value: 'training', label: '创新能力训练', to: '/training' },
  { value: 'incubation', label: '创新方案孵化', to: '/incubation' },
  { value: 'home', label: '案例中心', to: '/' },
  { value: 'docs', label: '开发文档', to: '/trial-center' },
];

// ==================== 侧边栏菜单配置（可折叠分组） ====================
interface NavSubMenuItem {
  value: string;
  label: string;
}

interface NavGroupItem {
  key: NavSection;
  label: string;
  icon: React.ReactElement;
  items: NavSubMenuItem[];
}

const SIDEBAR_GROUPS: NavGroupItem[] = [
  {
    key: 'model',
    label: '模型管理',
    icon: <AppIcon />,
    items: [
      { value: 'config', label: 'API Key 配置' },
      { value: 'provider', label: '服务商管理' },
      { value: 'model-list', label: '模型列表' },
    ],
  },
  {
    key: 'prompt',
    label: 'Prompt 管理',
    icon: <SettingIcon />,
    items: [
      { value: 'global-settings', label: '全局设置' },
      { value: 'perception', label: '问题感知模块' },
      { value: 'retrieval', label: '知识检索模块' },
      { value: 'generation', label: '创意生成模块' },
      { value: 'evaluation', label: '评估反馈模块' },
    ],
  },
  {
    key: 'users',
    label: '用户管理',
    icon: <UsergroupIcon />,
    items: [
      { value: 'user-list', label: '用户列表' },
    ],
  },
  {
    key: 'security',
    label: '安全管理',
    icon: <FileIcon />,
    items: [
      { value: 'access-log', label: '访问日志' },
      { value: 'api-monitor', label: 'API 监控' },
      { value: 'rate-limit', label: '限流配置' },
    ],
  },
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

  const breadcrumbText = BREADCRUMB_MAP[activeNavItem] || activeNavItem;
  const menuValue = `${activeSection}:${activeNavItem}`;
  const defaultExpanded = [activeSection];

  // 顶部菜单点击 → 跳转业务页面
  const handleHeadMenuChange = (value: MenuValue) => {
    const item = TOP_MENU_ITEMS.find(i => i.value === value);
    if (item) {
      window.location.href = item.to;
    }
  };

  // 侧边栏菜单切换（解析 section:itemKey 格式）
  const handleSideMenuChange = (value: MenuValue) => {
    const str = String(value);
    const colonIdx = str.indexOf(':');
    if (colonIdx > 0) {
      const section = str.slice(0, colonIdx) as NavSection;
      const itemKey = str.slice(colonIdx + 1);
      onNavItemClick(section, itemKey);
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

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* ========== 顶部导航（HeadMenu 组合导航） ========== */}
      <Header>
        <HeadMenu
          onChange={handleHeadMenuChange}
          logo={
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
          }
          operations={
            <div className="t-menu__operations">
              <SearchIcon className="t-menu__operations-icon" />
              <NotificationFilledIcon className="t-menu__operations-icon" />
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
          }
        >
          {TOP_MENU_ITEMS.map((item) => (
            <MenuItem key={item.value} value={item.value}>
              {item.label}
            </MenuItem>
          ))}
        </HeadMenu>
      </Header>

      <Layout>
        {/* ========== 侧边栏菜单 ========== */}
        <Aside style={{ borderTop: '1px solid var(--component-border, #e5e7eb)' }}>
          <Menu
            value={menuValue}
            onChange={handleSideMenuChange}
            defaultExpanded={defaultExpanded}
            expandType="normal"
            theme="light"
            style={{ height: '100%' }}
          >
            {SIDEBAR_GROUPS.map((group) => (
              <Submenu
                key={group.key}
                value={group.key}
                title={group.label}
                icon={group.icon}
              >
                {group.items.map((subItem) => (
                  <MenuItem
                    key={`${group.key}:${subItem.value}`}
                    value={`${group.key}:${subItem.value}`}
                  >
                    {subItem.label}
                  </MenuItem>
                ))}
              </Submenu>
            ))}
          </Menu>
        </Aside>

        {/* ========== 主内容区 ========== */}
        <Layout>
          <Content style={{ padding: '24px', overflow: 'auto', background: '#f0f2f5' }}>
            <Breadcrumb style={{ marginBottom: 16 }}>
              <BreadcrumbItem>{breadcrumbText}</BreadcrumbItem>
            </Breadcrumb>
            {children}
          </Content>
          <Footer style={{ textAlign: 'center', color: '#999', fontSize: 12, padding: '16px 24px', background: '#f0f2f5' }}>
            Copyright @ 2019-2020 Tencent. All Rights Reserved
          </Footer>
        </Layout>
      </Layout>
    </Layout>
  );
};

export default AdminLayout;
