const polars = [
  {
    flag: '🇺🇸 美国',
    pct: '38%',
    label: '全球 AI 投资占比',
    data: '私人投资 $1,091 亿 | 顶级模型数量领先 | 仅领先中国 2.7%',
    stagger: 'stagger-1',
  },
  {
    flag: '🇨🇳 中国',
    pct: '26%',
    label: '全球 AI 投资占比',
    data: '论文及引用量居首 | 专利总量领先 | 工业机器人安装量第一',
    stagger: 'stagger-2',
  },
  {
    flag: '🇪🇺 欧盟',
    pct: '18%',
    label: '全球 AI 投资占比',
    data: 'EU AI Act 率先生效 | 全球监管信任度最高 | 开源生态贡献增长迅速',
    stagger: 'stagger-3',
  },
];

export function PolarSection() {
  return (
    <section id="polar" className="section">
      <div className="section-title">中美欧三极格局</div>
      <p className="section-subtitle">全球 AI 投资分布与竞争态势</p>

      <div className="polar-grid">
        {polars.map((p, i) => (
          <div className={`polar-card animate-fade-up ${p.stagger}`} key={i}>
            <div className="polar-flag">{p.flag}</div>
            <div className="polar-pct">{p.pct}</div>
            <div className="polar-label">{p.label}</div>
            <div className="polar-data">{p.data}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
