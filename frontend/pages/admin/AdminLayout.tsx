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
  SearchIcon,
  UsergroupIcon,
  LayersIcon,
  HomeIcon,
  NotificationFilledIcon,
  DashboardIcon,
  ControlPlatformIcon,
  BookIcon,
  SystemStorageIcon,
  ChartLineIcon,
  WalletIcon,
  SecuredIcon,
} from 'tdesign-icons-react';
import { useUser } from '../../contexts/UserContext';
import type { NavSection } from './types';

const { HeadMenu, MenuItem, SubMenu: Submenu } = Menu;
const { BreadcrumbItem } = Breadcrumb;
const { Header, Aside, Content, Footer } = Layout;

// ==================== 面包屑映射 ====================
const BREADCRUMB_MAP: Record<string, string> = {
  // 仪表盘
  'overview': '系统概览',
  'usage-stats': '使用统计',
  'key-metrics': '关键指标',
  // 智能体管理
  'agent-list-config': '智能体列表与配置',
  'workflows': '工作流编排',
  'components': '组件库管理',
  // 知识管理
  'kb-graph': '知识库与图谱',
  'data': '数据管理',
  'memory': '记忆管理',
  // 模型与Prompt
  'model': '模型管理',
  'prompt': 'Prompt管理',
  // 监控与运维
  'log-audit': '日志与审计',
  'perf-monitor': '性能监控',
  'tests': '测试与评估',
  // 用户与账户
  'user-permission': '用户与权限',
  'billing': '计费管理',
  'token-stats': 'Token统计',
  // 系统设置
  'sys-config': '系统配置',
  'notif-security': '通知与安全',
  'integration': '集成设置',
};

// ==================== 顶部菜单配置（业务导航） ====================
const TOP_MENU_ITEMS: { value: string; label: string; to: string }[] = [
  { value: 'assessment', label: '创新能力测评', to: '/assessment' },
  { value: 'training', label: '创新能力训练', to: '/training' },
  { value: 'incubation', label: '创新方案孵化', to: '/incubation' },
  { value: 'home', label: '案例中心', to: '/' },
  { value: 'docs', label: '开发文档', to: '/trial-center' },
];

// ==================== 侧边栏菜单配置 ====================
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
  // ---------- 01. 仪表盘 ----------
  {
    key: 'dashboard',
    label: '仪表盘',
    icon: <DashboardIcon />,
    items: [
      { value: 'overview', label: '系统概览' },
      { value: 'usage-stats', label: '使用统计' },
      { value: 'key-metrics', label: '关键指标' },
    ],
  },
  // ---------- 02. 智能体管理 ----------
  {
    key: 'agents',
    label: '智能体管理',
    icon: <ControlPlatformIcon />,
    items: [
      { value: 'agent-list-config', label: '智能体列表与配置' },
      { value: 'workflows', label: '工作流编排' },
      { value: 'components', label: '组件库管理' },
    ],
  },
  // ---------- 03. 知识管理 ----------
  {
    key: 'knowledge',
    label: '知识管理',
    icon: <BookIcon />,
    items: [
      { value: 'kb-graph', label: '知识库与图谱' },
      { value: 'data', label: '数据管理' },
      { value: 'memory', label: '记忆管理' },
    ],
  },
  // ---------- 04. 模型与Prompt（已有代码） ----------
  {
    key: 'model-prompt',
    label: '模型与Prompt',
    icon: <SystemStorageIcon />,
    items: [
      { value: 'model', label: '模型管理' },
      { value: 'prompt', label: 'Prompt管理' },
    ],
  },
  // ---------- 05. 监控与运维 ----------
  {
    key: 'monitor-ops',
    label: '监控与运维',
    icon: <ChartLineIcon />,
    items: [
      { value: 'log-audit', label: '日志与审计' },
      { value: 'perf-monitor', label: '性能监控' },
      { value: 'tests', label: '测试与评估' },
    ],
  },
  // ---------- 06. 用户与账户 ----------
  {
    key: 'user-account',
    label: '用户与账户',
    icon: <UsergroupIcon />,
    items: [
      { value: 'user-permission', label: '用户与权限' },
      { value: 'billing', label: '计费管理' },
      { value: 'token-stats', label: 'Token统计' },
    ],
  },
  // ---------- 07. 系统设置 ----------
  {
    key: 'settings',
    label: '系统设置',
    icon: <SecuredIcon />,
    items: [
      { value: 'sys-config', label: '系统配置' },
      { value: 'notif-security', label: '通知与安全' },
      { value: 'integration', label: '集成设置' },
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
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
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

      <Layout style={{ minHeight: 0, flex: 1 }}>
        {/* ========== 侧边栏菜单 ========== */}
        <Aside style={{ borderTop: '1px solid var(--component-border, #e5e7eb)', overflowY: 'auto' }}>
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
        <Layout style={{ minHeight: 0 }}>
          <Content style={{ padding: '24px', overflowY: 'auto', background: '#f0f2f5' }}>
            <Breadcrumb style={{ marginBottom: 16 }}>
              <BreadcrumbItem>管理后台</BreadcrumbItem>
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