// ============================================================
// cognition · 认知理念页文案（docs/site/cognition.html 逐字移植）
// ============================================================

export const COG_HEADER = {
  eyebrow: 'CORE BELIEF',
  title: '认知模型',
  lead: '我们不解释世界，我们解释你是怎么解释世界的。\n改变这一层，判断和创新才会真的改变。',
  pdfCta: '下载框架图 PDF',
}

export const COG_MODEL = {
  title: '三层结构',
  layers: [
    {
      badge: '01',
      title: '看见 SEE',
      desc: '觉察自己正在用什么框架看问题，识别隐含假设与偏误。对应工具：偏误清单、假设追问。',
      on: false,
    },
    {
      badge: '02',
      title: '理解 UNDERSTAND',
      desc: '把模糊问题拆成可验证的假设与可执行动作。对应工具：结构拆解、约束识别。',
      on: true,
    },
    {
      badge: '03',
      title: '重构 REFRAME',
      desc: '改变问题的提法，让原本对立的条件重新组合。对应工具：约束重构、类比迁移。',
      on: false,
    },
  ],
  usageTitle: '这套模型怎么用',
  usage: [
    '遇到卡住的问题时，先停在第一层问自己「我是怎么看这件事的」，再进第二层拆结构，最后才允许自己想解法。',
    '多数人跳过前两层直接找答案，所以答案总在原地打转。',
  ],
}

export const COG_PILLARS = {
  title: '三大支柱',
  lead: '每一层对应一种可训练的能力，也对应智能体的一项能力。',
  items: [
    {
      tag: '认知升维',
      desc: '从单一视角切换到多层视角，看见系统而非事件。',
      question: '常见问题：“还能从哪几个角度看这件事？”',
    },
    {
      tag: '结构拆解',
      desc: '把模糊问题拆成可验证的假设与可执行的动作。',
      question: '常见问题：“这件事真正的约束是什么？”',
    },
    {
      tag: '创新实践',
      desc: '在真实约束下完成重构，并把过程沉淀为可复用路径。',
      question: '常见问题：“哪个限制其实是我自己加的？”',
    },
  ],
}

export const COG_CONCEPTS = {
  title: '概念卡片库',
  lead: '每个概念配一个自测问题，可以直接拿去问智能体。',
  items: [
    { title: '认知偏误', desc: '系统性偏离理性的思维模式', question: '这个判断里，最可能起作用的是哪个偏误？' },
    { title: '沉没成本', desc: '因已投入而继续，忽略未来收益', question: '如果没投入过，我还会做这个决定吗？' },
    { title: '第一性原理', desc: '回到不可再拆的基本事实重新推导', question: '这件事有哪些部分是「本来如此」的？' },
    { title: '约束重构', desc: '改变限制条件的提法以打开解法空间', question: '哪个限制其实是我自己加的？' },
    { title: '系统思考', desc: '看见反馈回路而非线性因果', question: '这个结果会不会反过来加强原因？' },
    { title: '类比迁移', desc: '把陌生问题映射到已解结构', question: '这个像我解决过的哪件事？' },
  ],
}

export const COG_SOURCES = {
  eyebrow: 'TRACEABILITY',
  title: '方法与来源',
  body: '认知类品牌的可信度不来自立场，来自可追溯。我们公开方法论所依据的研究与著作，智能体的每个关键论断也会标注到具体条目。',
  items: [
    { author: 'Daniel Kahneman', work: 'Thinking, Fast and Slow', note: '系统一与系统二、可得性偏误' },
    { author: 'Charlie Munger', work: "Poor Charlie's Almanack", note: '多元思维模型、误判心理学' },
    { author: 'Donella Meadows', work: 'Thinking in Systems', note: '反馈回路、杠杆点' },
    { author: 'Peter Senge', work: 'The Fifth Discipline', note: '心智模式、团队学习' },
  ],
}

export const COG_FAQ = {
  title: '常见质疑与回应',
  items: [
    {
      q: '这和市面上的思维课有什么不同？',
      a: '我们不讲概念，讲你自己的问题。每个方法都必须落到你手头那件具体的事上，否则不算学会。',
    },
    {
      q: '多久能见效？',
      a: '第一次对话就能拿到一个具体洞察。但要形成稳定的思维习惯，通常需要 6-8 周的持续练习。',
    },
    {
      q: 'AI 给的建议，凭什么可信？',
      a: '每个关键论断都可以点开看依据，出处标注到具体文献与知识库条目。不能溯源的，我们不输出。',
    },
    {
      q: '用了它，我会不会就不思考了？',
      a: '我们的设计原则是「先问后答」——它先追问你的假设，最后还会把一个反思问题还给你。目标是让你更会思考，不是替你思考。',
    },
  ],
}

export const COG_CTA = {
  title: '读懂了，就该练一遍',
  body: '用你手头真实的问题，和智能体走一轮。',
}
