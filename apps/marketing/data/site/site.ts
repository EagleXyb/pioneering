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

// ---------- 顶部主导航：mega dropdown 结构 ----------
// 映射参考图（Vault 式）：3 个下拉菜单（产品/认知理念/知识专栏）
// + 1 个普通链接（案例）；首页 = Logo；「关于我们」位于右侧文字位。

/** 子项图标 key，具体 lucide 图标在 SiteNav / MobileMenu 内映射 */
export type NavIconKey =
  | 'grid'
  | 'chat'
  | 'sparkles'
  | 'model'
  | 'pillar'
  | 'cards'
  | 'science'
  | 'method'
  | 'topics'

export interface BrandNavChild {
  icon: NavIconKey
  title: string
  desc: string
  href: string
}

/** 面板右侧推广卡（对应参考图 NEW 卡片） */
export interface BrandNavPromo {
  badge: string
  title: string
  desc: string
  cta: string
  href: string
}

export type BrandNavItem =
  | { kind: 'link'; href: string; label: string }
  | {
      kind: 'menu'
      href: string
      label: string
      children: readonly BrandNavChild[]
      promo?: BrandNavPromo
    }

export const BRAND_NAV: readonly BrandNavItem[] = [
  {
    kind: 'menu',
    href: '/agent',
    label: '产品',
    children: [
      { icon: 'grid', title: '能力总览', desc: '一文看清智能体能做什么、边界在哪里。', href: '/agent#capabilities' },
      { icon: 'chat', title: '对话样例', desc: '真实提问与回应，看见思考被照见的过程。', href: '/agent#samples' },
      { icon: 'sparkles', title: '免费体验', desc: '零门槛，开始一次关于你自己的对话。', href: '/agent#try' },
    ],
    promo: {
      badge: 'NEW',
      title: '知境智能体正式上线',
      desc: '从一次提问开始，看清自己的判断是如何形成的。',
      cta: '立即体验',
      href: '/agent#try',
    },
  },
  {
    kind: 'menu',
    href: '/cognition',
    label: '认知理念',
    children: [
      { icon: 'model', title: '认知模型', desc: '一张图理解判断如何在心智中生成。', href: '/cognition#model' },
      { icon: 'pillar', title: '三大支柱', desc: '框架、偏误与反思，构成认知的三个支点。', href: '/cognition#pillars' },
      { icon: 'cards', title: '概念卡片库', desc: '把抽象概念变成可翻阅的卡片。', href: '/cognition#concepts' },
    ],
  },
  {
    kind: 'menu',
    href: '/insights',
    label: '知识专栏',
    children: [
      { icon: 'science', title: '认知科学', desc: '来自实验室的反直觉发现。', href: '/insights' },
      { icon: 'method', title: '思维方法', desc: '可直接上手的思考工具与练习。', href: '/insights' },
      { icon: 'topics', title: '专题合集', desc: '按主题深耕的系列文章。', href: '/insights#topics' },
    ],
  },
  { kind: 'link', href: '/cases', label: '案例' },
]

/** 右侧文字位入口（对应参考图 Log in 的位置） */
export const BRAND_NAV_ABOUT = { href: '/about', label: '关于我们' } as const

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
