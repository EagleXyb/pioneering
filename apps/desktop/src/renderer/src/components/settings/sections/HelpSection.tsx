// ============================================================
// HelpSection — 帮助与反馈内容组件
//   严格匹配 apps/web/docs/help-feedback.html 原型样式：
//   3 个帮助列表项 + 底部隐私政策/服务协议。
// ============================================================

export function HelpSection() {
  return (
    <div className="flex flex-col h-full">
      {/* 帮助列表 */}
      <ul className="list-none m-0 p-0 flex flex-col gap-2">
        {/* 帮助文档 */}
        <li
          className="flex items-center justify-between px-4 py-[13px] rounded-[5px] cursor-pointer select-none transition-colors duration-150"
          style={{ background: '#f7f7f7', color: '#262626' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#f7f7f7')}
          onClick={() => window.open('https://example.com/docs', '_blank')}
        >
          <span className="flex items-center gap-[10px] text-sm">
            <svg className="shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8c8c8c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            帮助文档
          </span>
          <svg className="shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#bfbfbf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </li>

        {/* 意见反馈 */}
        <li
          className="flex items-center justify-between px-4 py-[13px] rounded-[5px] cursor-pointer select-none transition-colors duration-150"
          style={{ background: '#f7f7f7', color: '#262626' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#f7f7f7')}
          onClick={() => alert('意见反馈功能正在建设中')}
        >
          <span className="flex items-center gap-[10px] text-sm">
            <svg className="shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8c8c8c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            意见反馈
          </span>
        </li>

        {/* 联系我们 */}
        <li
          className="flex items-center justify-between px-4 py-[13px] rounded-[5px] cursor-pointer select-none transition-colors duration-150"
          style={{ background: '#f7f7f7', color: '#262626' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#f7f7f7')}
          onClick={() => window.open('mailto:support@example.com', '_blank')}
        >
          <span className="flex items-center gap-[10px] text-sm">
            <svg className="shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8c8c8c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            联系我们
          </span>
          <svg className="shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#bfbfbf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </li>
      </ul>

      {/* 页脚 */}
      <div className="mt-6 text-center text-[13px]" style={{ color: '#bfbfbf' }}>
        <a
          href="#"
          className="no-underline transition-colors"
          style={{ color: '#bfbfbf' }}
          onClick={(e) => {
            e.preventDefault()
            alert('隐私政策')
          }}
        >
          隐私政策
        </a>
        <span className="mx-2" style={{ color: '#d9d9d9' }}>|</span>
        <a
          href="#"
          className="no-underline transition-colors"
          style={{ color: '#bfbfbf' }}
          onClick={(e) => {
            e.preventDefault()
            alert('服务协议')
          }}
        >
          服务协议
        </a>
      </div>
    </div>
  )
}
