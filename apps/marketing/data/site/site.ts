// ============================================================
// site · 认知×创新 品牌站全局常量（对应 docs/site 原型 V1.0）
//
// 注意：url 暂用 IA 文档的 example.com 占位，上线前替换为正式域名。
// ============================================================

export const BRAND_SITE = {
  name: '知境 COGNILAB',
  tagline: '不替你下判断，让你看清自己是怎么下判断的。',
  /** TODO 上线前替换为正式域名（IA 定稿沿用单域名） */
  url: 'https://example.com',
  locale: 'zh_CN',
} as const

/** 顶部主导航：6 项（含首页） */
export const BRAND_NAV = [
  { href: '/', label: '首页' },
  { href: '/cognition', label: '认知理念' },
  { href: '/insights', label: '知识专栏' },
  { href: '/agent', label: '智能体' },
  { href: '/cases', label: '案例' },
  { href: '/about', label: '关于我们' },
] as const

/** 页脚 5 列链接组 */
export const BRAND_FOOTER: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: '认知',
    links: [
      { label: '认知模型', href: '/cognition#model' },
      { label: '三大支柱', href: '/cognition#pillars' },
      { label: '概念卡片库', href: '/cognition#concepts' },
      { label: '方法与来源', href: '/cognition#sources' },
    ],
  },
  {
    title: '内容',
    links: [
      { label: '认知科学', href: '/insights' },
      { label: '思维方法', href: '/insights' },
      { label: '创新实践', href: '/insights' },
      { label: '专题合集', href: '/insights#topics' },
    ],
  },
  {
    title: '产品',
    links: [
      { label: '免费体验', href: '/agent#try' },
      { label: '能力总览', href: '/agent#capabilities' },
      { label: '对话样例', href: '/agent#samples' },
      { label: '学习资料', href: '/agent#learn' },
      { label: '定价', href: '/agent#pricing' },
    ],
  },
  {
    title: '关于',
    links: [
      { label: '品牌故事', href: '/about' },
      { label: '团队', href: '/about#team' },
      { label: '合作与背书', href: '/about#partners' },
      { label: '联系我们', href: '/about#contact' },
    ],
  },
]

export const FOOTER_BOTTOM = [
  { label: '隐私政策', href: '#' },
  { label: '用户协议', href: '#' },
  { label: '站点地图', href: '#' },
] as const
