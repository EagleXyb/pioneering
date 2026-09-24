'use client'

// ============================================================
// FloatingAgent — 全局右下角悬浮智能体入口（演示对话）
// /agent 页面按原型约定不显示该入口。
// ============================================================

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  DEMO_MESSAGES,
  FAB_TITLE,
  FAB_SUBTITLE,
  FAB_AVATAR,
  FAB_PLACEHOLDER,
  FAB_HINT,
} from '@/data/site/chat'
import { ChatIcon } from '@/components/site/ui/Icons'

export function FloatingAgent() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  if (pathname === '/agent' || pathname.startsWith('/agent/')) return null

  return (
    <>
      <button
        type="button"
        className="fab"
        aria-label={open ? '收起智能体' : '打开智能体'}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M1 1l14 14M15 1L1 15" stroke="#fff" strokeWidth="1.8" />
          </svg>
        ) : (
          <ChatIcon />
        )}
      </button>
      <div className={`fab-panel${open ? ' open' : ''}`}>
        <div className="fab-head">
          <div className="avatar" style={{ background: 'var(--celadon)', border: 'none' }}>
            {FAB_AVATAR}
          </div>
          <div>
            <div className="t">{FAB_TITLE}</div>
            <div className="s">{FAB_SUBTITLE}</div>
          </div>
        </div>
        <div className="fab-body">
          {DEMO_MESSAGES.map((m, i) => (
            <div key={i} className={`msg${m.from === 'me' ? ' me' : ''}`}>
              {m.paras.map((p, j) => (
                <span key={j}>
                  {p}
                  {j < m.paras.length - 1 && <br />}
                </span>
              ))}
              {m.source && (
                <>
                  {' '}
                  <span className="src">↳ {m.source}</span>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="fab-foot">
          <input type="text" placeholder={FAB_PLACEHOLDER} aria-label="对话输入" />
          <div className="fab-hint">{FAB_HINT}</div>
        </div>
      </div>
    </>
  )
}
