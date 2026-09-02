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

/**
 * 官网首页 Hero 数据条 — 突出 Pioneering 产品定位
 *
 * 与 `heroStats` 互不依赖：heroStats 偏宏观行业数据，
 * heroPillars 偏产品能力维度（云边双模 / 智能体 / 工具协议 / 安全）。
 */
export const heroPillars: HeroStat[] = [
  { value: '云边双模', label: '本地 + 云端统一运行时', source: 'Edge' },
  { value: 'Multi-Agent', label: 'LangGraph 编排与早停', source: 'Agent' },
  { value: 'MCP', label: '工具与技能开放协议', source: 'Tools' },
  { value: 'HITL', label: '人机协作审批与回滚', source: 'Governance' }
]
