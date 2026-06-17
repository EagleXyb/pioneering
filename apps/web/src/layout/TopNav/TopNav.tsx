import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '../../store/appStore';
import { useToast } from '../../store/toastContext';
import './topnav.css';

type PreviewState = 'normal' | 'loading' | 'error' | 'empty';

export function TopNav() {
  const { toggleSidebar } = useAppStore();
  const { showToast } = useToast();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeState, setActiveState] = useState<PreviewState>('normal');
  const [showError, setShowError] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('click', handler);
      return () => document.removeEventListener('click', handler);
    }
  }, [dropdownOpen]);

  const handleStateChange = useCallback((state: PreviewState) => {
    setActiveState(state);
    setShowError(false);
    setShowLoading(false);
    switch (state) {
      case 'loading':
        setShowLoading(true);
        break;
      case 'error':
        setShowError(true);
        break;
    }
    setDropdownOpen(false);
  }, []);

  return (
    <nav className="top-nav">
      <button className="btn-sidebar-toggle" onClick={toggleSidebar}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 5h14M3 10h14M3 15h14"/>
        </svg>
      </button>

      <div className="nav-spacer" />

      {showLoading && (
        <div className="inline-loading-bar">
          <div className="inline-loading-fill" />
        </div>
      )}

      {showError && (
        <div className="inline-error">
          <div className="inline-error-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4M12 16h.01"/>
            </svg>
          </div>
          <div className="inline-error-body">
            <div className="inline-error-title">响应中断</div>
            <div className="inline-error-desc">Agent 执行过程中遇到异常，可能是网络波动或服务端临时不可用。</div>
          </div>
          <button className="inline-error-retry" onClick={() => { setShowError(false); showToast('重试中...'); }}>
            重试
          </button>
          <button className="inline-error-close" aria-label="关闭错误提示" onClick={() => setShowError(false)}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l6 6M10 4l-6 6"/>
            </svg>
          </button>
        </div>
      )}

      <div className="nav-actions">
        <div className="state-preview-wrap" ref={wrapRef}>
          <button
            className="state-preview-trigger"
            onClick={() => setDropdownOpen(p => !p)}
            aria-label="状态演示"
            aria-haspopup="true"
          >
            状态
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 3.5l2 3 2-3"/>
            </svg>
            <span className="state-preview-tooltip">原型状态演示</span>
          </button>
          {dropdownOpen && (
            <div className="state-preview-dropdown">
              {(['normal', 'loading', 'error', 'empty'] as PreviewState[]).map(s => (
                <button
                  key={s}
                  className={activeState === s ? 'active' : ''}
                  onClick={() => handleStateChange(s)}
                >
                  {s === 'normal' && '正常'}
                  {s === 'loading' && '加载中'}
                  {s === 'error' && '错误'}
                  {s === 'empty' && '空状态'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}