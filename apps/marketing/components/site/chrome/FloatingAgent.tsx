'use client'

// ============================================================
// FloatingAgent — 全局右下角悬浮智能体入口（预设演示对话）
// /agent 页面按原型约定不显示该入口。
//
// 演示面板只展示预设对话片段，不提供输入；点击「前往体验页」
// 跳转 /agent#try 进行真实体验，避免假输入框误导用户。
// ============================================================

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  DEMO_MESSAGES,
  FAB_TITLE,
  FAB_SUBTITLE,
  FAB_AVATAR,
} from '@/data/site/chat'
import { ChatIcon } from '@/components/site/ui/Icons'

const PANEL_ID = 'fab-panel'

export function FloatingAgent() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Esc 关闭（焦点回到触发钮）+ 外部点击关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        requestAnimationFrame(() => buttonRef.current?.focus())
      }
    }
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        panelRef.current &&
        !panelRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDocClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDocClick)
    }
  }, [open])

  if (pathname === '/agent' || pathname.startsWith('/agent/')) return null

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="fab"
        aria-label={open ? '收起智能体演示对话' : '打开智能体演示对话'}
        aria-expanded={open}
        aria-controls={PANEL_ID}
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
      <div
        ref={panelRef}
        id={PANEL_ID}
        className={`fab-panel${open ? ' open' : ''}`}
        role="dialog"
        aria-label={`${FAB_TITLE} · 预设演示对话`}
      >
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
          <Link href="/agent#try" className="fab-go" onClick={() => setOpen(false)}>
            前往体验页继续对话 →
          </Link>
          <div className="fab-hint">以上为预设演示片段 · 体验页可输入真实问题</div>
        </div>
      </div>
    </>
  )
}
