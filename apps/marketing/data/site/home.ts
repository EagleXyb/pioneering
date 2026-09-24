// ============================================================
// home · 首页全部文案（docs/site/index.html 逐字移植）
// 占位性质：数字与证言沿用原型稿，上线前需替换为真实内容。
// ============================================================

export const HERO = {
  eyebrow: 'COGNITION × INNOVATION',
  titleLines: ['看见认知的边界，', '才有创新的起点。'],
  sub: '我们研究人如何看见、判断与重构问题，并把这套能力做成可训练的方法——\n以及一个陪你练的智能体。',
  keywords: ['认知偏误', '系统思考', '第一性原理', '约束重构', '组合创新'],
  stats: [
    { num: '12,800', label: '累计读者' },
    { num: '340', label: '服务学员' },
    { num: '27', label: '合作机构' },
    { num: '92%', label: '完课率' },
  ],
}

export const BRAND_INTRO = {
  eyebrow: 'BRAND',
  titleLines: ['一个以认知科学为底座、', '以创新实践为出口的', '思想型品牌'],
  lead: '当信息不再稀缺，判断力才是稀缺品；当创新不能靠灵感，方法就必须可复制。',
  body: '我们不生产新概念。我们做的是把认知科学中被验证的原理，翻译成能用在明天的工作语言——先让你看懂自己是怎么思考的，再给你一套可复用的框架，最后用一个智能体陪你在真实问题上练。',
}

export const PAIN_POINTS = {
  eyebrow: 'THE GAP',
  title: '四种卡住的时刻',
  lead: '每一种，都不缺努力，缺的是对思考本身的看见。',
  cards: [
    { title: '信息很多，却判断不了', desc: '问题不在信息量，在你用什么结构接住它。', tag: '结构拆解' },
    { title: '学过方法，却用不上', desc: '方法要变成肌肉记忆，得在真实问题上练过。', tag: '认知训练' },
    { title: '团队有想法，落不了地', desc: '缺的不是创意，是把创意拆成动作的路径。', tag: '创新实践' },
    { title: '创新靠灵感，不可复制', desc: '可复制的创新，来自可复述的约束重构。', tag: '约束重构' },
  ],
}

export const CORE_METHOD = {
  eyebrow: 'CORE METHOD',
  title: '认知模型：看见 → 理解 → 重构',
  body: '整套方法论只有三层。它不解释世界，它解释你是怎么解释世界的——改变这一层，后面的判断和创新才会真的变。',
  layers: [
    {
      badge: '01',
      title: '看见 SEE',
      desc: '觉察自己正在用什么框架看问题，识别隐含假设与偏误。',
      on: false,
    },
    {
      badge: '02',
      title: '理解 UNDERSTAND',
      desc: '把问题拆成可操作的结构，找到真正的约束条件。',
      on: true,
    },
    {
      badge: '03',
      title: '重构 REFRAME',
      desc: '改变问题的提法，让原本对立的条件重新组合。',
      on: false,
    },
  ],
  pillars: [
    { title: '认知升维', desc: '从单一视角切换到多层视角，看见系统而非事件。' },
    { title: '结构拆解', desc: '把模糊问题拆成可验证的假设与可执行的动作。' },
    { title: '创新实践', desc: '在真实约束下完成重构，并把过程沉淀为可复用路径。' },
  ],
}

export const AGENT_STRIP = {
  eyebrow: 'THE AGENT',
  title: '读到哪，就能练到哪',
  lead: '方法论不该只被阅读。它应该在你遇到真实问题的那一刻，接住你。',
  cards: [
    {
      tag: '决策检查',
      desc: '把你的决定放进偏误清单里过一遍，指出你漏掉的假设。',
      cta: '试试：“帮我检查这个决定” →',
    },
    {
      tag: '约束重构',
      desc: '项目卡住时，重新定义限制条件，打开新的解法空间。',
      cta: '试试：“我的项目卡住了” →',
    },
    {
      tag: '复盘引导',
      desc: '带你对失败做一次不甩锅、能复用的复盘。',
      cta: '试试：“复盘这次失败” →',
    },
  ],
}

export const FEATURED_INSIGHTS = {
  eyebrow: 'INSIGHTS',
  title: '精选专栏',
  cards: [
    {
      tag: '认知科学',
      title: '为什么经验越丰富，越容易判断失误',
      desc: '经验会压缩你的搜索空间，也会压缩你的怀疑空间。',
      minutes: '8 分钟 阅读',
    },
    {
      tag: '思维方法',
      title: '用约束重构法拆一个停滞的项目',
      desc: '换个提法，原本对立的条件就能重新组合。',
      minutes: '12 分钟 阅读',
    },
    {
      tag: '创新实践',
      title: '一家制造企业的创新工作坊全过程复盘',
      desc: '最难的不是想出点子，是让点子落地。',
      minutes: '15 分钟 阅读',
    },
  ],
}

export const CASE_PROOF = {
  eyebrow: 'CASES',
  title: '方法与结果，都可核验',
  stats: [
    { num: '27', label: '服务企业' },
    { num: '340', label: '累计学员' },
    { num: '92%', label: '完课率' },
  ],
  cards: [
    { tag: '创新工作坊', title: '某新能源头部企业', desc: '12 周内产出 4 个进入验证阶段的产品方案' },
    { tag: '认知训练营', title: '某互联网公司组织发展部', desc: '参训团队决策返工率下降 34%' },
    { tag: '决策陪练', title: '某消费品牌战略部', desc: '重大项目评审周期从 6 周压缩到 2 周' },
  ],
}

export const TESTIMONIALS = {
  eyebrow: 'TESTIMONIALS',
  title: '听听他们怎么说',
  sub: 'Hear it from our customers.',
  main: {
    quote: '“它不直接给答案，但每次都能指出我漏掉的那个假设。”',
    initial: '陈',
    name: '陈曦',
    role: '产品负责人 · 某互联网公司',
  },
  small: [
    {
      quote: '“读完就能拿自己的项目练一遍，这才是真学会。”',
      initial: '王',
      name: '王磊',
      role: '创新业务负责人',
    },
    {
      quote: '“把卡了半年的项目拆清楚了。”',
      initial: '林',
      name: '林小雨',
      role: '组织发展总监',
    },
    {
      quote: '“每个结论都能点开看依据，我们才敢用在正式决策里。”',
      initial: '周',
      name: '周航',
      role: '战略投资经理',
    },
  ],
}

export const NEWSLETTER = {
  eyebrow: 'NEWSLETTER',
  title: '每月两封，只写能用的东西',
  body: '订阅即送《认知偏误速查手册》——18 个高频偏误，每个配一个自查问题。',
  placeholder: '你的邮箱',
  note: '随时可退订 · 不做转发',
}
