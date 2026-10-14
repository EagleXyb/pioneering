// P1-2: plan_execute 汇总节点（`plan_summarize`）。
//
// 缺陷背景：最终答复由 responseNode（graph/nodes.ts）提取——
// 它只取 messages 中最后一条无 tool_calls 的 AIMessage，
// **完全不读 step_results**。于是多步任务的最终答复 = 最后一步的自述：
//   · 最后一步是"整合/校验" → 用户只看到一句"已整合完成"；
//   · 中间各步的真实产物（调研结论、分章内容）全部丢失。
// 实测（sess_d7185e5c…）之所以内容完整，是因为 LLM 恰好在第 1 步把全文都吐进了
// 正文——那是运气，不是机制。
//
// 修复：在计划收敛后、进入 finalize_response 之前插入本节点：
//   · 仅当存在 ≥2 个有产物的步骤时才调用 LLM（单步任务零额外开销）
//   · 把各步产物按预算截断后交给 LLM 整合，产出一条 AIMessage
//   · responseNode 随后取到的"最后一条 AIMessage"即为整合答复
//   · 汇总失败（LLM 异常等）时静默降级为原行为，不影响主流程
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'

import { getConfig } from '../../config/runtime-config.js'
import type { ModuAgentState } from '../state.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[graph.plan_execute.summarize] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[graph.plan_execute.summarize] ${msg}`, ...args),
}

function _truncate(text: string, maxChars: number): string {
  if (!text) return ''
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '…（本步内容已截断）'
}

function _extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c === 'string' ? c : (c?.text ?? '')))
      .filter(Boolean)
      .join('')
  }
  return ''
}

/**
 * 创建汇总节点。
 *
 * @param llm 未绑定工具的原始 LLM（与 planner 一致，避免汇总过程再发起工具调用）
 */
export function makePlanSummarizeNode(
  llm: any,
): (state: ModuAgentState) => Promise<Partial<ModuAgentState>> {
  return async function planSummarizeNode(
    state: ModuAgentState,
  ): Promise<Partial<ModuAgentState>> {
    const config = getConfig()
    const results = (state.step_results ?? []).filter((r) => {
      const st = String(r?.['status'] ?? '')
      const out = String(r?.['output'] ?? '')
      // 只汇总有实际产物的步骤（跳过 skipped / 无输出的 failed）
      return (st === 'done' || st === 'degraded') && out.trim().length > 0
    })

    // 单步（或无产物）→ 无需汇总：responseNode 取最后一条 AIMessage 已足够
    if (results.length <= 1) {
      logger.info('skip summarize (usable step results=%d)', results.length)
      return {}
    }

    const perStep = Number(config.get('plan_execute.summarize_max_chars_per_step', 3000))
    const totalMax = Number(config.get('plan_execute.summarize_max_total_chars', 24000))
    const plan = state.plan ?? []
    const titleOf = (stepId: string) => {
      const hit = plan.find((s) => String(s?.['step_id'] ?? '') === stepId)
      return String(hit?.['title'] ?? stepId)
    }

    let budget = totalMax
    const sections: string[] = []
    for (const r of results) {
      if (budget <= 0) break
      const stepId = String(r?.['step_id'] ?? '')
      const take = Math.max(0, Math.min(perStep, budget))
      const body = _truncate(String(r?.['output'] ?? ''), take)
      budget -= body.length
      sections.push(`### ${stepId} · ${titleOf(stepId)}\n${body}`)
    }

    const goal = String(
      state.cleaned_text ?? state.input_data?.['prompt'] ?? '',
    )

    const system = [
      '你是任务汇总模块。上方已按步骤完成一个多步骤任务，下面是各步骤的产出。',
      '请把它们整合为一份**完整、结构清晰、可直接交付给用户**的最终回答。',
      '要求：',
      '1) 保留各步骤的实质内容（结论、要点、案例、对比表），不要只写"已完成"这类概述；',
      '2) 用标题/表格等 Markdown 结构组织，层次分明、便于对照；',
      '3) 不要复述"我完成了第 N 步"这类过程话术；',
      '4) 不要调用任何工具；不要输出 JSON，只输出面向用户的正文。',
    ].join('\n')

    const user = [
      goal ? `用户的原始目标：\n${goal}\n` : '',
      '各步骤产出如下：\n',
      sections.join('\n\n'),
      '\n请输出整合后的最终回答。',
    ]
      .filter(Boolean)
      .join('\n')

    try {
      const response = await llm.invoke([
        new SystemMessage({ content: system }),
        new HumanMessage({ content: user }),
      ])
      const text = _extractText(response?.content ?? '').trim()
      if (!text) {
        logger.warning('summarize produced empty text; falling back to last step output')
        return {}
      }
      logger.info('summarized %d step result(s) → %d chars', results.length, text.length)
      // 以 AIMessage 追加：responseNode 取"最后一条无 tool_calls 的 AIMessage"，
      // 即本条；AG-UI adapter 也会把它流式下发为正文。
      return { messages: [new AIMessage({ content: text })] }
    } catch (e) {
      logger.warning('summarize LLM invoke failed, falling back to last step output: %s', String(e))
      return {}
    }
  }
}
