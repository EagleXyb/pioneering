export type ConfidenceLevel = 'high' | 'mid' | 'low'

export interface Prediction {
  num: string
  title: string
  detail: string
  confidence: ConfidenceLevel
  badgeText: string
}

export const predictions: Prediction[] = [
  {
    num: '1',
    title: 'AI Agent 进入规模化部署阶段，40% 企业应用将嵌入智能体能力',
    detail: 'Gartner 预测 Agentic AI 支出 CAGR 达 119%，2027 年将超越聊天机器人支出',
    confidence: 'high',
    badgeText: '高信度',
  },
  {
    num: '2',
    title: '推理成本继续断崖式下降，开源与闭源性能差距缩小至 2% 以内',
    detail: 'Stanford HAI 报告显示闭源 vs 开源差距已从 24.2% 缩小至 1.7%，AI 民主化加速',
    confidence: 'high',
    badgeText: '高信度',
  },
  {
    num: '3',
    title: '多模态 AI 全面落地，视频生成进入可交互、物理一致的新阶段',
    detail: 'a16z 预测「视频即空间」范式兴起，世界模型将内容生成从单一作品升级为可栖居的虚拟现实',
    confidence: 'mid',
    badgeText: '中信度',
  },
  {
    num: '4',
    title: '中美 AI 竞赛白热化，中国在论文、专利维度持续领先，美国在投资和顶级模型略占优势',
    detail: 'Stanford HAI 报告显示中美模型差距仅 2.7%，美国私人投资 $1,091 亿约为中国 12 倍',
    confidence: 'mid',
    badgeText: '中信度',
  },
  {
    num: '5',
    title: '全球 AI 监管框架加速成型，40% 以上企业将因 EU AI Act 调整合规实践',
    detail: 'AI 安全事故 2025 年达 362 起，76% 企业视数据隐私为首要风险，AI 伦理委员会普及率仍不足 30%',
    confidence: 'low',
    badgeText: '低信度',
  },
]
