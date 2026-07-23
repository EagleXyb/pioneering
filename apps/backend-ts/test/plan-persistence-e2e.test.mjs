/**
 * 时间轴步骤持久化 —— 端到端（E2E）检查测试
 *
 * 验证文档《时间轴步骤持久化-后端与DB补丁.md》的后端实现：
 *   1. mergePlanSteps 纯函数单元测试（replan 跳过 / 保序 / 后写覆盖 / 空输入）
 *   2. GET /agent/messages/:messageId/plan 持久化恢复（步骤字段 / phase / collapsedSteps）
 *   3. POST /agent/messages/:messageId/plan/collapsed 折叠状态回传（合并 metadata）
 *   4. 异常处理：404 不存在 / 401 未认证 / IDOR 越权防护
 *   5. messageToResponse 包含 metadata 字段（前端 converter 依赖）
 *   6. 全链路流式 + 持久化（依赖 LLM_API_KEY，可选）
 *
 * 运行方式：
 *   cd apps/backend-ts
 *   npm run build                                    # 先构建 dist/
 *   node --env-file=.env test/plan-persistence-e2e.test.mjs
 *
 * 依赖：
 *   - PostgreSQL（DATABASE_URL），plan_steps 表已由 Python init_db() 创建
 *   - 端口 8090（避开 8088 开发服务与 8089 既有测试）
 */
import { buildApp } from '../dist/app.js'
import { createAccessToken } from '../dist/core/security.js'
import { genId } from '../dist/utils/id.js'
import { mergePlanSteps } from '../dist/core/agent-bridge.js'

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  magenta: '\x1b[35m',
}

function log(tag, msg, color = colors.cyan) {
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`${colors.gray}${ts}${colors.reset} ${color}[${tag}]${colors.reset} ${msg}`)
}

// ============================================================
// 断言工具
// ============================================================
function assert(condition, message) {
  if (!condition) {
    throw new Error(`断言失败: ${message}`)
  }
}

function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    throw new Error(`断言失败: ${message}\n  期望: ${e}\n  实际: ${a}`)
  }
}

// ============================================================
// Part 1: mergePlanSteps 纯函数单元测试
// ============================================================

function testMergePlanStepsBasic() {
  log('unit.merge', '========== mergePlanSteps 基础合并 ==========', colors.yellow)

  const planData = [
    { step_id: 'step_1', title: '查询天气', description: '调用天气 API', depends_on: [] },
    { step_id: 'step_2', title: '生成总结', description: '汇总信息', depends_on: ['step_1'] },
  ]
  const stepUpdates = [
    { id: 'step_1', status: 'running', started_at: 1000 },
    { id: 'step_1', status: 'done', result: '晴天 25°C', finished_at: 2000 },
    { id: 'step_2', status: 'done', result: '今日天气晴朗', started_at: 2100, finished_at: 2500 },
  ]

  const merged = mergePlanSteps(planData, stepUpdates)

  assert(merged.length === 2, `应有 2 个步骤，实际 ${merged.length}`)
  assertEqual(merged[0].step_id, 'step_1', '第一个步骤应为 step_1')
  assertEqual(merged[0].title, '查询天气', 'step_1 title')
  assertEqual(merged[0].status, 'done', 'step_1 终态应为 done（后写覆盖）')
  assertEqual(merged[0].result, '晴天 25°C', 'step_1 result')
  assertEqual(merged[0].started_at, 1000, 'step_1 started_at')
  assertEqual(merged[0].finished_at, 2000, 'step_1 finished_at')
  assertEqual(merged[0].depends_on, [], 'step_1 depends_on')

  assertEqual(merged[1].step_id, 'step_2', '第二个步骤应为 step_2')
  assertEqual(merged[1].status, 'done', 'step_2 终态应为 done')
  assertEqual(merged[1].depends_on, ['step_1'], 'step_2 depends_on 应含 step_1')

  log('unit.merge', '✓ 测试通过', colors.green)
  return true
}

function testMergePlanStepsReplanSkip() {
  log('unit.replan', '========== mergePlanSteps replan 跳过 ==========', colors.yellow)

  // 场景：第一次 plan 有 step_1/step_2，replan 后只保留 step_1/step_3
  // step_2 的 update 应被跳过（不在最新 plan 中）
  const planData = [
    { step_id: 'step_1', title: '步骤一' },
    { step_id: 'step_3', title: '步骤三' },
  ]
  const stepUpdates = [
    { id: 'step_1', status: 'done', result: '完成' },
    { id: 'step_2', status: 'done', result: '旧步骤完成（应被跳过）' },
    { id: 'step_3', status: 'running' },
  ]

  const merged = mergePlanSteps(planData, stepUpdates)

  assert(merged.length === 2, `replan 后应只剩 2 个步骤，实际 ${merged.length}`)
  assertEqual(merged[0].step_id, 'step_1', '第一个应为 step_1')
  assertEqual(merged[1].step_id, 'step_3', '第二个应为 step_3')

  // step_2 不在结果中
  const hasStep2 = merged.some((s) => s.step_id === 'step_2')
  assert(!hasStep2, 'step_2 应被跳过（不在最新 plan 中）')

  log('unit.replan', '✓ 测试通过', colors.green)
  return true
}

function testMergePlanStepsOrderPreservation() {
  log('unit.order', '========== mergePlanSteps 保序 ==========', colors.yellow)

  const planData = [
    { step_id: 'c', title: 'C' },
    { step_id: 'a', title: 'A' },
    { step_id: 'b', title: 'B' },
  ]
  const stepUpdates = [
    { id: 'b', status: 'done' },
    { id: 'a', status: 'done' },
    { id: 'c', status: 'done' },
  ]

  const merged = mergePlanSteps(planData, stepUpdates)

  // 输出顺序应与 planData 一致（c, a, b），而非 stepUpdates 顺序
  assertEqual(merged.map((s) => s.step_id), ['c', 'a', 'b'], '输出顺序应与 planData 一致')

  log('unit.order', '✓ 测试通过', colors.green)
  return true
}

function testMergePlanStepsEmpty() {
  log('unit.empty', '========== mergePlanSteps 空输入 ==========', colors.yellow)

  const merged = mergePlanSteps([], [])
  assertEqual(merged, [], '空 planData + 空 stepUpdates 应返回空数组')

  // 有 step_update 但无 planData → 也应返回空（无骨架）
  const merged2 = mergePlanSteps([], [{ id: 'step_1', status: 'done' }])
  assertEqual(merged2, [], '无 planData 时 step_updates 应全部跳过')

  log('unit.empty', '✓ 测试通过', colors.green)
  return true
}

function testMergePlanStepsLastWriteWins() {
  log('unit.lastwrite', '========== mergePlanSteps 后写覆盖 ==========', colors.yellow)

  const planData = [{ step_id: 'step_1', title: '步骤一' }]
  const stepUpdates = [
    { id: 'step_1', status: 'running', result: '中间结果' },
    { id: 'step_1', status: 'failed', error: '执行失败', result: undefined },
    { id: 'step_1', status: 'done', result: '最终成功' },  // 最后一次应覆盖
  ]

  const merged = mergePlanSteps(planData, stepUpdates)

  assertEqual(merged[0].status, 'done', 'status 应为最后一次的 done')
  // result: 最后一次明确设为 '最终成功'
  assertEqual(merged[0].result, '最终成功', 'result 应为最后一次的值')
  // error: 第二次设为 '执行失败'，第三次未设置 error 字段 → 保持 '执行失败'
  assertEqual(merged[0].error, '执行失败', 'error 应保持第二次的值（第三次未覆盖）')

  log('unit.lastwrite', '✓ 测试通过', colors.green)
  return true
}

// ============================================================
// Part 2: HTTP E2E 测试工具函数
// ============================================================

/**
 * 解析被 response-wrapper 包装的响应。
 * 成功: { code: 200, data: <actual>, message: 'success' }
 * 错误: { code: <status>, message: <msg>, details: <msg>, requestId: <uuid> }
 */
async function parseResponse(response) {
  const body = await response.json()
  return { status: response.status, body }
}

/**
 * 在数据库中播种一个完整的 plan 快照（user + session + assistant message + plan_steps + metadata）。
 * 返回关键 ID 供测试断言使用。
 */
async function seedPlanSnapshot(prisma, userId, options = {}) {
  const sessionId = options.sessionId ?? genId('sess_')
  const messageId = options.messageId ?? genId('msg_')
  const phase = options.phase ?? 'done'
  const error = options.error ?? null
  const collapsedSteps = options.collapsedSteps ?? {}
  const steps = options.steps ?? [
    { step_id: 'step_1', title: '查询数据', description: '从数据库查询', status: 'done', result: '查询到 10 条记录', started_at: 1000, finished_at: 1500 },
    { step_id: 'step_2', title: '生成报告', description: '汇总分析', status: 'done', result: '报告已生成', started_at: 1600, finished_at: 2000 },
  ]

  // 创建会话
  await prisma.chatSession.create({
    data: {
      id: sessionId,
      userId,
      title: 'E2E 测试会话',
      model: 'test-model',
      agentMode: 'plan_execute',
    },
  })

  // 创建 assistant 消息（含 plan_phase metadata）
  await prisma.chatMessage.create({
    data: {
      id: messageId,
      sessionId,
      userId,
      role: 'assistant',
      content: '任务已完成',
      extraMetadata: { plan_phase: phase, plan_error: error, collapsed_steps: collapsedSteps },
    },
  })

  // 创建 plan_steps
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    await prisma.planStep.create({
      data: {
        id: genId('pstep_'),
        messageId,
        sessionId,
        userId,
        stepId: s.step_id,
        stepIndex: i,
        title: s.title,
        description: s.description ?? null,
        dependsOn: s.depends_on ?? undefined,
        status: s.status,
        result: s.result ?? null,
        error: s.error ?? null,
        startedAt: s.started_at ? new Date(s.started_at) : null,
        finishedAt: s.finished_at ? new Date(s.finished_at) : null,
      },
    })
  }

  return { sessionId, messageId, steps }
}

// ============================================================
// Part 3: HTTP E2E 测试用例
// ============================================================

/**
 * 测试 GET /agent/messages/:messageId/plan 返回持久化的步骤快照
 */
async function testGetPlan(baseUrl, token, prisma, userId) {
  log('e2e.getplan', '========== GET /plan 持久化恢复 ==========', colors.yellow)

  const { messageId, steps } = await seedPlanSnapshot(prisma, userId)

  try {
    const response = await fetch(`${baseUrl}/agent/messages/${messageId}/plan`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const { status, body } = await parseResponse(response)

    assertEqual(status, 200, `HTTP 状态码应为 200，实际 ${status}`)
    assertEqual(body.code, 200, '响应 code 应为 200')
    assertEqual(body.data.messageId, messageId, 'messageId 应匹配')
    assertEqual(body.data.phase, 'done', 'phase 应为 done')
    assertEqual(body.data.error, null, 'error 应为 null')

    const returnedSteps = body.data.steps
    assertEqual(returnedSteps.length, steps.length, `步骤数应为 ${steps.length}`)

    // 验证步骤字段映射（snake_case）
    const s0 = returnedSteps[0]
    assertEqual(s0.step_id, 'step_1', 'step_id 字段映射')
    assertEqual(s0.step_index, 0, 'step_index 应为 0')
    assertEqual(s0.title, '查询数据', 'title 字段')
    assertEqual(s0.description, '从数据库查询', 'description 字段')
    assertEqual(s0.status, 'done', 'status 字段')
    assertEqual(s0.result, '查询到 10 条记录', 'result 字段')
    assert(typeof s0.started_at === 'number', 'started_at 应为数字时间戳')
    assert(typeof s0.finished_at === 'number', 'finished_at 应为数字时间戳')

    // collapsedSteps 默认空对象
    assertEqual(body.data.collapsedSteps, {}, 'collapsedSteps 默认应为空对象')

    log('e2e.getplan', '✓ 测试通过', colors.green)
    return true
  } finally {
    await cleanupSnapshot(prisma, messageId)
  }
}

/**
 * 测试 GET /plan 对不存在的消息返回 404
 */
async function testGetPlanNotFound(baseUrl, token) {
  log('e2e.404', '========== GET /plan 不存在消息 → 404 ==========', colors.yellow)

  const fakeId = 'msg_nonexistent_' + Date.now()
  const response = await fetch(`${baseUrl}/agent/messages/${fakeId}/plan`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const { status, body } = await parseResponse(response)

  assertEqual(status, 404, `HTTP 状态码应为 404，实际 ${status}`)
  assertEqual(body.code, 404, '响应 code 应为 404')
  assert(body.message.includes('不存在') || body.message.includes('not found'), `错误信息应含"不存在"，实际: ${body.message}`)

  log('e2e.404', '✓ 测试通过', colors.green)
  return true
}

/**
 * 测试 GET /plan 未认证 → 401
 */
async function testGetPlanUnauthorized(baseUrl) {
  log('e2e.401', '========== GET /plan 未认证 → 401 ==========', colors.yellow)

  const response = await fetch(`${baseUrl}/agent/messages/msg_anything/plan`)
  const { status } = await parseResponse(response)

  assertEqual(status, 401, `HTTP 状态码应为 401，实际 ${status}`)

  log('e2e.401', '✓ 测试通过', colors.green)
  return true
}

/**
 * 测试 IDOR 越权防护：用户 A 不能访问用户 B 的消息 plan
 */
async function testGetPlanIDOR(baseUrl, tokenA, prisma, userBId) {
  log('e2e.idor', '========== GET /plan IDOR 越权防护 ==========', colors.yellow)

  // 用户 B 创建消息
  const { messageId } = await seedPlanSnapshot(prisma, userBId)

  try {
    // 用户 A 尝试访问用户 B 的消息
    const response = await fetch(`${baseUrl}/agent/messages/${messageId}/plan`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    const { status, body } = await parseResponse(response)

    assertEqual(status, 404, `用户 A 访问用户 B 的消息应返回 404，实际 ${status}`)
    assertEqual(body.code, 404, '响应 code 应为 404')

    log('e2e.idor', '✓ 测试通过', colors.green)
    return true
  } finally {
    await cleanupSnapshot(prisma, messageId)
  }
}

/**
 * 测试 POST /plan/collapsed 保存折叠状态，后续 GET 能读到
 */
async function testPostCollapsed(baseUrl, token, prisma, userId) {
  log('e2e.collapsed', '========== POST /plan/collapsed 折叠回传 ==========', colors.yellow)

  const { messageId } = await seedPlanSnapshot(prisma, userId, { phase: 'done' })

  try {
    // 1. 回传折叠状态
    const collapsedSteps = { step_1: true, step_2: false }
    const postResponse = await fetch(`${baseUrl}/agent/messages/${messageId}/plan/collapsed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ collapsedSteps }),
    })
    const { status: postStatus, body: postBody } = await parseResponse(postResponse)

    assertEqual(postStatus, 200, `POST 应返回 200，实际 ${postStatus}`)
    assertEqual(postBody.data.message, '折叠状态已保存', '应返回成功消息')

    // 2. GET 验证折叠状态已持久化
    const getResponse = await fetch(`${baseUrl}/agent/messages/${messageId}/plan`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const { body: getBody } = await parseResponse(getResponse)

    assertEqual(getBody.data.collapsedSteps, collapsedSteps, 'collapsedSteps 应与回传一致')
    // phase / error 应保留（不被 collapsed 覆盖）
    assertEqual(getBody.data.phase, 'done', 'phase 应保留为 done')
    assertEqual(getBody.data.error, null, 'error 应保留为 null')

    log('e2e.collapsed', '✓ 测试通过', colors.green)
    return true
  } finally {
    await cleanupSnapshot(prisma, messageId)
  }
}

/**
 * 测试 POST /plan/collapsed 保留现有 plan_phase/plan_error metadata
 */
async function testPostCollapsedPreservesMetadata(baseUrl, token, prisma, userId) {
  log('e2e.preserve', '========== POST /plan/collapsed 保留 plan_error ==========', colors.yellow)

  // 消息已有 plan_phase=error + plan_error
  const { messageId } = await seedPlanSnapshot(prisma, userId, {
    phase: 'error',
    error: 'LLM 调用超时',
  })

  try {
    const collapsedSteps = { step_1: true }
    const response = await fetch(`${baseUrl}/agent/messages/${messageId}/plan/collapsed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ collapsedSteps }),
    })
    const { status } = await parseResponse(response)
    assertEqual(status, 200, `POST 应返回 200，实际 ${status}`)

    // GET 验证 plan_phase/plan_error 仍在
    const getResponse = await fetch(`${baseUrl}/agent/messages/${messageId}/plan`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const { body } = await parseResponse(getResponse)

    assertEqual(body.data.phase, 'error', 'phase 应保留为 error')
    assertEqual(body.data.error, 'LLM 调用超时', 'plan_error 应保留')
    assertEqual(body.data.collapsedSteps, collapsedSteps, 'collapsedSteps 应已保存')

    log('e2e.preserve', '✓ 测试通过', colors.green)
    return true
  } finally {
    await cleanupSnapshot(prisma, messageId)
  }
}

/**
 * 测试 POST /plan/collapsed 对不存在消息 → 404
 */
async function testPostCollapsedNotFound(baseUrl, token) {
  log('e2e.collapsed404', '========== POST /plan/collapsed 不存在消息 → 404 ==========', colors.yellow)

  const fakeId = 'msg_nonexistent_' + Date.now()
  const response = await fetch(`${baseUrl}/agent/messages/${fakeId}/plan/collapsed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ collapsedSteps: {} }),
  })
  const { status, body } = await parseResponse(response)

  assertEqual(status, 404, `HTTP 状态码应为 404，实际 ${status}`)
  assertEqual(body.code, 404, '响应 code 应为 404')

  log('e2e.collapsed404', '✓ 测试通过', colors.green)
  return true
}

/**
 * 测试 POST /plan/collapsed 未认证 → 401
 */
async function testPostCollapsedUnauthorized(baseUrl) {
  log('e2e.collapsed401', '========== POST /plan/collapsed 未认证 → 401 ==========', colors.yellow)

  const response = await fetch(`${baseUrl}/agent/messages/msg_anything/plan/collapsed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collapsedSteps: {} }),
  })
  const { status } = await parseResponse(response)

  assertEqual(status, 401, `HTTP 状态码应为 401，实际 ${status}`)

  log('e2e.collapsed401', '✓ 测试通过', colors.green)
  return true
}

/**
 * 测试 messageToResponse 包含 metadata 字段
 * 前端 converter.ts 依赖 m.metadata 判断是否含 plan 数据
 */
async function testMessageMetadataField(baseUrl, token, prisma, userId) {
  log('e2e.metadata', '========== messageToResponse 含 metadata 字段 ==========', colors.yellow)

  const { sessionId, messageId } = await seedPlanSnapshot(prisma, userId, { phase: 'done' })

  try {
    // GET /agent/sessions/:sessionId/messages 应返回含 metadata 的消息
    const response = await fetch(`${baseUrl}/agent/sessions/${sessionId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const { status, body } = await parseResponse(response)

    assertEqual(status, 200, `HTTP 状态码应为 200，实际 ${status}`)

    // 响应被包装为 { code, data, message }，data 是消息数组
    const messages = body.data
    assert(Array.isArray(messages), 'data 应为数组')

    const assistantMsg = messages.find((m) => m.id === messageId)
    assert(assistantMsg != null, '应能找到 assistant 消息')

    // 关键断言：metadata 字段存在且含 plan_phase
    assert(assistantMsg.metadata != null, 'metadata 字段不应为 null')
    assertEqual(assistantMsg.metadata.plan_phase, 'done', 'metadata.plan_phase 应为 done')

    log('e2e.metadata', '✓ 测试通过', colors.green)
    return true
  } finally {
    await cleanupSnapshot(prisma, messageId)
  }
}

/**
 * 测试非 plan_execute 消息不写入 plan metadata（避免污染）
 * 通过 react_agent 模式发送消息后验证 metadata 为 null/undefined
 */
async function testNonPlanMessageNoMetadata(baseUrl, token, prisma, userId) {
  log('e2e.noplan', '========== 非 plan 消息无 plan metadata ==========', colors.yellow)

  // 手动创建一个普通 assistant 消息（无 plan 数据，模拟 react_agent）
  const sessionId = genId('sess_')
  const messageId = genId('msg_')
  await prisma.chatSession.create({
    data: { id: sessionId, userId, title: '普通会话', model: 'test', agentMode: 'react_agent' },
  })
  await prisma.chatMessage.create({
    data: {
      id: messageId,
      sessionId,
      userId,
      role: 'assistant',
      content: '你好',
      // 不设 extraMetadata（模拟 react_agent 无 plan 数据）
    },
  })

  try {
    const response = await fetch(`${baseUrl}/agent/messages/${messageId}/plan`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const { status, body } = await parseResponse(response)

    assertEqual(status, 200, `HTTP 状态码应为 200，实际 ${status}`)
    // phase 应为 null（无 plan_phase metadata）
    assertEqual(body.data.phase, null, '非 plan 消息 phase 应为 null')
    assertEqual(body.data.error, null, '非 plan 消息 error 应为 null')
    // steps 应为空数组（无持久化步骤）
    assertEqual(body.data.steps, [], '非 plan 消息 steps 应为空数组')

    log('e2e.noplan', '✓ 测试通过', colors.green)
    return true
  } finally {
    await prisma.chatMessage.deleteMany({ where: { sessionId } })
    await prisma.chatSession.deleteMany({ where: { id: sessionId } })
  }
}

// ============================================================
// Part 4: 全链路流式 + 持久化测试（依赖 LLM_API_KEY）
// ============================================================

/**
 * 模拟前端 SSE 解析（与 agent-e2e-http.test.mjs 一致）
 */
async function streamPlanExecute(baseUrl, token, body, handlers) {
  const response = await fetch(`${baseUrl}/agent/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ stream: true, ...body }),
  })
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const planDeltas = []
  const stepUpdates = []
  let assistantMessageId = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data: ')) continue
      let event
      try { event = JSON.parse(trimmed.slice(6)) } catch { continue }
      if (event.type === 'STATE_DELTA' && event.phase === 'plan' && Array.isArray(event.plan)) {
        planDeltas.push(event)
      } else if (event.type === 'STATE_DELTA' && event.phase === 'execute' && event.step_update) {
        stepUpdates.push(event.step_update)
      }
      handlers?.onEvent?.(event)
    }
  }

  return { planDeltas, stepUpdates }
}

/**
 * 全链路测试：plan_execute 流式 → 持久化 → GET /plan 恢复
 */
async function testFullStreamingPersistence(baseUrl, token, prisma, userId) {
  log('e2e.fullstream', '========== 全链路流式 + 持久化 ==========', colors.yellow)

  // 1. 发送 plan_execute 请求
  const { planDeltas, stepUpdates } = await streamPlanExecute(
    baseUrl,
    token,
    { sessionId: null, message: '帮我查询今天的天气，然后写一段简短的天气总结', agentMode: 'plan_execute' },
    {},
  )

  if (planDeltas.length === 0) {
    log('e2e.fullstream', '⚠ 未收到 plan STATE_DELTA，LLM 可能未返回 plan 数据，跳过断言', colors.yellow)
    return 'skipped'
  }

  log('e2e.fullstream', `收到 ${planDeltas.length} 个 plan 快照，${stepUpdates.length} 个 step_update`, colors.cyan)

  // 2. 查找最新创建的 assistant 消息（本次流式生成的）
  const latestMsg = await prisma.chatMessage.findFirst({
    where: { userId, role: 'assistant' },
    orderBy: { createdAt: 'desc' },
  })
  assert(latestMsg != null, '应能找到刚创建的 assistant 消息')

  // 3. 验证 metadata 含 plan_phase
  const meta = latestMsg.extraMetadata
  assert(meta != null, 'assistant 消息 metadata 不应为 null')
  assert(meta.plan_phase === 'done' || meta.plan_phase === 'error', `plan_phase 应为 done/error，实际 ${meta.plan_phase}`)

  // 4. GET /plan 验证持久化步骤
  const response = await fetch(`${baseUrl}/agent/messages/${latestMsg.id}/plan`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const { body } = await parseResponse(response)

  const persistedSteps = body.data.steps
  const expectedCount = planDeltas[planDeltas.length - 1].plan.length
  assertEqual(persistedSteps.length, expectedCount, `持久化步骤数应与 plan 快照一致（${expectedCount}）`)

  // 5. 验证 step_index 保序
  for (let i = 0; i < persistedSteps.length; i++) {
    assertEqual(persistedSteps[i].step_index, i, `step_index 应为 ${i}`)
  }

  // 6. 验证 step_update 已合并到持久化步骤
  if (stepUpdates.length > 0) {
    const lastUpdate = stepUpdates[stepUpdates.length - 1]
    const persistedStep = persistedSteps.find((s) => s.step_id === lastUpdate.id)
    if (persistedStep) {
      assertEqual(persistedStep.status, lastUpdate.status, `步骤 ${lastUpdate.id} 的 status 应与最后 update 一致`)
    }
  }

  log('e2e.fullstream', '✓ 测试通过', colors.green)
  return true
}

// ============================================================
// 清理工具
// ============================================================

async function cleanupSnapshot(prisma, messageId) {
  try {
    const msg = await prisma.chatMessage.findUnique({ where: { id: messageId } })
    if (msg) {
      await prisma.planStep.deleteMany({ where: { messageId } })
      await prisma.chatMessage.delete({ where: { id: messageId } })
      await prisma.chatSession.deleteMany({ where: { id: msg.sessionId } })
    }
  } catch (e) {
    log('cleanup', `清理失败（可忽略）: ${e}`, colors.yellow)
  }
}

async function cleanupUser(prisma, userId) {
  try {
    await prisma.planStep.deleteMany({ where: { userId } })
    await prisma.agentToolExecution.deleteMany({ where: { userId } })
    await prisma.chatMessage.deleteMany({ where: { userId } })
    await prisma.chatSession.deleteMany({ where: { userId } })
    await prisma.user.delete({ where: { id: userId } })
  } catch (e) {
    log('cleanup', `用户清理失败: ${e}`, colors.yellow)
  }
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  log('main', '时间轴步骤持久化 E2E 测试启动', colors.yellow)
  log('main', `Node.js 版本: ${process.version}`, colors.gray)
  log('main', `DATABASE_URL: ${process.env.DATABASE_URL ?? '(默认)'}`, colors.gray)
  log('main', `LLM_API_KEY: ${process.env.LLM_API_KEY ? '(已设置)' : '(未设置)'}`, colors.gray)

  // ===== Part 1: mergePlanSteps 纯函数单元测试（不依赖 DB/HTTP） =====
  log('main', '---------- Part 1: mergePlanSteps 单元测试 ----------', colors.blue)
  const unitResults = {}
  unitResults.merge_basic = testMergePlanStepsBasic()
  unitResults.merge_replan = testMergePlanStepsReplanSkip()
  unitResults.merge_order = testMergePlanStepsOrderPreservation()
  unitResults.merge_empty = testMergePlanStepsEmpty()
  unitResults.merge_lastwrite = testMergePlanStepsLastWriteWins()
  console.log()

  // ===== Part 2 & 3: HTTP E2E 测试 =====
  log('main', '---------- Part 2/3: HTTP E2E 测试 ----------', colors.blue)

  const TEST_PORT = 8090
  const baseUrl = `http://127.0.0.1:${TEST_PORT}`

  log('main', '启动 Fastify 应用...', colors.blue)
  const app = await buildApp()
  await app.listen({ host: '127.0.0.1', port: TEST_PORT })
  log('main', `✓ 服务已启动: ${baseUrl}`, colors.green)

  // 创建测试用户 A 和 B
  const userA = await app.prisma.user.create({
    data: { id: genId('user_'), username: `e2e_plan_a_${Date.now()}`, nickname: '测试用户A', status: 1 },
  })
  const userB = await app.prisma.user.create({
    data: { id: genId('user_'), username: `e2e_plan_b_${Date.now()}`, nickname: '测试用户B', status: 1 },
  })
  const tokenA = createAccessToken(userA.id, { username: userA.username })
  log('main', `✓ 测试用户已创建: A=${userA.id} B=${userB.id}`, colors.green)

  const e2eResults = {}
  try {
    e2eResults.get_plan = await testGetPlan(baseUrl, tokenA, app.prisma, userA.id)
    console.log()
    e2eResults.get_plan_404 = await testGetPlanNotFound(baseUrl, tokenA)
    console.log()
    e2eResults.get_plan_401 = await testGetPlanUnauthorized(baseUrl)
    console.log()
    e2eResults.get_plan_idor = await testGetPlanIDOR(baseUrl, tokenA, app.prisma, userB.id)
    console.log()
    e2eResults.post_collapsed = await testPostCollapsed(baseUrl, tokenA, app.prisma, userA.id)
    console.log()
    e2eResults.post_collapsed_preserve = await testPostCollapsedPreservesMetadata(baseUrl, tokenA, app.prisma, userA.id)
    console.log()
    e2eResults.post_collapsed_404 = await testPostCollapsedNotFound(baseUrl, tokenA)
    console.log()
    e2eResults.post_collapsed_401 = await testPostCollapsedUnauthorized(baseUrl)
    console.log()
    e2eResults.message_metadata = await testMessageMetadataField(baseUrl, tokenA, app.prisma, userA.id)
    console.log()
    e2eResults.non_plan_no_metadata = await testNonPlanMessageNoMetadata(baseUrl, tokenA, app.prisma, userA.id)
    console.log()

    // ===== Part 4: 全链路流式 + 持久化（依赖 LLM） =====
    log('main', '---------- Part 4: 全链路流式 + 持久化 ----------', colors.blue)
    if (process.env.LLM_API_KEY) {
      e2eResults.full_stream = await testFullStreamingPersistence(baseUrl, tokenA, app.prisma, userA.id)
      console.log()
    } else {
      log('main', '跳过全链路流式测试（未设置 LLM_API_KEY）', colors.yellow)
      e2eResults.full_stream = 'skipped'
    }
  } finally {
    // 清理
    log('main', '清理测试数据...', colors.gray)
    await cleanupUser(app.prisma, userA.id)
    await cleanupUser(app.prisma, userB.id)
    await app.close()
    log('main', '✓ 清理完成，服务已关闭', colors.green)
  }

  // ===== 汇总 =====
  log('main', '========== 测试汇总 ==========', colors.yellow)
  log('main', '--- mergePlanSteps 单元测试 ---', colors.cyan)
  for (const [name, result] of Object.entries(unitResults)) {
    const status = result ? '✓ PASS' : '✗ FAIL'
    log('main', `  ${name}: ${status}`, result ? colors.green : colors.red)
  }
  log('main', '--- HTTP E2E 测试 ---', colors.cyan)
  for (const [name, result] of Object.entries(e2eResults)) {
    const status = result === true ? '✓ PASS' : result === false ? '✗ FAIL' : '⊘ SKIP'
    const color = result === true ? colors.green : result === false ? colors.red : colors.gray
    log('main', `  ${name}: ${status}`, color)
  }

  const allPassed = [...Object.values(unitResults), ...Object.values(e2eResults)].every(
    (r) => r === true || r === 'skipped',
  )
  log('main', allPassed ? '✓ 全部测试通过' : '✗ 存在失败用例', allPassed ? colors.green : colors.red)

  process.exit(allPassed ? 0 : 1)
}

main().catch(async (e) => {
  log('main', `未捕获异常: ${e}`, colors.red)
  log('main', `stack: ${e?.stack}`, colors.red)
  process.exit(1)
})
