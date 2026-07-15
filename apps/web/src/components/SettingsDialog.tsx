/**
 * 设置模态框 —— 由侧边栏账户弹层「设置」按钮唤起
 * 布局参照 apps/web/docs/help-feedback.html 原型，全屏浮层 + 900×600 居中窗口
 * 内容区分组呈现：通用 / 外观 / 通知 / 对话 / 账户 / 关于
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Switch,
  Slider,
  Select,
  Radio,
  MessagePlugin,
} from 'tdesign-react';
import {
  SettingIcon,
  BrushIcon,
  NotificationIcon,
  ChatIcon,
  UserIcon,
  InfoCircleIcon,
  HelpCircleIcon,
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
type LinkOpenMode = 'always_ask' | 'builtin' | 'system';

interface Prefs {
  defaultMode: AppDefaultMode;
  language: AppLanguage;
  density: Density;
  fontSize: number;
  notifDesktop: boolean;
  notifSound: boolean;
  enterToSend: boolean;
  showTimestamp: boolean;
  voiceShortcut: boolean;
  linkOpenMode: LinkOpenMode;
  privacyMode: boolean;
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
  voiceShortcut: true,
  linkOpenMode: 'always_ask',
  privacyMode: false,
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
  { id: 'help', label: '帮助与反馈', icon: <HelpCircleIcon /> },
  { id: 'about', label: '关于', icon: <InfoCircleIcon /> },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

function AccountSummary({ user }: { user: UserProfile | null }) {
  // 已废弃：账户信息展示已重构为分组卡片形式
  return null;
}

export default function SettingsDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const [version, setVersion] = useState<string>('—');
  const [active, setActive] = useState<SectionId>('general');
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

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

  // 持久化偏好 + 应用密度/字号到根节点 CSS 变量
  useEffect(() => {
    savePrefs(prefs);
    const root = document.documentElement;
    root.style.setProperty('--app-font-size', `${prefs.fontSize}px`);
    root.dataset.density = prefs.density;
  }, [prefs]);

  // Escape 键关闭
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (visible) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [visible, handleKeyDown]);

  const update = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setPrefs((p) => ({ ...p, [k]: v }));
  };

  const section = useMemo(() => SECTIONS.find((s) => s.id === active) ?? SECTIONS[0], [active]);

  if (!visible) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      {/* 点击窗口内部不关闭 */}
      <div className="settings-window" onClick={(e) => e.stopPropagation()}>
        {/* 左侧分类导航 */}
        <aside className="settings-nav">
          <div className="settings-nav-head">
            <div className="settings-nav-avatar">
              {user?.avatar ? (
                <img src={user.avatar} alt={user?.nickname || user?.username || '用户'} />
              ) : (
                <span>{(user?.nickname || user?.username || '?').charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div className="settings-nav-account">
              <div className="settings-nav-name">{user?.nickname || user?.username || '未登录'}</div>
              <div className="settings-nav-meta">@{user?.username || '—'}</div>
            </div>
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
        <main className="settings-main">
          <button
            type="button"
            className="settings-close-btn"
            aria-label="关闭"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <header className="settings-main-head">
            <h1 className="settings-main-title">{section.label}</h1>
            <p className="settings-main-subtitle">
              {active === 'general' && '应用启动行为与界面语言'}
              {active === 'appearance' && '主题、密度与文字大小'}
              {active === 'notification' && '新消息提醒方式'}
              {active === 'chat' && '对话交互的默认行为'}
              {active === 'account' && '账户信息、用量与隐私设置'}
              {active === 'help' && '产品使用指引与问题反馈'}
              {active === 'about' && '产品版本与说明'}
            </p>
          </header>

          <div className="settings-main-body">
            {active === 'general' && (
              <>
                {/* 基础设置 */}
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
                        onChange={(val) => setTheme(val as 'light' | 'dark')}
                        size="medium"
                        style={{ width: 180 }}
                      >
                        <Select.Option value="light" label="亮色"></Select.Option>
                        <Select.Option value="dark" label="深色"></Select.Option>
                        <Select.Option value="system" label="跟随系统"></Select.Option>
                      </Select>
                    </div>

                    <div className="setting-row setting-row--card">
                      <div className="setting-row-text">
                        <div className="setting-row-title">语言</div>
                        <div className="setting-row-desc">选择您喜欢的按钮标签和应用内其他文本的语言</div>
                      </div>
                      <Select
                        value={prefs.language}
                        onChange={(v) => update('language', v as AppLanguage)}
                        size="medium"
                        style={{ width: 180 }}
                      >
                        <Select.Option value="zh-CN" label="简体中文"></Select.Option>
                        <Select.Option value="en-US" label="English"></Select.Option>
                      </Select>
                    </div>
                  </div>
                </section>

                {/* 偏好设置 */}
                <section className="settings-group">
                  <h3 className="settings-group-title">偏好设置</h3>
                  <div className="settings-group-card">
                    <div className="setting-row setting-row--card">
                      <div className="setting-row-text">
                        <div className="setting-row-title">语音转录快捷键</div>
                        <div className="setting-row-desc">开启或关闭语音转录快捷键，录制自定义组合键，或恢复默认值。</div>
                      </div>
                      <div className="setting-row-controls">
                        <Switch
                          value={prefs.voiceShortcut}
                          onChange={(v) => update('voiceShortcut', v as boolean)}
                        />
                        <span className="settings-kbd-group">
                          <span className="settings-kbd">Alt</span>
                          <span className="settings-kbd-plus">+</span>
                          <span className="settings-kbd">V</span>
                        </span>
                        <button
                          type="button"
                          className="settings-icon-btn"
                          aria-label="自定义快捷键"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div className="setting-row setting-row--card">
                      <div className="setting-row-text">
                        <div className="setting-row-title">本地链接的默认打开方式</div>
                        <div className="setting-row-desc">点击终端中的本地链接时，是否自动使用内置浏览器打开</div>
                      </div>
                      <Select
                        value={prefs.linkOpenMode}
                        onChange={(v) => update('linkOpenMode', v as LinkOpenMode)}
                        size="medium"
                        style={{ width: 180 }}
                      >
                        <Select.Option value="always_ask" label="始终询问"></Select.Option>
                        <Select.Option value="builtin" label="内置浏览器"></Select.Option>
                        <Select.Option value="system" label="系统默认"></Select.Option>
                      </Select>
                    </div>
                  </div>
                </section>
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
              <>
                {/* 账户信息 */}
                <section className="settings-group">
                  <h3 className="settings-group-title">账户信息</h3>
                  <div className="settings-group-card">
                    <div className="setting-row setting-row--card">
                      <div className="setting-row-text">
                        <div className="setting-row-title">{user?.nickname || user?.username || '未登录'}</div>
                        <div className="setting-row-desc">
                          {user?.phone ? `${user.phone.slice(0, 3)}*****${user.phone.slice(-2)}` : '未绑定手机号'}
                        </div>
                      </div>
                      <div className="setting-row-controls">
                        <button
                          type="button"
                          className="settings-action-pill"
                          onClick={() => MessagePlugin.info('管理账号功能正在建设中')}
                        >
                          管理账号
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="settings-icon-btn"
                          aria-label="更多"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="5" cy="12" r="1" />
                            <circle cx="12" cy="12" r="1" />
                            <circle cx="19" cy="12" r="1" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div className="setting-row setting-row--card">
                      <div className="setting-row-text">
                        <div className="setting-row-title">免费</div>
                        <div className="setting-row-desc">升级权益，获取更多速通次数，享受更流畅的 AI 使用体验</div>
                      </div>
                      <button
                        type="button"
                        className="settings-action-pill settings-action-pill--primary"
                        onClick={() => MessagePlugin.info('升级权益功能正在建设中')}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                        升级权益
                      </button>
                    </div>
                  </div>
                </section>


                {/* 隐私模式 */}
                <section className="settings-group">
                  <h3 className="settings-group-title">隐私模式</h3>
                  <div className="settings-group-card">
                    <div className="setting-row setting-row--card">
                      <div className="setting-row-text">
                        <div className="setting-row-title">隐私模式</div>
                        <div className="setting-row-desc">
                          启用后，TRAE 不会将您的聊天互动、代码片段和 AI 输出用于产品改进和模型训练。
                          <a
                            href="#"
                            className="settings-inline-link"
                            onClick={(e) => {
                              e.preventDefault();
                              MessagePlugin.info('隐私模式说明');
                            }}
                          >
                            了解更多
                          </a>
                        </div>
                      </div>
                      <div className="setting-row-controls">
                        <Switch
                          value={prefs.privacyMode}
                          onChange={(v) => update('privacyMode', v as boolean)}
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
                  {/* 帮助文档 */}
                  <li
                    className="help-item"
                    onClick={() => window.open('https://example.com/docs', '_blank')}
                  >
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
                  <li
                    className="help-item"
                    onClick={() => MessagePlugin.info('意见反馈功能正在建设中')}
                  >
                    <span className="help-item__left">
                      <svg className="help-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      意见反馈
                    </span>
                  </li>

                  {/* 联系我们 */}
                  <li
                    className="help-item"
                    onClick={() => window.open('mailto:support@example.com', '_blank')}
                  >
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
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      MessagePlugin.info('隐私政策');
                    }}
                  >
                    隐私政策
                  </a>
                  <span className="help-footer__divider">|</span>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      MessagePlugin.info('服务协议');
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
    </div>
  );
}
