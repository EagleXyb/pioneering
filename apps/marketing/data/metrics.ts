export interface Metric {
  headline: string
  value: string
  info: string
  src: string
  width: string
}

export const metrics: Metric[] = [
  {
    headline: '全球 AI 支出',
    value: '$301B',
    info: '↑ 35.2% YoY | 预计 2028 年达 $632B',
    src: '来源: IDC Worldwide AI Spending Guide 2026',
    width: '80%',
  },
  {
    headline: '企业 AI 采用率',
    value: '72%',
    info: '88% 组织已使用 AI | 83% 大企业已部署',
    src: '来源: McKinsey Global AI Survey 2025/2026',
    width: '60%',
  },
  {
    headline: 'Token 价格年降幅',
    value: '93%',
    info: '$20 → $0.07/百万 token | 推理成本 3 年降 90%',
    src: '来源: Stanford HAI AI Index 2026',
    width: '28%',
  },
]
