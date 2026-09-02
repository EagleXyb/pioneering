// ============================================================
// 欢迎页数据配置 — 功能标签与模板卡片
// ============================================================
// 本文件为欢迎页的纯数据层，与组件解耦：
//   - WELCOME_FEATURES：功能标签配置
//   - TEMPLATES_BY_FEATURE：各功能标签下的模板列表
//
// 缩略图风格设计原则（对齐参考图）：
//   - 每个模板指定 scene 类型，TemplateCard 据此渲染场景化缩略图：
//       'habit'    : 习惯打卡台历桌面实景
//       'flow'     : 流程图 / 作业流程
//       'benchmark': 六边形雷达 + 柱状图（模型测评）
//       'portfolio': 雷达图 + 柱状图（基金诊断）
//       'resume'   : 简历文档
//       'event'    : 活动策划画板
//       'brand'    : 品牌方案情绪板
//       'article'  : 文章编辑器
//       'report'   : 工作汇报数据看板
//       'pitch'    : 产品路演幻灯片
//       'training' : 培训课件
//       'insight'  : 数据洞察
//       'forecast' : 预测模型
//       'tech'     : 技术调研
//       'market'   : 市场研究
//       'academic' : 学术综述
//   - 背景使用柔和渐变 / 轻量图案，明暗主题兼容
// ============================================================

// ---- 类型定义 ----
export interface WelcomeFeature {
  id: string
  label: string
}

export type TemplateScene =
  | 'habit'
  | 'flow'
  | 'benchmark'
  | 'portfolio'
  | 'resume'
  | 'event'
  | 'brand'
  | 'article'
  | 'report'
  | 'pitch'
  | 'training'
  | 'insight'
  | 'forecast'
  | 'tech'
  | 'market'
  | 'academic'

export interface TemplateItem {
  id: string
  title: string
  desc: string
  prompt: string
  /** 缩略图背景渐变（Tailwind bg-gradient-to-br from-x via-y to-z） */
  gradient: string
  /** 缩略图场景类型（决定 TemplateCard 内部画什么） */
  scene: TemplateScene
}

// ---- 功能标签 ----
export const WELCOME_FEATURES: WelcomeFeature[] = [
  { id: 'doc',      label: '生成文档' },
  { id: 'ppt',      label: '生成PPT' },
  { id: 'data',     label: '数据分析' },
  { id: 'research', label: '深度研究' }
]

// ---- 默认激活的功能标签 ID ----
export const DEFAULT_FEATURE_ID = WELCOME_FEATURES[0]!.id

// ---- 各功能标签下的模板列表 ----
// 每个 feature 至少 8 个模板，支持「换一批」轮换展示（每次 4 个）
export const TEMPLATES_BY_FEATURE: Record<string, TemplateItem[]> = {
  doc: [
    {
      id: 'habit-tracker',
      title: '治愈系习惯打卡台',
      desc: '每日打卡与习惯养成计划',
      prompt: '帮我设计一份治愈系习惯打卡台，包含每日打卡、月度复盘和鼓励语',
      gradient: 'from-[#F5EFE6] via-[#EFE7D8] to-[#E6DCC8]',
      scene: 'habit'
    },
    {
      id: 'customer-sop',
      title: '客户投诉处理标准作业流程',
      desc: 'SOP 流程图与关键节点说明',
      prompt: '帮我整理客户投诉处理的标准作业流程，输出结构化 SOP 与责任分工',
      gradient: 'from-[#F7F7F8] via-[#EFEFF1] to-[#E6E6E9]',
      scene: 'flow'
    },
    {
      id: 'resume',
      title: '求职面试准备包',
      desc: '自我介绍与常见问答准备',
      prompt: '帮我准备一份面试自我介绍，包含个人优势、项目亮点和常见问题回答',
      gradient: 'from-[#F0F4EF] via-[#E6EEE4] to-[#DAE5D7]',
      scene: 'resume'
    },
    {
      id: 'event-plan',
      title: '线下沙龙活动策划',
      desc: '主题、流程、预算与分工',
      prompt: '帮我策划一场线下沙龙活动，包含主题、流程、预算和分工清单',
      gradient: 'from-[#F5EEE6] via-[#EDE2D4] to-[#E4D3BD]',
      scene: 'event'
    },
    {
      id: 'brand-plan',
      title: '新消费品牌定位方案',
      desc: '品牌定位与传播策略',
      prompt: '帮我制定新消费品牌定位方案，包含用户画像、差异化卖点和传播策略',
      gradient: 'from-[#F0EBF5] via-[#E3DAEE] to-[#D5C8E5]',
      scene: 'brand'
    },
    {
      id: 'article-blog',
      title: '深度行业文章撰写',
      desc: '专业长文 / 公众号内容',
      prompt: '帮我撰写一篇深度行业分析文章，结构清晰、论据充分、语言专业',
      gradient: 'from-[#F5ECEC] via-[#EED9D9] to-[#E5C4C4]',
      scene: 'article'
    },
    {
      id: 'okr-writing',
      title: '季度 OKR 制定',
      desc: '目标拆解与关键结果',
      prompt: '帮我制定部门季度 OKR，包含目标拆解、关键结果和衡量标准',
      gradient: 'from-[#ECF0F5] via-[#DEE5EE] to-[#CFD8E3]',
      scene: 'article'
    },
    {
      id: 'trip-plan',
      title: '家庭亲子旅行攻略',
      desc: '行程、预算与注意事项',
      prompt: '帮我规划一份家庭亲子旅行攻略，包含行程、预算清单和注意事项',
      gradient: 'from-[#EBF4F0] via-[#DAEBE2] to-[#C7DFD3]',
      scene: 'event'
    }
  ],
  ppt: [
    {
      id: 'llm-benchmark',
      title: '三强争锋：顶尖大模型能力全景测评',
      desc: '多维度模型对比 PPT',
      prompt: '帮我设计一份顶尖大模型能力对比测评 PPT 大纲，包含维度、结论和图表',
      gradient: 'from-[#EDEFF8] via-[#DEE1F2] to-[#CED3EB]',
      scene: 'benchmark'
    },
    {
      id: 'work-report',
      title: '季度工作汇报',
      desc: '数据驱动的总结与计划',
      prompt: '帮我制作一份季度工作汇报 PPT 大纲，突出数据成果、不足和下季度计划',
      gradient: 'from-[#ECF0F5] via-[#DEE5EE] to-[#CFD8E3]',
      scene: 'report'
    },
    {
      id: 'product-pitch',
      title: 'SaaS 产品融资路演',
      desc: '10 分钟路演 Deck',
      prompt: '帮我设计一份 SaaS 产品融资路演 PPT，突出市场痛点、产品价值和商业模式',
      gradient: 'from-[#F5EEE7] via-[#ECDFD0] to-[#E1CCB6]',
      scene: 'pitch'
    },
    {
      id: 'training-deck',
      title: '新员工入职培训课件',
      desc: '体系化知识分享材料',
      prompt: '帮我规划一份新员工入职培训课件大纲，覆盖业务、流程和文化',
      gradient: 'from-[#ECF4EC] via-[#DAE9DA] to-[#C6DDC6]',
      scene: 'training'
    },
    {
      id: 'brand-launch',
      title: '新品发布会宣讲',
      desc: '亮点与故事线并重',
      prompt: '帮我策划一份新品发布会宣讲 PPT，突出产品亮点、用户故事和核心卖点',
      gradient: 'from-[#F0ECF5] via-[#E1D8EE] to-[#D1C4E5]',
      scene: 'pitch'
    },
    {
      id: 'sales-deck',
      title: '大客户销售方案',
      desc: '定制化售前材料',
      prompt: '帮我制作一份大客户定制化销售方案 PPT，强调需求匹配与 ROI',
      gradient: 'from-[#E8F0F4] via-[#D6E3EB] to-[#C2D4E0]',
      scene: 'report'
    },
    {
      id: 'teacher-class',
      title: '教师公开课课件',
      desc: '教学目标 + 互动环节',
      prompt: '帮我设计一份公开课教学课件，包含教学目标、知识要点和互动环节',
      gradient: 'from-[#F4EFE8] via-[#E8DED0] to-[#DCC9B5]',
      scene: 'training'
    },
    {
      id: 'year-summary',
      title: '年度总结与展望',
      desc: '全年回顾 + 明年规划',
      prompt: '帮我制作一份年度总结与展望 PPT 大纲，包含全年复盘和明年规划思路',
      gradient: 'from-[#F0F2F5] via-[#E2E5EA] to-[#D3D7DE]',
      scene: 'benchmark'
    }
  ],
  data: [
    {
      id: 'fund-health',
      title: '基金组合健康诊断',
      desc: '多维指标 + 可视化图表',
      prompt: '帮我分析一组基金组合数据，从收益、风险、分散度等维度做健康诊断',
      gradient: 'from-[#EAF0F6] via-[#D9E2ED] to-[#C6D2E2]',
      scene: 'portfolio'
    },
    {
      id: 'insight',
      title: '销售数据洞察与趋势',
      desc: '归因分析与可视化建议',
      prompt: '我有一组业务销售数据，帮我分析趋势、定位问题并给出可视化建议',
      gradient: 'from-[#F5F0E6] via-[#EDE3CF] to-[#E4D4B6]',
      scene: 'insight'
    },
    {
      id: 'data-report',
      title: 'A/B 实验分析报告',
      desc: '显著性 + 指标拆解',
      prompt: '帮我生成一份 A/B 实验分析报告，包含显著性判断和核心指标拆解',
      gradient: 'from-[#E8F4EF] via-[#D5EBDF] to-[#BEDFCF]',
      scene: 'insight'
    },
    {
      id: 'forecast',
      title: '销量预测建模方案',
      desc: '特征工程 + 评估思路',
      prompt: '帮我设计一个销量预测模型方案，包含特征选择、建模思路和评估指标',
      gradient: 'from-[#F5EAF0] via-[#EBD5E2] to-[#DEBCD0]',
      scene: 'forecast'
    },
    {
      id: 'churn-analysis',
      title: '用户流失分析专题',
      desc: '画像 + 根因 + 策略',
      prompt: '帮我做一份用户流失专题分析，输出流失画像、根因分析和挽留策略',
      gradient: 'from-[#F0ECE8] via-[#E2D9D0] to-[#D3C5B6]',
      scene: 'portfolio'
    },
    {
      id: 'marketing-roi',
      title: '投放渠道 ROI 评估',
      desc: '渠道对比与预算优化',
      prompt: '帮我评估多渠道投放 ROI，给出渠道对比、归因结论和预算优化建议',
      gradient: 'from-[#ECF0EC] via-[#DBE2DA] to-[#C8D2C6]',
      scene: 'forecast'
    },
    {
      id: 'operation-dashboard',
      title: '运营指标看板设计',
      desc: '北极星指标 + 分层指标体系',
      prompt: '帮我设计一套运营指标看板，包含北极星指标、分层指标体系和可视化建议',
      gradient: 'from-[#EEF2F5] via-[#DDE4EA] to-[#CBD4DC]',
      scene: 'insight'
    },
    {
      id: 'survey-report',
      title: '用户调研报告分析',
      desc: '问卷统计 + 洞察结论',
      prompt: '帮我分析一份用户调研问卷数据，产出结构化统计报告和关键洞察',
      gradient: 'from-[#F4EBF0] via-[#E8D5E1] to-[#DAB9CB]',
      scene: 'portfolio'
    }
  ],
  research: [
    {
      id: 'tech-scouting',
      title: 'AI 工程化技术选型调研',
      desc: '方案对比 + 落地建议',
      prompt: '帮我深度调研 AI 工程化技术选型，给出方案对比、优缺点和落地推荐',
      gradient: 'from-[#ECEEF5] via-[#DDDFEE] to-[#CCD0E6]',
      scene: 'tech'
    },
    {
      id: 'market-research',
      title: '智能眼镜行业全景研究',
      desc: '市场 + 竞品 + 趋势',
      prompt: '帮我研究智能眼镜行业全景，包含市场规模、竞品格局和发展趋势',
      gradient: 'from-[#F5EEEB] via-[#ECDED6] to-[#E1C9BE]',
      scene: 'market'
    },
    {
      id: 'academic-survey',
      title: '多模态大模型论文综述',
      desc: '发展脉络 + 代表工作',
      prompt: '帮我整理多模态大模型的论文综述，梳理发展脉络、代表工作和未来方向',
      gradient: 'from-[#ECF5EC] via-[#DAEEDA] to-[#C6E2C6]',
      scene: 'academic'
    },
    {
      id: 'competitive-analysis',
      title: '短视频平台竞品分析',
      desc: '功能对比 + 差异化',
      prompt: '帮我做一份短视频平台竞品分析，从产品、算法、商业化维度对比差异',
      gradient: 'from-[#F0EEEB] via-[#E1DDD5] to-[#D1CBBE]',
      scene: 'market'
    },
    {
      id: 'policy-research',
      title: '生成式 AI 政策合规研究',
      desc: '国内外政策对比',
      prompt: '帮我调研生成式 AI 的国内外监管政策，输出合规要点和应对建议',
      gradient: 'from-[#EAF2F5] via-[#D7E5EB] to-[#C1D4DD]',
      scene: 'tech'
    },
    {
      id: 'user-research',
      title: '职场 AI 工具用户研究',
      desc: '用户画像 + 使用场景',
      prompt: '帮我设计一份职场 AI 工具用户研究方案，给出用户画像、核心场景和研究方法',
      gradient: 'from-[#F5ECEC] via-[#EBD6D6] to-[#DCBABA]',
      scene: 'academic'
    },
    {
      id: 'investment-thesis',
      title: '低空经济赛道投资逻辑',
      desc: '产业链 + 关键变量',
      prompt: '帮我研究低空经济赛道的投资逻辑，梳理产业链、关键变量和标的方向',
      gradient: 'from-[#EFF4EE] via-[#DEE8DC] to-[#CADBC7]',
      scene: 'market'
    },
    {
      id: 'framework-compare',
      title: '前端框架性能对比研究',
      desc: '基准测试 + 场景建议',
      prompt: '帮我做一份主流前端框架性能对比研究，包含基准测试、差异分析和选型建议',
      gradient: 'from-[#EEF0F5] via-[#DDE0EC] to-[#C9CEDE]',
      scene: 'tech'
    }
  ]
}
