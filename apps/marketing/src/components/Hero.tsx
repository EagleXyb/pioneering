const stats = [
  { value: '$301B', label: '全球 AI 支出 (2026)', source: 'IDC' },
  { value: '72%', label: '企业 AI 采用率', source: 'McKinsey' },
  { value: '280×', label: '推理成本降幅 (2年)', source: 'Stanford HAI' },
  { value: '88%', label: '组织已采用 AI', source: 'McKinsey' },
];

export function Hero() {
  return (
    <section className="hero animate-fade-in">
      <div className="badge">
        <span className="badge-dot" />
        <span className="badge-text">Stanford HAI · McKinsey · a16z · Gartner · IDC</span>
      </div>
      <h1 className="headline">AI 发展趋势</h1>
      <p className="subheadline">2025–2026 最新趋势分析报告</p>
      <p className="hero-desc">
        基于 Stanford HAI 2026 AI Index、McKinsey The State of AI、a16z Big Ideas 2026、Gartner、IDC
        等全球顶级研究机构的最新数据与洞察
      </p>

      <div className="stats-bar animate-fade-up">
        {stats.map((stat, i) => (
          <div className="stat-item" key={i}>
            <div className="stat-value">{stat.value}</div>
            <div className="stat-label">{stat.label}</div>
            <div className="stat-source">{stat.source}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
