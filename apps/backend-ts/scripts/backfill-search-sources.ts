/**
 * 一次性数据回填：为历史 assistant 消息补 sources 块（方案 A）
 *
 * 背景：search_engine 的观测在 contentBlocks 里只有 800 字截断的
 * tool_result.summary，历史消息回放时多条搜索结果只剩第一条。新代码会在
 * TOOL_CALL_RESULT 时额外落一个完整 sources 块，但**历史消息没有**。
 *
 * 完整结果并未丢失——agent_tool_executions.output_result 存的是未截断的
 * 工具返回（外层 { data: <工具 JSON 字符串>, status }，需解一层）。本脚本据此
 * 为旧消息补块：把 sources 块插入到对应 search tool_result 之后
 * （执行记录与 tool_result 同序产生，按序配对）。
 *
 * 幂等：已含 sources 块的消息直接跳过，可重复执行。
 *
 * 用法：
 *   npx tsx scripts/backfill-search-sources.ts --dry-run   # 只看不改
 *   npx tsx scripts/backfill-search-sources.ts             # 实际写入
 */
import { PrismaClient } from '@prisma/client'

import { extractSearchSources } from '../src/core/agent-bridge.js'

const prisma = new PrismaClient()

/**
 * outputResult 是外层封装：{ data: <工具返回 JSON 字符串>, status }。
 * 取出内层工具返回（search_engine 的 {tool,status,data:{results,source}}）。
 */
function unwrapOutputResult(outputResult: string | null): string | null {
  if (!outputResult) return null
  let outer: unknown
  try {
    outer = JSON.parse(outputResult)
  } catch {
    return outputResult
  }
  if (outer && typeof outer === 'object' && typeof (outer as any).data === 'string') {
    return (outer as any).data
  }
  return outputResult
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')

  const messages = await prisma.chatMessage.findMany({
    where: { role: 'assistant' },
    select: { id: true, createdAt: true, contentBlocks: true },
    orderBy: { createdAt: 'asc' },
  })

  let patched = 0
  let skipped = 0

  for (const m of messages) {
    const blocks = Array.isArray(m.contentBlocks)
      ? (m.contentBlocks as Array<Record<string, any>>)
      : null
    // 无内容块 / 已是新格式：跳过（幂等）
    if (!blocks || blocks.some((b) => b?.type === 'sources')) {
      skipped += 1
      continue
    }

    // 该消息的搜索执行记录（按创建顺序，与 contentBlocks 的 tool_result 同序）
    const execs = await prisma.agentToolExecution.findMany({
      where: { messageId: m.id, toolName: { contains: 'search', mode: 'insensitive' } },
      select: { toolName: true, outputResult: true },
      orderBy: { createdAt: 'asc' },
    })
    if (execs.length === 0) {
      skipped += 1
      continue
    }

    // 第 i 个搜索 tool_result ↔ 第 i 个搜索执行记录
    const insertAfter = new Map<number, Array<Record<string, any>>>()
    let execIdx = 0
    for (let i = 0; i < blocks.length && execIdx < execs.length; i++) {
      const b = blocks[i]!
      if (b.type !== 'tool_result' || !/search/i.test(String(b.toolName ?? ''))) continue
      const exec = execs[execIdx]!
      execIdx += 1
      const sources = extractSearchSources(
        exec.toolName,
        unwrapOutputResult(exec.outputResult),
      )
      if (!sources) continue
      insertAfter.set(i, [
        {
          type: 'sources',
          status: 'success',
          toolName: exec.toolName,
          executionId: b.executionId,
          ...(sources.source ? { source: sources.source } : {}),
          items: sources.items,
        },
      ])
    }

    const extraCount = [...insertAfter.values()].reduce((n, list) => n + list.length, 0)
    if (extraCount === 0) {
      skipped += 1
      continue
    }

    const next: Array<Record<string, any>> = []
    for (let i = 0; i < blocks.length; i++) {
      next.push(blocks[i]!)
      const extra = insertAfter.get(i)
      if (extra) next.push(...extra)
    }

    if (!dryRun) {
      await prisma.chatMessage.update({
        where: { id: m.id },
        data: { contentBlocks: next as any },
      })
    }
    patched += 1
    console.log(
      `${dryRun ? '[dry-run] ' : ''}patched ${m.id} (${m.createdAt.toISOString()}): +${extraCount} sources block(s)`,
    )
  }

  console.log(`done: patched=${patched} skipped=${skipped}${dryRun ? ' (dry-run)' : ''}`)
}

main()
  .catch((e) => {
    console.error('backfill failed:', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
