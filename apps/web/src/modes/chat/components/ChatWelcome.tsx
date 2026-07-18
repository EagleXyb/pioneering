import { useNavigate } from 'react-router';
import type { ReactNode } from 'react';

interface Props {
  /** 点击建议词时回调（由 ChatMode 触发发送） */
  onSuggestion: (text: string) => void;
}

interface ModeCard {
  key: 'chat' | 'pro' | 'task';
  title: string;
  desc: string;
  icon: ReactNode;
  to: string;
  cta: string;
}

const MODE_CARDS: ModeCard[] = [
  {
    key: 'chat',
    title: '对话写作',
    desc: '即时问答、长文创作，多模态理解图文内容',
    to: '/chat',
    cta: '直接开始',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z" />
      </svg>
    ),
  },
  {
    key: 'pro',
    title: '智能分析',
    desc: '自动拆解复杂问题，实时展示推理链路',
    to: '/pro',
    cta: '开始分析',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    key: 'task',
    title: '任务执行',
    desc: 'Plan-and-Execute，自动规划多步操作',
    to: '/task',
    cta: '创建任务',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="3" width="18" height="18" rx="2.5" />
        <path d="M8 12l3 3 5-6" />
      </svg>
    ),
  },
];

const SUGGESTIONS = [
  '帮我分析上季度销售流失的原因',
  '写一份新产品发布会的演讲稿',
  '把这段会议纪要整理成待办清单',
  '本季度各渠道投入产出比如何',
];

/**
 * 初始欢迎页 —— 登录后首次进入 /chat 时的首屏。
 * 承载：核心价值主张、三种模式触达、新手引导建议词、微交互动效。
 * 全部使用设计 Token，自动适配浅色/深色与桌面/移动端。
 */
export function ChatWelcome({ onSuggestion }: Props) {
  const navigate = useNavigate();

  return (
    <div className="chat-welcome">
      <div className="chat-welcome-glow" aria-hidden />

      <div className="chat-welcome-inner">
        <span className="chat-welcome-badge">
          <span className="chat-welcome-badge-dot" />
          多模态智能工作台
        </span>

        <h1 className="chat-welcome-title">你好，今天想做点什么？</h1>
        <p className="chat-welcome-subtitle">
          对话、分析、任务，一个工作台全搞定。创路 Agent 帮你把创意高效落地，安全可靠。
        </p>

        {/* 核心功能触达路径：三种模式 */}
        <div className="chat-welcome-cards">
          {MODE_CARDS.map((c) => (
            <button
              key={c.key}
              type="button"
              className="chat-welcome-card"
              onClick={() => navigate(c.to)}
              aria-label={`${c.title} · ${c.cta}`}
            >
              <span className="chat-welcome-card-icon">{c.icon}</span>
              <span className="chat-welcome-card-title">{c.title}</span>
              <span className="chat-welcome-card-desc">{c.desc}</span>
              <span className="chat-welcome-card-cta">
                {c.cta}
                <span className="chat-welcome-card-arrow" aria-hidden>→</span>
              </span>
            </button>
          ))}
        </div>

        {/* 新手引导：一键发送示例 */}
        <div className="chat-welcome-suggestions">
          <span className="chat-welcome-suggestions-label">不知道从哪开始？试试这些</span>
          <div className="chat-welcome-chips">
            {SUGGESTIONS.map((s) => (
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
