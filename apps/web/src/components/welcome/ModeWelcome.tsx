import { useNavigate } from 'react-router-dom';
import { MODE_ICONS } from '@/components/icons/modeIcons';
import type { AppMode } from '@/types';
import './welcome.css';

interface ModeCard {
  key: AppMode;
  title: string;
  desc: string;
  to: string;
  cta: string;
}

/**
 * 三种模式触达卡片（chat / pro / task 欢迎页共用）。
 * 图标取自 MODE_ICONS，与侧栏模式切换、会话项标记保持同一图形。
 */
const MODE_CARDS: ModeCard[] = [
  {
    key: 'chat',
    title: '对话写作',
    desc: '即时问答、长文创作，多模态理解图文内容',
    to: '/chat',
    cta: '直接开始',
  },
  {
    key: 'pro',
    title: '智能分析',
    desc: '自动拆解复杂问题，实时展示推理链路',
    to: '/pro',
    cta: '开始分析',
  },
  {
    key: 'task',
    title: '任务执行',
    desc: 'Plan-and-Execute，自动规划多步操作',
    to: '/task',
    cta: '创建任务',
  },
];

export interface ModeWelcomeProps {
  /** 顶部徽章文案 */
  badge: string;
  /** 主标题 */
  title: string;
  /** 副标题说明 */
  subtitle: string;
  /** 一键发送的建议词 */
  suggestions: readonly string[];
  /** 点击建议词回调（由各模式触发发送） */
  onSuggestion: (text: string) => void;
}

/**
 * 模式欢迎页 —— 空会话首屏的通用布局（chat / task 共用）。
 *
 * 承载：徽章 + 价值主张、三种模式触达卡片、新手引导建议词与微交互动效。
 * 视觉样式见同级 welcome.css，全部使用设计 Token，
 * 自动适配浅色/深色与桌面/移动端。
 */
export function ModeWelcome({
  badge,
  title,
  subtitle,
  suggestions,
  onSuggestion,
}: ModeWelcomeProps) {
  const navigate = useNavigate();

  return (
    <div className="chat-welcome">
      <div className="chat-welcome-glow" aria-hidden />

      <div className="chat-welcome-inner">
        <span className="chat-welcome-badge">
          <span className="chat-welcome-badge-dot" />
          {badge}
        </span>

        <h1 className="chat-welcome-title">{title}</h1>
        <p className="chat-welcome-subtitle">{subtitle}</p>

        {/* 核心功能触达路径：三种模式 */}
        <div className="chat-welcome-cards">
          {MODE_CARDS.map((c) => {
            const Icon = MODE_ICONS[c.key];
            return (
              <button
                key={c.key}
                type="button"
                className="chat-welcome-card"
                onClick={() => navigate(c.to)}
                aria-label={`${c.title} · ${c.cta}`}
              >
                <span className="chat-welcome-card-icon">
                  <Icon size={22} aria-hidden="true" />
                </span>
                <span className="chat-welcome-card-title">{c.title}</span>
                <span className="chat-welcome-card-desc">{c.desc}</span>
                <span className="chat-welcome-card-cta">
                  {c.cta}
                  <span className="chat-welcome-card-arrow" aria-hidden>→</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* 新手引导：一键发送示例 */}
        <div className="chat-welcome-suggestions">
          <span className="chat-welcome-suggestions-label">不知道从哪开始？试试这些</span>
          <div className="chat-welcome-chips">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                className="chat-welcome-chip"
                onClick={() => onSuggestion(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
