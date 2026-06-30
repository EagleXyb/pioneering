export interface HeroStat {
  value: string
  label: string
  source: string
}

export const heroStats: HeroStat[] = [
  { value: '$301B', label: '全球 AI 支出 (2026)', source: 'IDC' },
  { value: '72%', label: '企业 AI 采用率', source: 'McKinsey' },
  { value: '280×', label: '推理成本降幅 (2年)', source: 'Stanford HAI' },
  { value: '88%', label: '组织已采用 AI', source: 'McKinsey' },
]
