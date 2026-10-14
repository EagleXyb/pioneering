/**
 * P1 回归测试（2026-10-14）：plan_execute 的 planner 节点输出不得进入正文通道。
 *
 * 缺陷复刻（截图会话）：planner 用 streaming LLM 产出 7 步计划 JSON（structured=false
 * 走 JSON-in-text 降级），token 经 messages 流被当成"最终回答"逐段下发
 * TEXT_MESSAGE_CONTENT 并落库（collected_len=3457，其中绝大部分是计划 JSON）。
 *
 * 修复：messages 分支读取 metadata.langgraph_node，_TEXT_SUPPRESSED_NODES
 * （planner）直接 return []，不进缓冲、不发事件、不落库。
 */
import { describe, it, expect } from 'vitest'
import {
  AGUIStateMachine,
  AGUIStreamAdapter,
} from '@/orchestration/communication/agui-adapter.js'

function parse(ev: unknown): Record<string, unknown> {
  const e = ev as { data?: string }
  return JSON.parse(String(e?.data ?? '{}')) as Record<string, unknown>
}

function typesOf(events: unknown[]): string[] {
  return events.map((e) => String(parse(e).type ?? ''))
}

/** 构造 runner 归一化后的 messages 事件（含 [message_chunk, metadata] 拆解结果） */
function messagesEvent(content: string, node: string | undefined, id: string): Record<string, any> {
  const msg = { _getType: () => 'ai', id, content }
  return {
    type: 'messages',
    event: msg,
    data: msg,
    metadata: node === undefined ? {} : { langgraph_node: node },
  }
}

const LONG_PLAN_JSON =
  '{"goal":"系统性解释Prompt工程与上下文工程的核心概念",' +
  '"steps":[{"step_id":"step_1","title":"梳理知识框架与输出大纲","status":"pending"},' +
  '{"step_id":"step_2","title":"撰写基础提示技术章节","status":"pending"}],' +
  '"depends_on":[]}' + 'x'.repeat(200)

describe('P1 · planner 输出不得进入正文通道', () => {
  it('node=planner 的长文本 chunk 不产生任何事件（不直发正文、不落库）', () => {
    const sm = new AGUIStateMachine('trace-1', 'msg-1')

    const events = AGUIStreamAdapter._process_langgraph_event(
      sm,
      messagesEvent(LONG_PLAN_JSON, 'planner', 'plan-ai-1'),
      'messages',
    )

    expect(events).toEqual([])
    expect(sm.text_message_started).toBe(false)
    expect(sm.has_final_answer_text).toBe(false)
  })

  it('node=agent 的长文本不受影响（正常直发正文，不回归）', () => {
    const sm = new AGUIStateMachine('trace-2', 'msg-2')
    const answer = '这是一段足够长的最终回答内容，用于触发早期直发判定。'.repeat(12)

    const events = AGUIStreamAdapter._process_langgraph_event(
      sm,
      messagesEvent(answer, 'agent', 'agent-ai-1'),
      'messages',
    )

    expect(typesOf(events)).toContain('TEXT_MESSAGE_CONTENT')
  })

  it('planner 被抑制后，紧随其后的 agent 回答仍完整下发（顺序场景）', () => {
    const sm = new AGUIStateMachine('trace-3', 'msg-3')

    // 1. planner 计划（抑制）
    const plannerEvents = AGUIStreamAdapter._process_langgraph_event(
      sm,
      messagesEvent(LONG_PLAN_JSON, 'planner', 'plan-ai-1'),
      'messages',
    )
    expect(plannerEvents).toEqual([])
    expect(sm.text_message_started).toBe(false)

    // 2. agent 最终回答（正常）
    const answer = '以下是最终整理好的说明文档正文。'.repeat(10)
    const agentEvents = AGUIStreamAdapter._process_langgraph_event(
      sm,
      messagesEvent(answer, 'agent', 'agent-ai-2'),
      'messages',
    )
    expect(typesOf(agentEvents)).toContain('TEXT_MESSAGE_CONTENT')
  })

  it('无 metadata（非图 messages 来源）保持既有行为，不回归', () => {
    const sm = new AGUIStateMachine('trace-4', 'msg-4')
    const text = '普通直答文本内容。'.repeat(20)

    const events = AGUIStreamAdapter._process_langgraph_event(
      sm,
      messagesEvent(text, undefined, 'plain-ai-1'),
      'messages',
    )

    expect(typesOf(events)).toContain('TEXT_MESSAGE_CONTENT')
  })
})
