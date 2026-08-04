// ============================================================
// 欢迎页数据配置 — 功能标签与模板卡片
// ============================================================
// 本文件为欢迎页的纯数据层，与组件解耦：
//   - WELCOME_FEATURES：功能标签配置
//   - TEMPLATES_BY_FEATURE：各功能标签下的模板列表
// 后续可扩展为远程配置或用户自定义模板。
//
// 背景色设计原则：
//   - 每个模板有独特的渐变色/图案组合，视觉识别度强
//   - 使用 oklch 颜色空间确保明暗主题都美观
//   - 色值与 title 文案语义匹配（求职=稳重蓝绿，活动=活力橙等）
// ============================================================

// ---- 类型定义 ----
export interface WelcomeFeature {
  id: string
  label: string
}

export interface TemplateItem {
  id: string
  title: string
  desc: string
  prompt: string
  /** 缩略图背景渐变（Tailwind bg-gradient-to-r from-x via-y to-z） */
  gradient: string
  /** 预览卡片装饰图案（可选，用文字或CSS模拟） */
  preview?: {
    label: string
    tags: string[]
  }
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

// ---- 各功能标签下的模板列表（含背景渐变和预览图案）----
export const TEMPLATES_BY_FEATURE: Record<string, TemplateItem[]> = {
  doc: [
    {
      id: 'resume',
      title: '求职面试',
      desc: '面试自我介绍与问答准备',
      prompt: '帮我准备一份面试自我介绍，包含个人优势和常见问题回答',
      gradient: 'from-[#C9F0C9] via-[#B8E6B8] to-[#A5D8A5]',
      preview: { label: '简历', tags: ['自我介绍', '优势总结', '问答'] }
    },
    {
      id: 'event',
      title: '活动策划',
      desc: '活动方案与流程规划',
      prompt: '帮我策划一场活动，包含主题、流程、预算和分工',
      gradient: 'from-[#D9E8F5] via-[#C8DCEE] to-[#B5CDE5]',
      preview: { label: '策划', tags: ['流程', '预算', '分工'] }
    },
    {
      id: 'brand',
      title: '品牌方案',
      desc: '品牌定位与传播策略',
      prompt: '帮我制定品牌方案，包含品牌定位、目标人群和传播策略',
      gradient: 'from-[#E5D9F5] via-[#D8C8EE] to-[#CAB5E5]',
      preview: { label: '品牌', tags: ['定位', '人群', '传播'] }
    },
    {
      id: 'article',
      title: '文章撰写',
      desc: '专业文章与内容创作',
      prompt: '帮我撰写一篇专业文章，主题清晰、结构完整',
      gradient: 'from-[#F5D9D9] via-[#EEC8C8] to-[#E5B5B5]',
      preview: { label: '文章', tags: ['大纲', '撰写', '润色'] }
    }
  ],
  ppt: [
    {
      id: 'report',
      title: '工作汇报',
      desc: '季度/年度工作总结',
      prompt: '帮我制作一份工作汇报PPT大纲，包含成果、数据和计划',
      gradient: 'from-[#D9EAF5] via-[#C6DCED] to-[#B1CCE3]',
      preview: { label: '汇报', tags: ['数据', '成果', '计划'] }
    },
    {
      id: 'pitch',
      title: '产品路演',
      desc: '产品介绍与融资路演',
      prompt: '帮我设计一份产品路演PPT，突出核心卖点和市场前景',
      gradient: 'from-[#F5E3D9] via-[#EED2C6] to-[#E5BFB1]',
      preview: { label: '路演', tags: ['卖点', '市场', '融资'] }
    },
    {
      id: 'training',
      title: '培训课件',
      desc: '知识分享与培训材料',
      prompt: '帮我规划一份培训课件大纲，适合团队内部知识分享',
      gradient: 'from-[#E0F5D9] via-[#CFEDC6] to-[#BCE5B1]',
      preview: { label: '培训', tags: ['知识', '案例', '练习'] }
    }
  ],
  data: [
    {
      id: 'insight',
      title: '数据洞察',
      desc: '趋势分析与可视化建议',
      prompt: '我有一组业务数据，帮我分析趋势并给出可视化建议',
      gradient: 'from-[#F5F0D9] via-[#EEE8C6] to-[#E5DDB1]',
      preview: { label: '洞察', tags: ['趋势', '可视化', '建议'] }
    },
    {
      id: 'report-data',
      title: '数据报告',
      desc: '结构化数据分析报告',
      prompt: '帮我生成一份数据分析报告，包含结论和建议',
      gradient: 'from-[#D9F5EC] via-[#C6EEDF] to-[#B1E5D2]',
      preview: { label: '报告', tags: ['数据', '结论', '建议'] }
    },
    {
      id: 'forecast',
      title: '预测建模',
      desc: '数据预测与建模思路',
      prompt: '帮我设计一个数据预测模型，包含特征选择和评估方法',
      gradient: 'from-[#F5D9EA] via-[#EEC6DE] to-[#E5B1D1]',
      preview: { label: '预测', tags: ['特征', '模型', '评估'] }
    }
  ],
  research: [
    {
      id: 'tech',
      title: '技术调研',
      desc: '技术选型与方案对比',
      prompt: '帮我深度调研一个技术方向，给出选型对比和推荐',
      gradient: 'from-[#D9DFF5] via-[#C6CFEE] to-[#B1BDE5]',
      preview: { label: '调研', tags: ['方案', '对比', '推荐'] }
    },
    {
      id: 'market',
      title: '市场研究',
      desc: '行业趋势与竞品分析',
      prompt: '帮我研究一个行业的市场现状，包含竞品和发展趋势',
      gradient: 'from-[#F5E8D9] via-[#EEDAC6] to-[#E5CAB1]',
      preview: { label: '研究', tags: ['行业', '竞品', '趋势'] }
    },
    {
      id: 'academic',
      title: '学术综述',
      desc: '论文综述与文献整理',
      prompt: '帮我整理论文综述，梳理研究现状和关键发现',
      gradient: 'from-[#E5F5D9] via-[#D5EEC6] to-[#C2E5B1]',
      preview: { label: '综述', tags: ['文献', '现状', '发现'] }
    }
  ]
}
