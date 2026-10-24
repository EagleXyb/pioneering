// P0（FS-2）：Few-shot 种子示例。
//
// 设计原则（对应文档 §11.4.2）：
//   1. 示例表达"难以言说的边界"：格式、判定口径、拒答、工具选择与失败恢复；
//   2. 质量优先于数量：每个任务类型 2–3 条，覆盖正例、反例与边界；
//   3. Agent 场景优先使用轨迹（tool_call / observation / final），而不是单轮问答；
//   4. 种子只作基线，生产环境应由 feedback 高分轨迹持续补充（FS-3）。
//
// 注意：示例文本会进入 system/上下文，禁止放置任何密钥、内网地址或真实个人信息。

import type { FewShotExample } from './few-shot-selector.js'

/** 研究分析类示例。 */
const _research: FewShotExample[] = [
  {
    id: 'seed.research.compare',
    input: '对比 A 方案与 B 方案的优缺点，给出选型建议。',
    output:
      '先用统一维度（成本、复杂度、可维护性、风险）建立对比表，再给出结论。' +
      '事实与推断分开表述；缺少数据时明确标注"未获取"，不替用户补全。' +
      '最后给出"在 X 条件下选 A、在 Y 条件下选 B"的条件化建议。',
    domain: 'research',
    complexity: 'tier_2',
    pattern: 'react',
    quality_score: 0.95,
    source: 'manual',
  },
  {
    id: 'seed.research.realtime',
    input: '总结今天 AI 领域的热点新闻。',
    output:
      '轨迹：先调用 datetime 获取当天日期；再调用一次 web_search（宽泛查询，取 5–8 条）；' +
      '不再重复搜索同一主题；最后按"日期 + 3–5 条要点 + 来源"输出。' +
      '若搜索失败，说明"当前无法获取实时新闻"，不编造标题。',
    domain: 'research',
    complexity: 'tier_1',
    pattern: 'react',
    quality_score: 0.95,
    source: 'manual',
    trajectory: [
      { role: 'assistant', content: '先确认今天的日期。', tool_calls: [{ name: 'datetime', arguments: {} }] },
      { role: 'tool', content: '{"date":"2026-10-24"}' },
      {
        role: 'assistant',
        content: '再检索一次热点新闻。',
        tool_calls: [{ name: 'web_search', arguments: { query: '今日 AI 热点新闻' } }],
      },
      { role: 'tool', content: '{"results":["..."]}' },
      {
        role: 'assistant',
        content: '## 2026-10-24 AI 热点\n- 要点一（来源：…）\n- 要点二（来源：…）',
      },
    ],
  },
]

/** 文档生成类示例。 */
const _document: FewShotExample[] = [
  {
    id: 'seed.doc.daily',
    input: '把上面的内容整理成一份中文日报文档。',
    output:
      '先确认信息是否足够；足够则调用 doc_writer（auto_name=true，标题具体），' +
      '成功后按固定交付格式输出：一句确认语 + "文档位置：📄 文件名" + ' +
      '"## 核心内容速览" 下 3–5 条要点。不要把全文再粘一遍，也不要粘贴工具 JSON。',
    domain: 'document_generation',
    complexity: 'tier_1',
    pattern: 'react',
    quality_score: 0.92,
    source: 'manual',
  },
]

/** 编码类示例。 */
const _coding: FewShotExample[] = [
  {
    id: 'seed.coding.fix',
    input: '这个 TypeScript 文件报类型错误，帮我修一下。',
    output:
      '先读相关文件与调用方，确认错误来自类型声明还是运行时数据；做最小修改；' +
      '说明改动点与影响范围；能运行类型检查就运行并贴出结果，不能运行则明确写"未验证"及原因。' +
      '不擅自重写无关代码，不虚构不存在的 API。',
    domain: 'coding',
    complexity: 'tier_2',
    pattern: 'react',
    quality_score: 0.93,
    source: 'manual',
  },
  {
    id: 'seed.coding.review',
    input: '评审这段代码有没有问题。',
    output:
      '按"正确性 → 边界条件 → 错误处理 → 可维护性 → 安全"顺序检查；' +
      '每条问题给出位置、原因与修复建议；最后给结论（通过 / 需修改 / 拒绝）。' +
      '没有发现问题时也要说明检查过哪些维度，而不是只回"没问题"。',
    domain: 'coding',
    complexity: 'tier_2',
    pattern: 'react',
    quality_score: 0.9,
    source: 'manual',
  },
]

/** 任务规划类示例。 */
const _planning: FewShotExample[] = [
  {
    id: 'seed.plan.steps',
    input: '帮我调研三个竞品并输出对比报告。',
    output:
      '计划 4 步：界定对比维度 → 逐个检索竞品资料（requires_tool=true）→ ' +
      '交叉验证并整理对比表 → 生成文档。每步写清 expected_output 与 verification_hint；' +
      '依赖关系用 depends_on 表达；不把计划 JSON 当作最终交付。',
    domain: 'planning',
    complexity: 'tier_3',
    pattern: 'plan_execute',
    quality_score: 0.94,
    source: 'manual',
  },
  {
    id: 'seed.plan.replan',
    input: '第二步检索失败了，继续完成任务。',
    output:
      '读取失败原因：若是查询过窄，改写关键词后重试一次；若是权限或服务不可用，' +
      '改用其他数据源或缩小结论范围；重规划时只重写失败步骤及其后续，复用已完成步骤，' +
      '不重复生成全量计划。',
    domain: 'planning',
    complexity: 'tier_3',
    pattern: 'plan_execute',
    quality_score: 0.93,
    source: 'manual',
  },
]

/** 通用 / 拒答边界示例。 */
const _default: FewShotExample[] = [
  {
    id: 'seed.default.clarify',
    input: '帮我搞一下那个东西。',
    output:
      '不猜测具体对象。先用一句话说明缺口（目标、范围、交付形式），' +
      '给出 2–3 个可选项让用户确认；用户仍不明确时，按最保守的假设继续并标注假设。',
    domain: 'default',
    complexity: 'tier_1',
    pattern: 'direct',
    quality_score: 0.9,
    source: 'manual',
  },
  {
    id: 'seed.default.no_tool',
    input: '现在这支股票的实时价格是多少？',
    output:
      '若没有行情工具：明确说明"当前没有可用的实时行情数据"，' +
      '不根据记忆给出价格或日期；可提供获取渠道或让用户提供截图/数据。' +
      '若有行情工具：调用一次并标注时间戳与来源。',
    domain: 'default',
    complexity: 'tier_1',
    pattern: 'direct',
    quality_score: 0.92,
    source: 'manual',
  },
]

/** 全部种子示例（按 domain 分组，顺序稳定便于测试）。 */
export const FEW_SHOT_SEEDS: FewShotExample[] = [
  ..._research,
  ..._document,
  ..._coding,
  ..._planning,
  ..._default,
]

/** 按 domain 过滤种子（供测试与按任务类型注入使用）。 */
export function getFewShotSeeds(domain?: string | null): FewShotExample[] {
  if (!domain) return [...FEW_SHOT_SEEDS]
  return FEW_SHOT_SEEDS.filter((e) => e.domain === domain)
}
