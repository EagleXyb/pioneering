/**
 * 设置模态框 —— 由侧边栏账户弹层「设置」按钮唤起
 * 布局参照系统设置样式：左侧 200px 分类导航 + 右侧内容区
 * 内容区分组呈现：通用 / 外观 / 通知 / 对话 / 账户 / 关于
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  Switch,
  Slider,
  Select,
  Radio,
} from 'tdesign-react';
import {
  SettingIcon,
  BrushIcon,
  NotificationIcon,
  ChatIcon,
  UserIcon,
  InfoCircleIcon,
  ModeLightIcon,
  ModeDarkIcon,
} from 'tdesign-icons-react';
import { useTheme } from '../store/themeContext';
import { useAuth } from '../hooks/useAuth';
import { getHealth } from '../api/system';
import type { UserProfile } from '../types/auth';
import './SettingsDialog.css';

type Density = 'compact' | 'comfortable';
type AppDefaultMode = 'chat' | 'pro' | 'task';
type AppLanguage = 'zh-CN' | 'en-US';

interface Prefs {
  defaultMode: AppDefaultMode;
  language: AppLanguage;
  density: Density;
  fontSize: number;
  notifDesktop: boolean;
  notifSound: boolean;
  enterToSend: boolean;
  showTimestamp: boolean;
}

const PREFS_KEY = 'app:preferences';
const DEFAULT_PREFS: Prefs = {
  defaultMode: 'chat',
  language: 'zh-CN',
  density: 'comfortable',
  fontSize: 14,
  notifDesktop: false,
  notifSound: true,
  enterToSend: true,
  showTimestamp: true,
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
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

const SECTIONS = [
  { id: 'general', label: '通用', icon: <SettingIcon /> },
  { id: 'appearance', label: '外观', icon: <BrushIcon /> },
  { id: 'notification', label: '通知', icon: <NotificationIcon /> },
  { id: 'chat', label: '对话', icon: <ChatIcon /> },
  { id: 'account', label: '账户', icon: <UserIcon /> },
  { id: 'about', label: '关于', icon: <InfoCircleIcon /> },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

function AccountSummary({ user }: { user: UserProfile | null }) {
  const displayName = user?.nickname || user?.username || '未命名用户';
  const initial = (user?.nickname || user?.username || '?').charAt(0).toUpperCase();
  const registeredAt = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString('zh-CN')
    : '—';

  return (
    <div className="settings-account">
      <div className="settings-avatar">
        {user?.avatar ? <img src={user.avatar} alt={displayName} /> : initial}
      </div>
      <div className="settings-account-info">
        <div className="settings-account-name">{displayName}</div>
        <div className="settings-account-meta">@{user?.username || '—'}</div>
      </div>
      <div className="settings-account-grid">
        <div className="settings-account-cell">
          <span className="settings-account-cell-label">邮箱</span>
          <span className="settings-account-cell-value">{user?.email || '未绑定'}</span>
        </div>
        <div className="settings-account-cell">
          <span className="settings-account-cell-label">注册时间</span>
          <span className="settings-account-cell-value">{registeredAt}</span>
        </div>
      </div>
    </div>
  );
}

export default function SettingsDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const [version, setVersion] = useState<string>('—');
  const [active, setActive] = useState<SectionId>('general');
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  // 打开时拉取后端真实版本号（destroyOnClose 保证每次打开重新挂载触发）
  useEffect(() => {
    getHealth()
      .then((h) => setVersion(h.version))
      .catch(() => setVersion('未知'));
  }, []);

  // 加载本地偏好
  useEffect(() => {
    setPrefs(loadPrefs());
  }, [visible]);

  // 持久化偏好 + 应用密度/字号到根节点 CSS 变量
  useEffect(() => {
    savePrefs(prefs);
    const root = document.documentElement;
    root.style.setProperty('--app-font-size', `${prefs.fontSize}px`);
    root.dataset.density = prefs.density;
  }, [prefs]);

  const update = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setPrefs((p) => ({ ...p, [k]: v }));
  };

  const section = useMemo(() => SECTIONS.find((s) => s.id === active) ?? SECTIONS[0], [active]);

  return (
    <Dialog
      visible={visible}
      width={840}
      confirmBtn="完成"
      cancelBtn={null}
      onConfirm={onClose}
      onClose={onClose}
      destroyOnClose
      dialogClassName="settings-dialog"
      header={null}
    >
      <div className="settings-shell">
        {/* 左侧分类导航 */}
        <aside className="settings-nav">
          <div className="settings-nav-head">
            <h2 className="settings-nav-title">设置</h2>
            <p className="settings-nav-subtitle">偏好与账户</p>
          </div>
          <nav className="settings-nav-list">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`settings-nav-item${active === s.id ? ' is-active' : ''}`}
                onClick={() => setActive(s.id)}
              >
                <span className="settings-nav-item-icon">{s.icon}</span>
                <span className="settings-nav-item-label">{s.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* 右侧内容区 */}
        <main className="settings-content">
          <header className="settings-content-head">
            <h1 className="settings-content-title">{section.label}</h1>
            <p className="settings-content-subtitle">
              {active === 'general' && '应用启动行为与界面语言'}
              {active === 'appearance' && '主题、密度与文字大小'}
              {active === 'notification' && '新消息提醒方式'}
              {active === 'chat' && '对话交互的默认行为'}
              {active === 'account' && '当前登录的账户信息'}
              {active === 'about' && '产品版本与说明'}
            </p>
          </header>

          <div className="settings-content-body">
            {active === 'general' && (
              <>
                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-row-title">默认进入模式</div>
                    <div className="setting-row-desc">登录后默认打开的工作区</div>
                  </div>
                  <Select
                    value={prefs.defaultMode}
                    onChange={(v) => update('defaultMode', v as AppDefaultMode)}
                    size="medium"
                    style={{ width: 160 }}
                  >
                    <Select.Option value="chat" label="对话"></Select.Option>
                    <Select.Option value="pro" label="智能体"></Select.Option>
                    <Select.Option value="task" label="任务"></Select.Option>
                  </Select>
                </div>

                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-row-title">界面语言</div>
                    <div className="setting-row-desc">部分文案随所选语言切换</div>
                  </div>
                  <Select
                    value={prefs.language}
                    onChange={(v) => update('language', v as AppLanguage)}
                    size="medium"
                    style={{ width: 160 }}
                  >
                    <Select.Option value="zh-CN" label="简体中文"></Select.Option>
                    <Select.Option value="en-US" label="English"></Select.Option>
                  </Select>
                </div>
              </>
            )}

            {active === 'appearance' && (
              <>
                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-row-title">主题</div>
                    <div className="setting-row-desc">切换浅色或深色外观</div>
                  </div>
                  <Radio.Group
                    value={theme}
                    variant="default-filled"
                    size="medium"
                    onChange={(val) => setTheme(val as 'light' | 'dark')}
                  >
                    <Radio.Button value="light">
                      <ModeLightIcon /> 浅色
                    </Radio.Button>
                    <Radio.Button value="dark">
                      <ModeDarkIcon /> 深色
                    </Radio.Button>
                  </Radio.Group>
                </div>

                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-row-title">界面密度</div>
                    <div className="setting-row-desc">紧凑模式可让信息更密集</div>
                  </div>
                  <Radio.Group
                    value={prefs.density}
                    variant="default-filled"
                    size="medium"
                    onChange={(v) => update('density', v as Density)}
                  >
                    <Radio.Button value="comfortable">舒适</Radio.Button>
                    <Radio.Button value="compact">紧凑</Radio.Button>
                  </Radio.Group>
                </div>

                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-row-title">正文字号</div>
                    <div className="setting-row-desc">当前 {prefs.fontSize}px</div>
                  </div>
                  <Slider
                    value={prefs.fontSize}
                    min={12}
                    max={18}
                    step={1}
                    onChange={(v) => update('fontSize', v as number)}
                    style={{ width: 200 }}
                  />
                </div>
              </>
            )}

            {active === 'notification' && (
              <>
                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-row-title">桌面通知</div>
                    <div className="setting-row-desc">收到新消息时在系统通知中心弹出</div>
                  </div>
                  <Switch
                    value={prefs.notifDesktop}
                    onChange={(v) => update('notifDesktop', v as boolean)}
                  />
                </div>
                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-row-title">提示音</div>
                    <div className="setting-row-desc">新消息到达时播放提示音</div>
                  </div>
                  <Switch
                    value={prefs.notifSound}
                    onChange={(v) => update('notifSound', v as boolean)}
                  />
                </div>
              </>
            )}

            {active === 'chat' && (
              <>
                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-row-title">Enter 发送消息</div>
                    <div className="setting-row-desc">关闭后需使用 Ctrl/Cmd + Enter 发送</div>
                  </div>
                  <Switch
                    value={prefs.enterToSend}
                    onChange={(v) => update('enterToSend', v as boolean)}
                  />
                </div>
                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-row-title">显示消息时间</div>
                    <div className="setting-row-desc">在每条消息旁显示发送时间</div>
                  </div>
                  <Switch
                    value={prefs.showTimestamp}
                    onChange={(v) => update('showTimestamp', v as boolean)}
                  />
                </div>
              </>
            )}

            {active === 'account' && (
              <div className="setting-row setting-row--block">
                <AccountSummary user={user} />
              </div>
            )}

            {active === 'about' && (
              <>
                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-row-title">当前版本</div>
                    <div className="setting-row-desc">由后端健康检查接口返回</div>
                  </div>
                  <span className="settings-version-pill">v{version}</span>
                </div>
                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-row-title">产品名称</div>
                    <div className="setting-row-desc">创路 Agent · 多模态智能工作台</div>
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-row-text">
                    <div className="setting-row-title">技术栈</div>
                    <div className="setting-row-desc">React + TypeScript + TDesign</div>
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </Dialog>
  );
}
