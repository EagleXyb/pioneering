/**
 * 设置模态框 —— 由侧边栏账户弹层「设置 / 个人中心」、插件菜单「管理插件」等
 * 入口经 settingsDialogStore 唤起（AppLayout 挂载唯一实例）。
 *
 * 布局样式参照 apps/desktop 设置弹框（renderer/.../settings/SettingsDialog.tsx）：
 * - Radix Dialog 外壳 1000×680、圆角 12px、柔和投影（hideClose + 自绘关闭钮，
 *   顺带获得焦点圈禁 / Esc 关闭 / 滚动锁定 / 进出场动画）
 * - 左栏 230px 分类导航：33px 条目 / 4px 圆角 / 分组分隔线（平铺无分组标题）
 * - 右栏：右上角关闭钮 + 22px 标题 + 12px 副标题 + 独立滚动区（细滚动条）
 * - 内容区：GroupHeader(14px/600) + SectionCard(8px 圆角 / 1px 描边)
 *   + SettingRow（斑马纹 / hover 浅蓝 / 16px 内边距 / 行间分隔线）
 * - 控件对齐 desktop：Select 220×30 / Switch 30×17 绿色 Pill / Segmented 分段器
 * - 颜色走 --set-* 对话框级令牌（亮色默认 + 显式暗色 + 系统暗色两套同步维护），
 *   详见 SettingsDialog.css 头部注释
 *
 * 功能保持既有语义不变：
 * - 偏好持久化（localStorage 'app:preferences'），主题 / 密度 / 字号即时生效
 * - 未接通的偏好一律禁用并打「开发中」标识（语言 / 桌面通知 / 提示音 /
 *   显示消息时间 / 隐私模式）；仅保留真实生效项（主题 / 密度 / 字号 / 回车发送）
 * - 账户分区承载个人资料明细（用户 ID / 用户名 / 昵称 / 邮箱 / 手机号 /
 *   注册时间，支持刷新与复制）与退出登录
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Bell,
  Cable,
  CircleHelp,
  Coins,
  Copy,
  Database,
  Ellipsis,
  FileText,
  Info,
  MessageSquare,
  Monitor,
  Moon,
  Palette,
  Phone,
  RefreshCw,
  Settings2,
  Sun,
  UserRound,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTheme } from '../store/themeContext';
import type { ThemeMode } from '../types';
import { useAuth } from '../hooks/useAuth';
import { getProfileApi } from '../api/auth-api';
import { getHealth } from '../api/system';
import { ArchivedSessionsSection } from './ArchivedSessionsSection';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { McpSection } from './more-menu/McpSection';
import { CostSection } from './CostSection';
import './SettingsDialog.css';

type Density = 'compact' | 'comfortable';

interface Prefs {
  density: Density;
  fontSize: number;
  enterToSend: boolean;
  // —— 以下偏好已持久化但功能未接通，UI 禁用并标"开发中"，保留字段避免老数据丢失 ——
  language: 'zh-CN' | 'en-US';
  notifDesktop: boolean;
  notifSound: boolean;
  showTimestamp: boolean;
  voiceShortcut: boolean;
  privacyMode: boolean;
}

const PREFS_KEY = 'app:preferences';
const DEFAULT_PREFS: Prefs = {
  language: 'zh-CN',
  density: 'comfortable',
  fontSize: 16,
  notifDesktop: false,
  notifSound: true,
  enterToSend: true,
  showTimestamp: true,
  voiceShortcut: true,
  privacyMode: false,
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    // 过滤历史版本中可能存在的已废弃字段（如 defaultMode/linkOpenMode）
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore quota errors */
  }
}

const SECTIONS: ReadonlyArray<{
  id: string;
  label: string;
  subtitle: string;
  icon: LucideIcon;
  /** 在该项之后渲染一条分组分隔线（视觉断点，对齐 desktop dividerAfter） */
  dividerAfter?: boolean;
}> = [
  {
    id: 'general',
    label: '通用',
    subtitle: '主题、语言与基础偏好',
    icon: Settings2,
    dividerAfter: true,
  },
  { id: 'appearance', label: '外观', subtitle: '界面主题、密度与正文字号', icon: Palette },
  { id: 'notification', label: '通知', subtitle: '新消息提醒方式', icon: Bell },
  {
    id: 'chat',
    label: '对话',
    subtitle: '对话交互的默认行为',
    icon: MessageSquare,
    dividerAfter: true,
  },
  { id: 'usage', label: '用量与成本', subtitle: '近 7 天模型调用统计（按目录单价估算）', icon: Coins },
  {
    id: 'mcp',
    label: 'MCP',
    subtitle: 'Model Context Protocol 服务连接状态',
    icon: Cable,
    dividerAfter: true,
  },
  {
    id: 'account',
    label: '账户',
    subtitle: '个人资料、账号权益与隐私设置',
    icon: UserRound,
    dividerAfter: true,
  },
  {
    id: 'data',
    label: '数据管理',
    subtitle: '已归档会话的查看、恢复与删除',
    icon: Database,
    dividerAfter: true,
  },
  { id: 'help', label: '帮助与反馈', subtitle: '产品使用指引与问题反馈', icon: CircleHelp },
  { id: 'about', label: '关于', subtitle: '产品版本与说明', icon: Info },
];

type SectionId = (typeof SECTIONS)[number]['id'];

/** 小分段选择器（主题 / 密度） */
function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string; icon?: LucideIcon }>;
  label: string;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((opt) => {
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={value === opt.value}
            className={`seg-item${value === opt.value ? ' is-active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {Icon && <Icon />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** "开发中"小徽标，标注未接通的设置项 */
function DevBadge() {
  return <span className="dev-badge">开发中</span>;
}

/** 左栏分类导航（平铺 + 分组分隔线，不渲染分组标题） */
function SettingsSidebar({
  active,
  onSelect,
}: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
}) {
  return (
    <nav className="settings-sidebar" aria-label="设置分类">
      <div className="settings-nav-list">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <Fragment key={s.id}>
              <button
                type="button"
                className={`settings-nav-item${active === s.id ? ' is-active' : ''}`}
                aria-current={active === s.id ? 'page' : undefined}
                onClick={() => onSelect(s.id as SectionId)}
              >
                <span className="settings-nav-item-icon">
                  <Icon />
                </span>
                <span className="settings-nav-item-label">{s.label}</span>
              </button>
              {s.dividerAfter && <div className="settings-nav-divider" aria-hidden />}
            </Fragment>
          );
        })}
      </div>
    </nav>
  );
}

/** 分组小标题（14px/600，与 desktop GroupHeader 一致） */
function GroupHeader({ label }: { label: string }) {
  return <h3 className="settings-group-title">{label}</h3>;
}

/** 分组卡片（8px 圆角 + 1px 描边，行分隔线由 overflow:hidden 收在圆角内） */
function SectionCard({ children }: { children: React.ReactNode }) {
  return <div className="settings-group-card">{children}</div>;
}

/** 单行设置：左（标题 / 副文字）+ 右（控件） */
function SettingRow({
  title,
  desc,
  control,
  dev = false,
  disabled = false,
}: {
  title: string;
  desc?: string;
  control?: React.ReactNode;
  /** 标题旁展示「开发中」徽标（未接通项） */
  dev?: boolean;
  /** 整行弱化（未接通项） */
  disabled?: boolean;
}) {
  return (
    <div className={`setting-row setting-row--card${disabled ? ' setting-row--disabled' : ''}`}>
      <div className="setting-row-text">
        <div className="setting-row-title">
          {title}
          {dev && <DevBadge />}
        </div>
        {desc && <div className="setting-row-desc">{desc}</div>}
      </div>
      {control && <div className="setting-row-controls">{control}</div>}
    </div>
  );
}

export default function SettingsDialog({
  visible,
  onClose,
  initialSection = 'general',
}: {
  visible: boolean;
  onClose: () => void;
  initialSection?: string;
}) {
  const { theme, setTheme } = useTheme();
  const { user, logout, updateUser } = useAuth();
  const [version, setVersion] = useState<string>('—');
  const [active, setActive] = useState<SectionId>('general');
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [profileLoading, setProfileLoading] = useState(false);

  // 弹框打开时定位到指定分区
  useEffect(() => {
    if (visible && initialSection) {
      setActive(initialSection as SectionId);
    }
  }, [visible, initialSection]);

  // 打开时拉取后端真实版本号
  useEffect(() => {
    getHealth()
      .then((h) => setVersion(h.version))
      .catch(() => setVersion('未知'));
  }, []);

  // 加载本地偏好
  useEffect(() => {
    if (visible) {
      setPrefs(loadPrefs());
    }
  }, [visible]);

  // 持久化偏好 + 应用密度/字号到根节点
  // （--app-font-size 经 index.css 的 html{font-size} 生效，弹框内 rem
  //   排版随之同比例缩放，与 desktop 档位缩放同一效果）
  useEffect(() => {
    savePrefs(prefs);
    const root = document.documentElement;
    root.style.setProperty('--app-font-size', `${prefs.fontSize}px`);
    root.dataset.density = prefs.density;
  }, [prefs]);

  const update = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setPrefs((p) => ({ ...p, [k]: v }));
  };

  /** 拉取最新个人资料并同步到全局 store；失败沿用本地缓存静默忽略 */
  const refreshProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const fresh = await getProfileApi();
      updateUser(fresh);
    } catch {
      // 后端不可用时沿用本地缓存数据，不报错打断用户
    } finally {
      setProfileLoading(false);
    }
  }, [updateUser]);

  // 进入「账户」分区时自动拉取一次资料（保持原「个人中心」打开即刷新的行为）
  useEffect(() => {
    if (visible && active === 'account') {
      void refreshProfile();
    }
  }, [visible, active, refreshProfile]);

  /** 格式化 createdAt（ISO 字符串）为可读日期 */
  const formatDate = (iso: string | undefined | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-CN', { hour12: false });
  };

  /** 复制到剪贴板并提示 */
  const copyText = useCallback((text: string, label: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(
      () => toast.success(`已复制${label}`),
      () => toast.error('复制失败'),
    );
  }, []);

  const section = useMemo(
    () => SECTIONS.find((s) => s.id === active) ?? SECTIONS[0],
    [active],
  );

  return (
    <Dialog
      open={visible}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent hideClose className="settings-dialog-root flex">
        {/* 左栏：分类导航 */}
        <SettingsSidebar active={active} onSelect={setActive} />

        {/* 右栏：内容区 */}
        <div className="settings-main">
          {/* 右上角关闭按钮：绝对定位贴近角落 */}
          <button
            type="button"
            onClick={onClose}
            className="settings-close-btn"
            aria-label="关闭"
          >
            <X strokeWidth={1.5} />
          </button>

          {/* 标题栏 */}
          <header className="settings-main-head">
            <DialogTitle className="settings-main-title">{section.label}</DialogTitle>
            <DialogDescription className="settings-main-subtitle">
              {section.subtitle}
            </DialogDescription>
          </header>

          {/* 内容区（原生 overflow-y-auto，宽度始终收敛为 100%） */}
          <div className="settings-scroll-area">
            <div className="settings-scroll-inner">
              {active === 'general' && (
                <section className="settings-group">
                  <GroupHeader label="基础设置" />
                  <SectionCard>
                    <SettingRow
                      title="主题"
                      desc="选择界面主题（浅色 / 深色 / 跟随系统）"
                      control={
                        <Select
                          value={theme}
                          onValueChange={(v) => setTheme(v as ThemeMode)}
                        >
                          <SelectTrigger
                            className="settings-select-trigger"
                            aria-label="主题"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="light">亮色</SelectItem>
                            <SelectItem value="dark">深色</SelectItem>
                            <SelectItem value="system">跟随系统</SelectItem>
                          </SelectContent>
                        </Select>
                      }
                    />
                    <SettingRow
                      title="语言"
                      desc="多语言即将支持，当前仅提供简体中文界面"
                      dev
                      disabled
                      control={
                        <Select
                          value={prefs.language}
                          onValueChange={(v) =>
                            update('language', v as Prefs['language'])
                          }
                          disabled
                        >
                          <SelectTrigger
                            className="settings-select-trigger"
                            aria-label="语言"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="zh-CN">简体中文</SelectItem>
                            <SelectItem value="en-US">English</SelectItem>
                          </SelectContent>
                        </Select>
                      }
                    />
                  </SectionCard>
                </section>
              )}

              {active === 'appearance' && (
                <section className="settings-group">
                  <GroupHeader label="外观" />
                  <SectionCard>
                    <SettingRow
                      title="主题"
                      desc="切换浅色或深色外观"
                      control={
                        <Segmented<ThemeMode>
                          label="主题"
                          value={theme}
                          onChange={(v) => setTheme(v)}
                          options={[
                            { value: 'light', label: '浅色', icon: Sun },
                            { value: 'dark', label: '深色', icon: Moon },
                            { value: 'system', label: '跟随系统', icon: Monitor },
                          ]}
                        />
                      }
                    />
                    <SettingRow
                      title="界面密度"
                      desc="紧凑模式可让信息更密集"
                      control={
                        <Segmented<Density>
                          label="界面密度"
                          value={prefs.density}
                          onChange={(v) => update('density', v)}
                          options={[
                            { value: 'comfortable', label: '舒适' },
                            { value: 'compact', label: '紧凑' },
                          ]}
                        />
                      }
                    />
                    <SettingRow
                      title="正文字号"
                      desc={`当前 ${prefs.fontSize}px，界面与对话区随档位同比例缩放`}
                      control={
                        <div className="w-[200px]">
                          <Slider
                            value={[prefs.fontSize]}
                            min={12}
                            max={18}
                            step={1}
                            onValueChange={([v]) => update('fontSize', v)}
                            aria-label="正文字号"
                          />
                        </div>
                      }
                    />
                  </SectionCard>
                </section>
              )}

              {active === 'notification' && (
                <section className="settings-group">
                  <GroupHeader label="通知" />
                  <SectionCard>
                    <SettingRow
                      title="桌面通知"
                      desc="收到新消息时在系统通知中心弹出"
                      dev
                      disabled
                      control={
                        <Switch
                          className="settings-switch"
                          checked={prefs.notifDesktop}
                          onCheckedChange={(v) => update('notifDesktop', v)}
                          disabled
                          aria-label="桌面通知"
                        />
                      }
                    />
                    <SettingRow
                      title="提示音"
                      desc="新消息到达时播放提示音"
                      dev
                      disabled
                      control={
                        <Switch
                          className="settings-switch"
                          checked={prefs.notifSound}
                          onCheckedChange={(v) => update('notifSound', v)}
                          disabled
                          aria-label="提示音"
                        />
                      }
                    />
                  </SectionCard>
                </section>
              )}

              {active === 'chat' && (
                <section className="settings-group">
                  <GroupHeader label="对话" />
                  <SectionCard>
                    <SettingRow
                      title="Enter 发送消息"
                      desc="关闭后需使用 Ctrl/Cmd + Enter 发送"
                      control={
                        <Switch
                          className="settings-switch"
                          checked={prefs.enterToSend}
                          onCheckedChange={(v) => update('enterToSend', v)}
                          aria-label="Enter 发送消息"
                        />
                      }
                    />
                    <SettingRow
                      title="显示消息时间"
                      desc="在每条消息旁显示发送时间（即将支持）"
                      dev
                      disabled
                      control={
                        <Switch
                          className="settings-switch"
                          checked={prefs.showTimestamp}
                          onCheckedChange={(v) => update('showTimestamp', v)}
                          disabled
                          aria-label="显示消息时间"
                        />
                      }
                    />
                  </SectionCard>
                </section>
              )}

              {active === 'usage' && <CostSection />}

              {active === 'mcp' && <McpSection />}

              {active === 'account' && (
                <>
                  {/* 个人资料 */}
                  <section className="settings-group">
                    <div className="settings-group-head">
                      <GroupHeader label="个人资料" />
                      <button
                        type="button"
                        className="settings-icon-btn chat-tooltip chat-tooltip--below"
                        onClick={() => void refreshProfile()}
                        disabled={profileLoading}
                        data-tooltip={profileLoading ? '刷新中…' : '刷新资料'}
                        aria-label="刷新资料"
                      >
                        <RefreshCw className={profileLoading ? 'animate-spin' : ''} />
                      </button>
                    </div>
                    <SectionCard>
                      <div className="setting-row setting-row--card">
                        <span className="settings-profile-label">用户 ID</span>
                        <span className="settings-profile-value settings-profile-value--mono">
                          {user?.id || '—'}
                          <button
                            type="button"
                            className="settings-profile-copy"
                            onClick={() => copyText(user?.id || '', '用户 ID')}
                            disabled={!user?.id}
                            title="复制用户 ID"
                            aria-label="复制用户 ID"
                          >
                            <Copy />
                          </button>
                        </span>
                      </div>

                      <div className="setting-row setting-row--card">
                        <span className="settings-profile-label">用户名</span>
                        <span className="settings-profile-value">
                          {user?.username || '—'}
                        </span>
                      </div>

                      <div className="setting-row setting-row--card">
                        <span className="settings-profile-label">昵称</span>
                        <span className="settings-profile-value">
                          {user?.nickname || '—'}
                        </span>
                      </div>

                      <div className="setting-row setting-row--card">
                        <span className="settings-profile-label">邮箱</span>
                        <span className="settings-profile-value">
                          {user?.email || '—'}
                          {user?.email && (
                            <button
                              type="button"
                              className="settings-profile-copy"
                              onClick={() => copyText(user.email || '', '邮箱')}
                              title="复制邮箱"
                              aria-label="复制邮箱"
                            >
                              <Copy />
                            </button>
                          )}
                        </span>
                      </div>

                      <div className="setting-row setting-row--card">
                        <span className="settings-profile-label">手机号</span>
                        <span className="settings-profile-value">
                          {user?.phone || '—'}
                        </span>
                      </div>

                      <div className="setting-row setting-row--card">
                        <span className="settings-profile-label">注册时间</span>
                        <span className="settings-profile-value">
                          {formatDate(user?.createdAt)}
                        </span>
                      </div>
                    </SectionCard>
                  </section>

                  {/* 账号与权益 */}
                  <section className="settings-group">
                    <GroupHeader label="账号与权益" />
                    <SectionCard>
                      <SettingRow
                        title="账号管理"
                        desc="修改密码、绑定邮箱与登录设备管理"
                        control={
                          <>
                            <button
                              type="button"
                              className="settings-action-pill"
                              onClick={() => toast.info('管理账号功能正在建设中')}
                            >
                              管理账号
                              <ArrowUpRight />
                            </button>
                            <button
                              type="button"
                              className="settings-icon-btn"
                              aria-label="更多"
                            >
                              <Ellipsis />
                            </button>
                          </>
                        }
                      />
                      <SettingRow
                        title="免费"
                        desc="升级权益，获取更多速通次数，享受更流畅的 AI 使用体验"
                        control={
                          <button
                            type="button"
                            className="settings-action-pill settings-action-pill--primary"
                            onClick={() => toast.info('升级权益功能正在建设中')}
                          >
                            <Zap />
                            升级权益
                          </button>
                        }
                      />
                    </SectionCard>
                  </section>

                  {/* 隐私模式 */}
                  <section className="settings-group">
                    <GroupHeader label="隐私模式" />
                    <SectionCard>
                      <div className="setting-row setting-row--card setting-row--disabled">
                        <div className="setting-row-text">
                          <div className="setting-row-title">
                            隐私模式 <DevBadge />
                          </div>
                          <div className="setting-row-desc">
                            启用后，创路 Agent
                            不会将您的对话内容用于产品改进和模型训练（能力即将上线）。
                            <a
                              href="#"
                              className="settings-inline-link"
                              onClick={(e) => {
                                e.preventDefault();
                                toast.info('隐私模式说明');
                              }}
                            >
                              了解更多
                            </a>
                          </div>
                        </div>
                        <div className="setting-row-controls">
                          <Switch
                            className="settings-switch"
                            checked={prefs.privacyMode}
                            onCheckedChange={(v) => update('privacyMode', v)}
                            disabled
                            aria-label="隐私模式"
                          />
                        </div>
                      </div>
                    </SectionCard>
                  </section>

                  {/* 退出登录 */}
                  <div className="settings-account-footer">
                    <button
                      type="button"
                      className="settings-btn-logout"
                      onClick={async () => {
                        onClose();
                        await logout();
                      }}
                    >
                      退出登录
                    </button>
                  </div>
                </>
              )}

              {active === 'data' && <ArchivedSessionsSection />}

              {active === 'help' && (
                <>
                  <ul className="help-list">
                    <li
                      className="help-item"
                      onClick={() =>
                        window.open('https://example.com/docs', '_blank')
                      }
                    >
                      <span className="help-item__left">
                        <FileText className="help-item__icon" />
                        帮助文档
                      </span>
                      <ArrowUpRight className="help-item__arrow" />
                    </li>

                    <li
                      className="help-item"
                      onClick={() => toast.info('意见反馈功能正在建设中')}
                    >
                      <span className="help-item__left">
                        <MessageSquare className="help-item__icon" />
                        意见反馈
                      </span>
                    </li>

                    <li
                      className="help-item"
                      onClick={() =>
                        window.open('mailto:support@example.com', '_blank')
                      }
                    >
                      <span className="help-item__left">
                        <Phone className="help-item__icon" />
                        联系我们
                      </span>
                      <ArrowUpRight className="help-item__arrow" />
                    </li>
                  </ul>

                  <div className="help-footer">
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        toast.info('隐私政策');
                      }}
                    >
                      隐私政策
                    </a>
                    <span className="help-footer__divider">|</span>
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        toast.info('服务协议');
                      }}
                    >
                      服务协议
                    </a>
                  </div>
                </>
              )}

              {active === 'about' && (
                <section className="settings-group">
                  <GroupHeader label="关于" />
                  <SectionCard>
                    <SettingRow
                      title="当前版本"
                      desc="由后端健康检查接口返回"
                      control={<span className="settings-version-pill">v{version}</span>}
                    />
                    <SettingRow
                      title="产品名称"
                      desc="创路 Agent · 多模态智能工作台"
                    />
                    <SettingRow
                      title="技术栈"
                      desc="React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui"
                    />
                  </SectionCard>
                </section>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
