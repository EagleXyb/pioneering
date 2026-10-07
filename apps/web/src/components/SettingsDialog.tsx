/**
 * 设置模态框 —— 由侧边栏账户弹层「设置」按钮唤起
 * 全屏浮层 + 900×600 居中窗口；分组：通用 / 外观 / 通知 / 对话 / 账户 / 帮助 / 关于
 *
 * - 基于 shadcn 基座 + sonner + lucide 实现
 * - 未接通的偏好一律禁用并打"开发中"标识
 *   （语言/桌面通知/提示音/显示时间/语音快捷键/隐私模式）；
 *   仅保留真实生效项（主题/密度/字号/回车发送）
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  CircleHelp,
  Ellipsis,
  FileText,
  Info,
  MessageSquare,
  Palette,
  Phone,
  Settings2,
  Sun,
  Moon,
  ArrowUpRight,
  UserRound,
  X,
  Zap,
  Cable,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTheme } from '../store/themeContext';
import type { ThemeMode } from '../types';
import { useAuth } from '../hooks/useAuth';
import { getHealth } from '../api/system';
import {
  Select,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { McpSection } from './more-menu/McpSection';
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
  icon: LucideIcon;
}> = [
  { id: 'general', label: '通用', icon: Settings2 },
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'notification', label: '通知', icon: Bell },
  { id: 'chat', label: '对话', icon: MessageSquare },
  { id: 'mcp', label: 'MCP', icon: Cable },
  { id: 'account', label: '账户', icon: UserRound },
  { id: 'help', label: '帮助与反馈', icon: CircleHelp },
  { id: 'about', label: '关于', icon: Info },
];

type SectionId = (typeof SECTIONS)[number]['id'];

/** 小分段选择器 */
function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string; icon?: LucideIcon }>;
}) {
  return (
    <div className="seg" role="radiogroup">
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
  const { user, logout } = useAuth();
  const [version, setVersion] = useState<string>('—');
  const [active, setActive] = useState<SectionId>('general');
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  // 弹框打开时定位到指定标签页
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
  useEffect(() => {
    savePrefs(prefs);
    const root = document.documentElement;
    root.style.setProperty('--app-font-size', `${prefs.fontSize}px`);
    root.dataset.density = prefs.density;
  }, [prefs]);

  // Escape 键关闭
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (visible) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [visible, handleKeyDown]);

  const update = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setPrefs((p) => ({ ...p, [k]: v }));
  };

  const section = useMemo(
    () => SECTIONS.find((s) => s.id === active) ?? SECTIONS[0],
    [active],
  );

  // Portal 到 body：本浮层在 Sidebar 账号弹层内被唤起，而移动端 <aside>
  // 带 transform 会收纳 position:fixed 后代，导致弹窗被困在侧栏抽屉里。
  if (!visible) return null;

  return createPortal(
    <div className="settings-overlay" onClick={onClose}>
      {/* 点击窗口内部不关闭 */}
      <div className="settings-window" onClick={(e) => e.stopPropagation()}>
        {/* 左侧分类导航 */}
        <aside className="settings-nav">
          <div className="settings-nav-head">
            <div className="settings-nav-avatar">
              {user?.avatar ? (
                <img
                  src={user.avatar}
                  alt={user?.nickname || user?.username || '用户'}
                />
              ) : (
                <span>
                  {(user?.nickname || user?.username || '?')
                    .charAt(0)
                    .toUpperCase()}
                </span>
              )}
            </div>
            <div className="settings-nav-account">
              <div className="settings-nav-name">
                {user?.nickname || user?.username || '未登录'}
              </div>
              <div className="settings-nav-meta">
                @{user?.username || '—'}
              </div>
            </div>
          </div>
          <nav className="settings-nav-list">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`settings-nav-item${active === s.id ? ' is-active' : ''}`}
                  onClick={() => setActive(s.id)}
                >
                  <span className="settings-nav-item-icon">
                    <Icon />
                  </span>
                  <span className="settings-nav-item-label">{s.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* 右侧内容区 */}
        <main className="settings-main">
          <button
            type="button"
            className="settings-close-btn"
            aria-label="关闭"
            onClick={onClose}
          >
            <X />
          </button>
          <header className="settings-main-head">
            <h1 className="settings-main-title">{section.label}</h1>
            <p className="settings-main-subtitle">
              {active === 'general' && '应用启动行为与界面语言'}
              {active === 'appearance' && '主题、密度与文字大小'}
              {active === 'notification' && '新消息提醒方式'}
              {active === 'chat' && '对话交互的默认行为'}
              {active === 'mcp' && 'Model Context Protocol 服务连接状态'}
              {active === 'account' && '账户信息、用量与隐私设置'}
              {active === 'help' && '产品使用指引与问题反馈'}
              {active === 'about' && '产品版本与说明'}
            </p>
          </header>

          <div className="settings-main-body">
            {active === 'general' && (
              <section className="settings-group">
                <h3 className="settings-group-title">基础设置</h3>
                <div className="settings-group-card">
                  <div className="setting-row setting-row--card">
                    <div className="setting-row-text">
                      <div className="setting-row-title">主题</div>
                      <div className="setting-row-desc">选择主题</div>
                    </div>
                    <Select
                      value={theme}
                      onValueChange={(v) => setTheme(v as ThemeMode)}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="light">亮色</SelectItem>
                        <SelectItem value="dark">深色</SelectItem>
                        <SelectItem value="system">跟随系统</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="setting-row setting-row--card setting-row--disabled">
                    <div className="setting-row-text">
                      <div className="setting-row-title">
                        语言 <DevBadge />
                      </div>
                      <div className="setting-row-desc">
                        多语言即将支持，当前仅提供简体中文界面
                      </div>
                    </div>
                    <Select
                      value={prefs.language}
                      onValueChange={(v) =>
                        update('language', v as Prefs['language'])
                      }
                      disabled
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="zh-CN">简体中文</SelectItem>
                        <SelectItem value="en-US">English</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>
            )}

            {active === 'appearance' && (
              <>
                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-row-title">主题</div>
                    <div className="setting-row-desc">切换浅色或深色外观</div>
                  </div>
                  <Segmented<ThemeMode>
                    value={theme}
                    onChange={(v) => setTheme(v)}
                    options={[
                      { value: 'light', label: '浅色', icon: Sun },
                      { value: 'dark', label: '深色', icon: Moon },
                    ]}
                  />
                </div>

                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-row-title">界面密度</div>
                    <div className="setting-row-desc">
                      紧凑模式可让信息更密集
                    </div>
                  </div>
                  <Segmented<Density>
                    value={prefs.density}
                    onChange={(v) => update('density', v)}
                    options={[
                      { value: 'comfortable', label: '舒适' },
                      { value: 'compact', label: '紧凑' },
                    ]}
                  />
                </div>

                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-row-title">正文字号</div>
                    <div className="setting-row-desc">
                      当前 {prefs.fontSize}px
                    </div>
                  </div>
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
                </div>
              </>
            )}

            {active === 'notification' && (
              <>
                <div className="setting-row setting-row--disabled">
                  <div className="setting-row-text">
                    <div className="setting-row-title">
                      桌面通知 <DevBadge />
                    </div>
                    <div className="setting-row-desc">
                      收到新消息时在系统通知中心弹出
                    </div>
                  </div>
                  <Switch
                    checked={prefs.notifDesktop}
                    onCheckedChange={(v) => update('notifDesktop', v)}
                    disabled
                  />
                </div>
                <div className="setting-row setting-row--disabled">
                  <div className="setting-row-text">
                    <div className="setting-row-title">
                      提示音 <DevBadge />
                    </div>
                    <div className="setting-row-desc">
                      新消息到达时播放提示音
                    </div>
                  </div>
                  <Switch
                    checked={prefs.notifSound}
                    onCheckedChange={(v) => update('notifSound', v)}
                    disabled
                  />
                </div>
              </>
            )}

            {active === 'mcp' && <McpSection />}

            {active === 'chat' && (
              <>
                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-row-title">Enter 发送消息</div>
                    <div className="setting-row-desc">
                      关闭后需使用 Ctrl/Cmd + Enter 发送
                    </div>
                  </div>
                  <Switch
                    checked={prefs.enterToSend}
                    onCheckedChange={(v) => update('enterToSend', v)}
                  />
                </div>
                <div className="setting-row setting-row--disabled">
                  <div className="setting-row-text">
                    <div className="setting-row-title">
                      显示消息时间 <DevBadge />
                    </div>
                    <div className="setting-row-desc">
                      在每条消息旁显示发送时间（即将支持）
                    </div>
                  </div>
                  <Switch
                    checked={prefs.showTimestamp}
                    onCheckedChange={(v) => update('showTimestamp', v)}
                    disabled
                  />
                </div>
              </>
            )}

            {active === 'account' && (
              <>
                {/* 账户信息 */}
                <section className="settings-group">
                  <h3 className="settings-group-title">账户信息</h3>
                  <div className="settings-group-card">
                    <div className="setting-row setting-row--card">
                      <div className="setting-row-text">
                        <div className="setting-row-title">
                          {user?.nickname || user?.username || '未登录'}
                        </div>
                        <div className="setting-row-desc">
                          {user?.phone
                            ? `${user.phone.slice(0, 3)}*****${user.phone.slice(-2)}`
                            : '未绑定手机号'}
                        </div>
                      </div>
                      <div className="setting-row-controls">
                        <button
                          type="button"
                          className="settings-action-pill"
                          onClick={() =>
                            toast.info('管理账号功能正在建设中')
                          }
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
                      </div>
                    </div>

                    <div className="setting-row setting-row--card">
                      <div className="setting-row-text">
                        <div className="setting-row-title">免费</div>
                        <div className="setting-row-desc">
                          升级权益，获取更多速通次数，享受更流畅的 AI
                          使用体验
                        </div>
                      </div>
                      <button
                        type="button"
                        className="settings-action-pill settings-action-pill--primary"
                        onClick={() => toast.info('升级权益功能正在建设中')}
                      >
                        <Zap />
                        升级权益
                      </button>
                    </div>
                  </div>
                </section>

                {/* 隐私模式 */}
                <section className="settings-group">
                  <h3 className="settings-group-title">隐私模式</h3>
                  <div className="settings-group-card">
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
                          checked={prefs.privacyMode}
                          onCheckedChange={(v) => update('privacyMode', v)}
                          disabled
                        />
                      </div>
                    </div>
                  </div>
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
              <>
                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-row-title">当前版本</div>
                    <div className="setting-row-desc">
                      由后端健康检查接口返回
                    </div>
                  </div>
                  <span className="settings-version-pill">v{version}</span>
                </div>
                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-row-title">产品名称</div>
                    <div className="setting-row-desc">
                      创路 Agent · 多模态智能工作台
                    </div>
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-row-title">技术栈</div>
                    <div className="setting-row-desc">
                      React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>,
    document.body,
  );
}
