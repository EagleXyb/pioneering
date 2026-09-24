// ============================================================
// DecorDiagram — 原型统一使用的「认知加工模型」装饰示意图
// 多页占位视觉（docs/site 各页 .img-zone SVG，标记为品牌视觉占位）
// ============================================================

export function DecorDiagram({ caption = '示意图 · 认知加工模型（品牌视觉占位）' }: { caption?: string }) {
  return (
    <svg viewBox="0 0 1200 800" fill="none" className="img-zone" role="img" aria-label={caption}>
      <rect width="1200" height="800" fill="#F3F0E9" />
      <circle cx="600" cy="400" r="240" stroke="#2F7A72" strokeWidth="2" strokeDasharray="6 8" opacity=".5" />
      <circle cx="600" cy="400" r="150" stroke="#12203A" strokeWidth="2" opacity=".3" />
      <circle cx="600" cy="400" r="60" fill="#2F7A72" opacity=".12" />
      <path d="M600 80v120M600 600v120M280 400h120M800 400h120" stroke="#12203A" strokeWidth="2" />
      <rect x="520" y="340" width="160" height="120" rx="8" fill="#fff" stroke="#D6D1C8" />
      <path d="M560 380h80M560 410h60" stroke="#2F7A72" strokeWidth="3" strokeLinecap="round" />
      <text x="600" y="700" textAnchor="middle" fill="#8A94A6" fontSize="22">
        {caption}
      </text>
    </svg>
  )
}
