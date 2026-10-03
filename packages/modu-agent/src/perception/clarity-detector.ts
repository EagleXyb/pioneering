// ============================================================
// 需求明确度检测器（阶段3：规则预筛 + LLM 复判 + 高影响门控）
//
// 分层设计（对应方案 §3.1 的 clarity-detector，落地为确定性优先的两级判定）：
//   1. 规则信号（同步、零成本）：开关 / 轮次 / 短输入 / 模糊短语
//      —— 即原 assessClarificationNeed，行为逐条保持
//   2. LLM 复判（异步、可选、默认关闭）：clarity_score + missing_slots
//      —— 覆盖规则管不到的「语义歧义」（如"帮我优化一下那个方案"）
//   3. 高影响门控（可选、默认关闭）：high_impact_only=true 时，
//      仅对命中 high_impact_keywords 的请求澄清（防打扰策略）
//
// 路由/节点一致性（关键）：
//   - graph 路由是同步的，只能做粗筛 assessClarificationCoarse：
//     规则命中 → 直接进 clarify 节点；LLM 复判启用且输入在候选区间 → 也进节点精判；
//   - clarify 节点是异步的，做精判 detectClarification：
//     规则命中时不调用 LLM（零成本）；规则未命中且启用 llm_judge 才调用。
//
// 零回归：llm_judge.enabled=false 且 high_impact_only=false（默认）时，
// 粗筛 === 规则判定，节点 === 原行为。
//
// 与 nodes.ts 的依赖方向：本模块不 import graph/*（判定所需状态用结构子集），
// 由 nodes.ts 单向依赖本模块，避免循环依赖。
// ============================================================

import { HumanMessage } from '@langchain/core/messages'
import { getConfig } from '../config/runtime-config.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[clarity] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[clarity] ${msg}`, ...args),
}

/** 判定所需的最小状态视图（ModuAgentState 的结构子集，避免 perception → graph 反向依赖） */
export interface ClarifyStateView {
  cleaned_text?: string | null
  input_data?: Record<string, any> | null
  clarification_round?: number | null
}

/** 澄清判定结果（确定性信号，无副作用、可单测） */
export interface ClarifyDecision {
  /** 是否需要向用户澄清 */
  needed: boolean
  /** 判定原因（日志与可观测用） */
  reason: string
  /** 澄清问题文本 */
  question: string
  /** 候选选项（空数组表示纯自由文本回答；description 为选项的补充说明） */
  options: Array<{ id: string; label: string; description?: string }>
}

/** 增强判定结果（规则 + LLM 复判的统一出口） */
export interface ClarityDetectionResult extends ClarifyDecision {
  /** 明确度评分（0-1；规则路径为 null——规则是布尔判定，不给分） */
  clarity_score: number | null
  /** LLM 复判输出的缺失信息槽位（规则路径为空数组） */
  missing_slots: Array<{ slot: string; question: string }>
  /** 判定来源 */
  source: 'rule' | 'llm' | 'none'
}

/** 默认高影响关键词（写操作/外发/生产环境类，命中才允许澄清打扰） */
export const DEFAULT_HIGH_IMPACT_KEYWORDS: readonly string[] = [
  '删除',
  '发布',
  '部署',
  '上线',
  '生产',
  '批量',
  '支付',
  '转账',
  '覆盖',
  '清空',
  'delete',
  'drop',
  'deploy',
  'publish',
  'rollback',
]

/** 从 state 提取用户本轮输入文本（感知层清洗结果优先） */
export function extractUserInputText(state: ClarifyStateView): string {
  const cleaned = (state.cleaned_text ?? '').trim()
  if (cleaned) return cleaned
  const prompt = String((state.input_data ?? {})['prompt'] ?? '').trim()
  return prompt
}

/** 高影响输入判定：命中配置关键词（大小写不敏感） */
export function isHighImpactInput(
  input: string,
  cfg?: Record<string, any> | null,
): boolean {
  const conf = cfg ?? {}
  const kws = Array.isArray(conf['high_impact_keywords'])
    ? (conf['high_impact_keywords'] as string[])
    : (DEFAULT_HIGH_IMPACT_KEYWORDS as unknown as string[])
  const lowered = input.toLowerCase()
  return kws.some((k) => !!k && lowered.includes(String(k).toLowerCase()))
}

/**
 * 需求明确度检测（确定性信号）。
 *
 * 检测顺序（任一命中即需要澄清）：
 *   1. 开关关闭 → 不澄清（保证 enabled=false 时行为与现状完全一致）
 *   2. 已达 max_clarify_rounds → 不再追问（防无限追问死循环）
 *   3. 输入过短（< min_input_chars）→ 表达不充分的强信号
 *   4. 命中 insufficient_patterns（"帮我弄一下"等语义模糊短语）
 *
 * @param state 图状态（结构子集）
 * @param cfg perception.clarification 配置块（缺省时读取全局配置）
 */
export function assessClarificationNeed(
  state: ClarifyStateView,
  cfg?: Record<string, any> | null,
): ClarifyDecision {
  const conf = cfg ?? ((getConfig().get('perception.clarification', {}) ?? {}) as Record<string, any>)
  const question = String(conf['question_template'] ?? '你的需求还不太明确，方便补充一下具体想做什么吗？')
  const options = Array.isArray(conf['default_options'])
    ? (conf['default_options'] as Array<{ id: string; label: string; description?: string }>)
    : []

  if (!conf['enabled']) {
    return { needed: false, reason: 'disabled', question, options: [] }
  }

  const round = Number(state.clarification_round ?? 0)
  const maxRounds = Number(conf['max_clarify_rounds'] ?? 2)
  if (round >= maxRounds) {
    return { needed: false, reason: 'round_limit_reached', question, options: [] }
  }

  const input = extractUserInputText(state)
  if (!input) {
    return { needed: false, reason: 'empty_input', question, options: [] }
  }

  const minChars = Number(conf['min_input_chars'] ?? 10)
  if (input.length < minChars) {
    return { needed: true, reason: 'input_too_short', question, options }
  }

  const patterns = Array.isArray(conf['insufficient_patterns'])
    ? (conf['insufficient_patterns'] as string[])
    : []
  const lowered = input.toLowerCase()
  const hit = patterns.find((p) => p && lowered.includes(String(p).toLowerCase()))
  if (hit) {
    return { needed: true, reason: `insufficient_pattern:${hit}`, question, options }
  }

  return { needed: false, reason: 'sufficient', question, options: [] }
}

/**
 * 同步粗筛（graph 路由用；不能 await）。
 *
 * - 规则命中 → 进 clarify 节点（节点内可能再叠加高影响门控/润色）；
 * - 规则未命中但 llm_judge 启用且输入在候选区间 → 也进节点做精判
 *   （候选判定必须与 detectClarification 的条件保持一致，否则路由不进节点、复判永远不执行）。
 */
export function assessClarificationCoarse(
  state: ClarifyStateView,
  cfg?: Record<string, any> | null,
): { needed: boolean; reason: string } {
  const conf = cfg ?? ((getConfig().get('perception.clarification', {}) ?? {}) as Record<string, any>)
  const rule = assessClarificationNeed(state, conf)

  if (rule.needed) {
    if (conf['high_impact_only'] === true && !isHighImpactInput(extractUserInputText(state), conf)) {
      return { needed: false, reason: 'low_impact' }
    }
    return { needed: true, reason: rule.reason }
  }

  const judgeCfg = (conf['llm_judge'] ?? {}) as Record<string, any>
  if (rule.reason === 'sufficient' && judgeCfg['enabled'] === true) {
    const input = extractUserInputText(state)
    const maxChars = Number(judgeCfg['max_input_chars'] ?? 60)
    if (input.length > 0 && input.length <= maxChars) {
      if (conf['high_impact_only'] === true && !isHighImpactInput(input, conf)) {
        return { needed: false, reason: 'low_impact' }
      }
      return { needed: true, reason: 'llm_judge_candidate' }
    }
  }
  return { needed: false, reason: rule.reason }
}

// ============================================================
// LLM 复判（阶段3）
// ============================================================

const CLARITY_JUDGE_PROMPT =
  '你是需求分析助手。请评估用户请求的信息完整度，只输出 JSON，不要输出其它解释：\n' +
  '{"clarity_score": <0 到 1 的小数>, "missing_slots": [{"slot": "<缺失信息名>", "question": "<针对该缺失的一句话追问>"}], "question": "<信息不足时用一句中文（15-40字）给出的澄清问题>", "options": [{"id": "<英文短标识>", "label": "<不超过10字的选项标题>", "description": "<20字以内的选项补充说明>"}]}\n\n' +
  '评分标准：\n' +
  '- 1.0：目标、范围、产出物明确，可直接执行\n' +
  '- 0.5：主要意图可推断，细节缺失但不影响开始\n' +
  '- 0.0：目标模糊，无法确定要做什么\n\n' +
  'options 填写规则：仅当用户的目标产出物存在明显分叉（如网页/文档/数据分析/Agent 等不同方向）时给出 2-4 个候选方向，' +
  '选项必须结合用户请求的具体语境（可引用用户提到的项目/背景），没有明显分叉时输出空数组 []。\n\n' +
  '用户请求：'

interface LlmJudgeOutput {
  clarity_score: number
  missing_slots: Array<{ slot: string; question: string }>
  question: string
  /** 模型结合用户语境生成的候选方向（无明显分叉时为空数组） */
  options: Array<{ id: string; label: string; description?: string }>
}

/** 从模型输出中提取首个平衡的 JSON 对象（容忍 ```json 围栏与前后解释文本） */
function extractJsonBlock(text: string): string | null {
  const idx = text.indexOf('{')
  if (idx < 0) return null
  let depth = 0
  for (let i = idx; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(idx, i + 1)
    }
  }
  return null
}

/** LLM 复判：返回 null 表示判定失败（调用方保守处理：不打扰） */
async function llmJudgeClarity(
  input: string,
  llm: any,
): Promise<LlmJudgeOutput | null> {
  try {
    const res = await llm.invoke([new HumanMessage(CLARITY_JUDGE_PROMPT + input)])
    const text = String((res as any)?.content ?? '').trim()
    const jsonStr = extractJsonBlock(text)
    if (!jsonStr) return null
    const parsed = JSON.parse(jsonStr) as Record<string, any>
    const scoreRaw = Number(parsed['clarity_score'])
    if (!Number.isFinite(scoreRaw)) return null
    const missing = Array.isArray(parsed['missing_slots'])
      ? (parsed['missing_slots'] as any[])
          .filter((s) => s && typeof s['slot'] === 'string')
          .map((s) => ({ slot: String(s['slot']), question: String(s['question'] ?? '') }))
      : []
    const options = Array.isArray(parsed['options'])
      ? (parsed['options'] as any[])
          .filter((o) => o && typeof o['id'] === 'string' && typeof o['label'] === 'string')
          .map((o) => ({
            id: String(o['id']),
            label: String(o['label']),
            ...(typeof o['description'] === 'string' && o['description'].trim()
              ? { description: String(o['description']) }
              : {}),
          }))
      : []
    return {
      clarity_score: Math.max(0, Math.min(1, scoreRaw)),
      missing_slots: missing,
      question: typeof parsed['question'] === 'string' ? parsed['question'] : '',
      options,
    }
  } catch (e: any) {
    logger.warning('llm_judge_failed: %s', String(e?.message ?? e))
    return null
  }
}

/** LLM 润色澄清问题（use_llm，失败回退模板） */
async function llmPolishQuestion(input: string, llm: any): Promise<string | null> {
  try {
    const res = await llm.invoke([
      new HumanMessage(
        '用户请求可能不够明确。请用一句中文向用户提出澄清问题（15-40 字），' +
          '只输出问题本身，不要输出其它内容。\n\n用户请求：' +
          input,
      ),
    ])
    const text = String((res as any)?.content ?? '').trim()
    return text || null
  } catch (e: any) {
    logger.warning('llm_polish_failed: %s', String(e?.message ?? e))
    return null
  }
}

// ============================================================
// 异步精判（clarify 节点用）
// ============================================================

function notNeeded(reason: string, rule: ClarifyDecision): ClarityDetectionResult {
  return {
    needed: false,
    reason,
    question: rule.question,
    options: [],
    clarity_score: null,
    missing_slots: [],
    source: 'none',
  }
}

/**
 * 需求明确度精判（clarify 节点入口）。
 *
 * 判定顺序：
 *   1. 规则命中 → 直接澄清（可选 LLM 润色）；高影响门控开启时非高影响请求放行
 *   2. 规则未命中（sufficient）+ llm_judge 启用 + 输入在候选区间 → LLM 复判：
 *      clarity_score < clarity_threshold → 澄清（问题 = LLM 问题 + 最多 2 条槽位追问）
 *   3. 复判失败/超区间 → 保守放行（宁漏勿扰）
 */
export async function detectClarification(
  state: ClarifyStateView,
  cfg?: Record<string, any> | null,
  llm?: any | null,
): Promise<ClarityDetectionResult> {
  const conf = cfg ?? ((getConfig().get('perception.clarification', {}) ?? {}) as Record<string, any>)
  const rule = assessClarificationNeed(state, conf)
  const input = extractUserInputText(state)

  // ---- 1. 规则命中 ----
  if (rule.needed) {
    if (conf['high_impact_only'] === true && !isHighImpactInput(input, conf)) {
      return notNeeded('low_impact', rule)
    }
    let question = rule.question
    if (conf['use_llm'] === true && llm && typeof llm.invoke === 'function') {
      const polished = await llmPolishQuestion(input, llm)
      if (polished) question = polished
    }
    return {
      needed: true,
      reason: rule.reason,
      question,
      options: rule.options,
      clarity_score: null,
      missing_slots: [],
      source: 'rule',
    }
  }

  // ---- 2. LLM 复判 ----
  const judgeCfg = (conf['llm_judge'] ?? {}) as Record<string, any>
  if (
    rule.reason !== 'sufficient' ||
    judgeCfg['enabled'] !== true ||
    !llm ||
    typeof llm.invoke !== 'function'
  ) {
    return notNeeded(rule.reason, rule)
  }
  if (conf['high_impact_only'] === true && !isHighImpactInput(input, conf)) {
    return notNeeded('low_impact', rule)
  }
  const maxChars = Number(judgeCfg['max_input_chars'] ?? 60)
  if (!input || input.length > maxChars) {
    return notNeeded('llm_skip_input_range', rule)
  }

  const judged = await llmJudgeClarity(input, llm)
  if (judged === null) {
    // 复判失败：保守放行（不因判定异常打扰用户）
    return notNeeded('llm_judge_failed', rule)
  }

  const threshold = Number(judgeCfg['clarity_threshold'] ?? 0.4)
  if (judged.clarity_score < threshold) {
    const slotHints = judged.missing_slots
      .slice(0, 2)
      .map((s) => s.question)
      .filter(Boolean)
    const question = [judged.question || rule.question, ...slotHints].filter(Boolean).join('\n')
    logger.info(
      'llm_low_clarity score=%s missing_slots=%d',
      judged.clarity_score, judged.missing_slots.length,
    )
    return {
      needed: true,
      reason: `llm_low_score:${judged.clarity_score}`,
      question,
      // 模型结合语境生成的候选方向优先；模型未给方向时回退配置的静态候选
      options: judged.options.length > 0 ? judged.options : rule.options,
      clarity_score: judged.clarity_score,
      missing_slots: judged.missing_slots,
      source: 'llm',
    }
  }

  return {
    needed: false,
    reason: `llm_sufficient:${judged.clarity_score}`,
    question: rule.question,
    options: [],
    clarity_score: judged.clarity_score,
    missing_slots: judged.missing_slots,
    source: 'llm',
  }
}
