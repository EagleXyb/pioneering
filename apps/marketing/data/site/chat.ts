// ============================================================
// chat · 悬浮智能体演示对话（index.html 逐字移植，静态演示稿）
// 各内容页（非 /agent）共享；/agent 页按原型不显示悬浮入口。
// ============================================================

export interface DemoMessage {
  from: 'bot' | 'me'
  /** 段落（原型中使用 <br> 分行） */
  paras: string[]
  source?: string
}

export const FAB_TITLE = '认知陪练'
export const FAB_SUBTITLE = '基于你的方法论知识库 · 免注册 3 轮'
export const FAB_AVATAR = '知'
export const FAB_PLACEHOLDER = '继续聊，或留下邮箱保存上下文…'
export const FAB_HINT = '已免注册使用 2 / 3 轮 · 留下邮箱可保存你的项目上下文'

export const DEMO_MESSAGES: DemoMessage[] = [
  {
    from: 'bot',
    paras: ['你正在读的这一节，讲的是一个常见的判断陷阱。想拿你手头的真实决定试一遍吗？告诉我大概是什么决定。'],
  },
  { from: 'me', paras: ['我们在考虑要不要砍掉一条产品线，团队吵了两个月。'] },
  {
    from: 'bot',
    paras: [
      '先别急着要答案。我想先问你三件事：',
      '1. 反对砍掉的人，主要依据的是已经投入的成本，还是未来收益？',
      '2. 如果这条线再跑 12 个月，什么证据会让你改变判断？',
      '3. 这个决定最晚什么时候必须定？',
    ],
    source: '依据：沉没成本谬误 · 来自知识库 L1-014',
  },
]
