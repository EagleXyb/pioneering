const metrics = [
  {
    headline: '全球 AI 支出',
    value: '$301B',
    info: '↑ 35.2% YoY | 预计 2028 年达 $632B',
    src: '来源: IDC Worldwide AI Spending Guide 2026',
    pf: 'pf-1',
    stagger: 'stagger-1',
  },
  {
    headline: '企业 AI 采用率',
    value: '72%',
    info: '88% 组织已使用 AI | 83% 大企业已部署',
    src: '来源: McKinsey Global AI Survey 2025/2026',
    pf: 'pf-2',
    stagger: 'stagger-2',
  },
  {
    headline: 'Token 价格年降幅',
    value: '93%',
    info: '$20 → $0.07/百万 token | 推理成本 3 年降 90%',
    src: '来源: Stanford HAI AI Index 2026',
    pf: 'pf-3',
    stagger: 'stagger-3',
  },
];

export function DataSection() {
  return (
    <section id="data" className="section">
      <div className="section-title">关键数据</div>
      <p className="section-subtitle">全球 AI 市场的核心指标一览</p>

      <div className="metrics-grid">
        {metrics.map((m, i) => (
          <div className={`metric-card animate-fade-up ${m.stagger}`} key={i}>
            <div className="metric-headline">{m.headline}</div>
            <div className="metric-value">{m.value}</div>
            <div className="metric-info">{m.info}</div>
            <div className="metric-src">{m.src}</div>
            <div className="progress-bar">
              <div className={`progress-fill ${m.pf}`} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
