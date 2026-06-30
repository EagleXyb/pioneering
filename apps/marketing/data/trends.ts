export interface Trend {
  num: string
  title: string
  desc: string
  badge: string
}

export const leftTrends: Trend[] = [
  {
    num: '01',
    title: 'Agent 化跃迁',
    desc: 'AI Agent 从实验走向生产。Gartner 预测 2026 年 40% 企业应用将嵌入智能体能力，智能体市场规模预计达 $201.9B。多智能体协作系统成为新范式，企业从「试点」转向「规模化部署」。',
    badge: 'CAGR 119% · Gartner',
  },
  {
    num: '02',
    title: '推理成本崩塌',
    desc: '达到 GPT-3.5 水平的推理成本在两年内暴跌 280 倍（从 $20/百万 token 降至 $0.07）。硬件成本每年下降约 30%，能效每年提升约 40%。Inference cost 三年累计下降 90%，AI 从奢侈品变为基础设施。',
    badge: '280× 下降 · Stanford HAI',
  },
  {
    num: '03',
    title: '多模态融合',
    desc: 'AI 从单模态向多模态深度融合发展。前沿模型在博士级科学问题、多模态推理和数学竞赛中已达到或超越人类水平。AI 性能基准一年内提升 67%，视频即空间、世界模型等新范式加速成型。',
    badge: '基准提升 67% · Stanford HAI',
  },
]

export const rightTrends: Trend[] = [
  {
    num: '04',
    title: '端侧智能爆发',
    desc: '全球 67% 企业已在公有云运行 AI 工作负载，端侧推理需求激增。AI 芯片及硬件市场达 $98B，推理成本下降使小模型在手机、IoT 设备上运行成为可能。边缘 AI 正从概念走向规模化。',
    badge: '$98B 硬件市场 · IDC',
  },
  {
    num: '05',
    title: '垂直行业深耕',
    desc: '金融服务业 AI 支出达 $3,200/人（行业均值的 2.6 倍）。制造 AI 支出同比增长 48%，医疗 AI 采用率 62%。AI 在客服和软件开发领域带来 14%-26% 生产力提升，行业级 AI 解决方案加速渗透。',
    badge: '采用率 62%-88% · McKinsey',
  },
  {
    num: '06',
    title: '治理与对齐',
    desc: 'AI 安全事故从 2024 年 233 起激增至 2025 年 362 起。76% 企业将数据隐私和安全列为首要 AI 风险。EU AI Act 已生效，42% 全球企业调整 AI 实践以符合合规要求。负责任的 AI 框架建设刻不容缓。',
    badge: '安全事故 +55% · Stanford HAI',
  },
]
