/**
 * Agent HTTP SSE 端到端测试
 *
 * 模拟前端真实调用方式（fetch + ReadableStream + 按 "data: " 前缀解析），
 * 完整验证：
 *   1. 用户注册 → 拿 JWT token
 *   2. POST /agent/completions（stream=true, agentMode='plan_execute'）
 *   3. 按 `data: ` 前缀（含空格）切行解析（与 apps/web/src/modes/task/hooks/usePlanExecuteChat.ts 一致）
 *   4. 验证事件类型：RUN_STARTED / TEXT_MESSAGE_CONTENT / STATE_DELTA / RUN_FINISHED
 *   5. 验证 plan_execute 模式的 plan 阶段 + execute 阶段 step_update
 *
 * 运行方式：
 *   cd apps/backend-ts
 *   node --env-file=.env test/agent-e2e-http.test.mjs
 *
 * 依赖：
 *   - PostgreSQL（DATABASE_URL）
 *   - LLM_API_KEY
 *   - 端口 8089（避开 8088 防止与开发服务冲突）
 */
import { buildApp } from '../dist/app.js'
import { createAccessToken } from '../dist/core/security.js'
import { genId } from '../dist/utils/id.js'

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

function logObj(tag, obj, color = colors.cyan) {
  log(tag, JSON.stringify(obj, null, 2), color)
}

// ============================================================
// 工具函数：用 fetch 解析 SSE 流（对齐前端 usePlanExecuteChat.ts 的解析逻辑）
// ============================================================

/**
 * 调用 /agent/completions 并按前端方式解析 SSE 流。
 *
 * @param {string} baseUrl 后端基础 URL
 * @param {string} token JWT token
 * @param {object} body 请求体（{ sessionId, message, stream, agentMode }）
 * @param {object} handlers 事件回调
 * @returns {Promise<{eventCount: number, eventTypes: Set<string>}>}
 */
async function streamAgent(baseUrl, token, body, handlers) {
  const response = await fetch(`${baseUrl}/agent/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ stream: true, ...body }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`HTTP ${response.status}: ${text}`)
  }
  if (!response.body) {
    throw new Error('response.body is null (no SSE stream)')
  }

  // 模拟前端 usePlanExecuteChat.ts 的解析逻辑
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventCount = 0
  const eventTypes = new Set()

  // 测试专用：累积所有事件用于断言
  const allEvents = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || '' // 保留最后未完成的行

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const dataStr = trimmed.slice(6) // 注意：slice(6) 对齐前端 "data: " 含空格
      let event
      try {
        event = JSON.parse(dataStr)
      } catch {
        // 测试环境不静默吞，输出警告便于排查
        log('stream.parse', `JSON.parse 失败: ${dataStr.slice(0, 200)}`, colors.yellow)
        continue
      }

      eventCount++
      const type = event.type ?? ''
      eventTypes.add(type)
      allEvents.push(event)

      // 派发到 handlers（对齐前端 switch case）
      switch (type) {
        case 'RUN_STARTED':
          handlers.onRunStarted?.(event)
          break
        case 'TEXT_MESSAGE_START':
          handlers.onTextMessageStart?.(event)
          break
        case 'TEXT_MESSAGE_CONTENT':
          handlers.onTextMessageContent?.(event)
          break
        case 'TEXT_MESSAGE_END':
          handlers.onTextMessageEnd?.(event)
          break
        case 'THINKING_START':
          handlers.onThinkingStart?.(event)
          break
        case 'THINKING_END':
          handlers.onThinkingEnd?.(event)
          break
        case 'STATE_DELTA':
          handlers.onStateDelta?.(event)
          break
        case 'TOOL_CALL_START':
          handlers.onToolCallStart?.(event)
          break
        case 'TOOL_CALL_RESULT':
          handlers.onToolCallResult?.(event)
          break
        case 'RUN_FINISHED':
          handlers.onRunFinished?.(event)
          break
        case 'RUN_ERROR':
          handlers.onRunError?.(event)
          break
        default:
          handlers.onUnknown?.(event)
      }
    }
  }

  // 处理 buffer 中残留的最后一行（若有）
  if (buffer.trim().startsWith('data: ')) {
    const dataStr = buffer.trim().slice(6)
    try {
      const event = JSON.parse(dataStr)
      eventCount++
      eventTypes.add(event.type ?? '')
      allEvents.push(event)
      handlers.onRunFinished?.(event) // 最后一个通常是 RUN_FINISHED
    } catch {}
  }

  return { eventCount, eventTypes, allEvents }
}

// ============================================================
// 测试用例
// ============================================================

/**
 * 测试 1：React Agent 模式（agentMode='react_agent'）
 * 验证基础 SSE 流式：TEXT_MESSAGE_CONTENT + RUN_FINISHED
 */
async function testReactAgent(app, baseUrl, token) {
  log('test.react', '========== 测试 React Agent 模式 ==========', colors.yellow)

  let accumulatedText = ''
  let hasRunStarted = false
  let hasRunFinished = false
  let hasRunError = false
  let errorMessage = ''
  let textContentCount = 0

  const { eventCount, eventTypes } = await streamAgent(
    baseUrl,
    token,
    {
      sessionId: null, // 让后端自动创建会话
      message: '你好，请用一句话介绍你自己',
      agentMode: 'react_agent',
    },
    {
      onRunStarted: () => { hasRunStarted = true; log('test.react', 'RUN_STARTED', colors.green) },
      onTextMessageContent: (e) => {
        accumulatedText += e.delta ?? ''
        textContentCount++
        if (textContentCount % 20 === 0) {
          log('test.react', `TEXT_MESSAGE_CONTENT x${textContentCount} len=${accumulatedText.length}`, colors.gray)
        }
      },
      onRunFinished: () => { hasRunFinished = true; log('test.react', 'RUN_FINISHED', colors.green) },
      onRunError: (e) => {
        hasRunError = true
        errorMessage = e.message ?? ''
        log('test.react', `RUN_ERROR: ${errorMessage}`, colors.red)
      },
    },
  )

  log('test.react', `事件统计: total=${eventCount} types=[${[...eventTypes].join(', ')}]`, colors.cyan)
  log('test.react', `RUN_STARTED=${hasRunStarted} RUN_FINISHED=${hasRunFinished} RUN_ERROR=${hasRunError}`, colors.cyan)
  log('test.react', `文本内容长度: ${accumulatedText.length} (CONTENT 事件数: ${textContentCount})`, colors.cyan)
  if (accumulatedText) {
    log('test.react', `文本预览: ${accumulatedText.slice(0, 150)}`, colors.cyan)
  }

  const passed = hasRunStarted && hasRunFinished && !hasRunError && accumulatedText.length > 0
  log('test.react', passed ? '✓ 测试通过' : '✗ 测试失败', passed ? colors.green : colors.red)
  return passed
}

/**
 * 测试 2：Plan-Execute 模式（agentMode='plan_execute'）
 * 验证完整流程：plan 阶段 STATE_DELTA(plan) + execute 阶段 STATE_DELTA(step_update) + 文本内容 + RUN_FINISHED
 */
async function testPlanExecute(app, baseUrl, token) {
  log('test.plan', '========== 测试 Plan-Execute 模式 ==========', colors.yellow)

  let accumulatedText = ''
  let hasRunStarted = false
  let hasRunFinished = false
  let hasRunError = false
  let errorMessage = ''
  const planDeltas = []
  const stepUpdates = []

  const { eventCount, eventTypes } = await streamAgent(
    baseUrl,
    token,
    {
      sessionId: null,
      message: '帮我查询今天的天气，然后写一段简短的天气总结',
      agentMode: 'plan_execute',
    },
    {
      onRunStarted: () => { hasRunStarted = true; log('test.plan', 'RUN_STARTED', colors.green) },
      onTextMessageContent: (e) => {
        accumulatedText += e.delta ?? ''
      },
      onStateDelta: (e) => {
        if (e.phase === 'plan' && Array.isArray(e.plan)) {
          planDeltas.push(e)
          log('test.plan', `STATE_DELTA[plan] steps=${e.plan.length}`, colors.magenta)
          for (const step of e.plan) {
            log('test.plan', `  - ${step.step_id}: ${step.title} [${step.status}]`, colors.magenta)
          }
        } else if (e.phase === 'execute' && e.step_update) {
          stepUpdates.push(e.step_update)
          log('test.plan', `STATE_DELTA[execute] ${e.step_update.id} → ${e.step_update.status}`, colors.magenta)
        } else {
          log('test.plan', `STATE_DELTA[other] phase=${e.phase} keys=${Object.keys(e).join(',')}`, colors.gray)
        }
      },
      onRunFinished: () => { hasRunFinished = true; log('test.plan', 'RUN_FINISHED', colors.green) },
      onRunError: (e) => {
        hasRunError = true
        errorMessage = e.message ?? ''
        log('test.plan', `RUN_ERROR: ${errorMessage}`, colors.red)
      },
    },
  )

  log('test.plan', `事件统计: total=${eventCount} types=[${[...eventTypes].join(', ')}]`, colors.cyan)
  log('test.plan', `RUN_STARTED=${hasRunStarted} RUN_FINISHED=${hasRunFinished} RUN_ERROR=${hasRunError}`, colors.cyan)
  log('test.plan', `文本内容长度: ${accumulatedText.length}`, colors.cyan)
  log('test.plan', `plan STATE_DELTA 数: ${planDeltas.length}`, colors.cyan)
  log('test.plan', `step_update STATE_DELTA 数: ${stepUpdates.length}`, colors.cyan)
  if (accumulatedText) {
    log('test.plan', `文本预览: ${accumulatedText.slice(0, 200)}`, colors.cyan)
  }
  if (planDeltas.length > 0) {
    log('test.plan', `plan 步骤数: ${planDeltas[0].plan.length}`, colors.cyan)
  }
  if (stepUpdates.length > 0) {
    log('test.plan', `step_updates: ${stepUpdates.map(s => `${s.id}=${s.status}`).join(', ')}`, colors.cyan)
  }
  if (hasRunError) {
    log('test.plan', `错误信息: ${errorMessage}`, colors.red)
  }

  const passed =
    hasRunStarted &&
    hasRunFinished &&
    !hasRunError &&
    accumulatedText.length > 0 &&
    planDeltas.length > 0 &&
    stepUpdates.length > 0
  log('test.plan', passed ? '✓ 测试通过' : '✗ 测试失败', passed ? colors.green : colors.red)
  return passed
}

/**
 * 测试 3：未认证请求应被拒绝（401）
 */
async function testUnauthorized(baseUrl) {
  log('test.auth', '========== 测试未认证请求 ==========', colors.yellow)

  try {
    const response = await fetch(`${baseUrl}/agent/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'test', stream: false }),
    })

    log('test.auth', `HTTP 状态码: ${response.status}`, colors.cyan)

    if (response.status === 401) {
      log('test.auth', '✓ 测试通过（401 未认证正确拒绝）', colors.green)
      return true
    }
    log('test.auth', `✗ 测试失败（期望 401，实际 ${response.status}）`, colors.red)
    return false
  } catch (e) {
    log('test.auth', `✗ 测试异常: ${e}`, colors.red)
    return false
  }
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  log('main', 'Agent HTTP SSE 端到端测试启动', colors.yellow)
  log('main', `Node.js 版本: ${process.version}`, colors.gray)
  log('main', `LLM_API_KEY: ${process.env.LLM_API_KEY ? '(已设置)' : '(未设置)'}`, colors.gray)
  log('main', `DATABASE_URL: ${process.env.DATABASE_URL ?? '(默认)'}`, colors.gray)

  // 1. 启动后端服务（使用 8089 防止与开发服务冲突）
  const TEST_PORT = 8089
  const baseUrl = `http://127.0.0.1:${TEST_PORT}`

  log('main', '启动 Fastify 应用...', colors.blue)
  const app = await buildApp()
  await app.listen({ host: '127.0.0.1', port: TEST_PORT })
  log('main', `✓ 服务已启动: ${baseUrl}`, colors.green)

  // 2. 准备测试用户（直接在数据库创建，避免注册端点的唯一性冲突）
  log('main', '准备测试用户...', colors.blue)
  const testUsername = `e2e_test_${Date.now()}`
  const user = await app.prisma.user.create({
    data: {
      id: genId('user_'),
      username: testUsername,
      nickname: testUsername,
      status: 1,
    },
  })
  const token = createAccessToken(user.id, { username: testUsername })
  log('main', `✓ 测试用户已创建: ${testUsername} (id=${user.id})`, colors.green)

  const results = {}
  try {
    // 测试 1：未认证请求
    results.unauthorized = await testUnauthorized(baseUrl)
    console.log()

    // 测试 2：React Agent（依赖 LLM）
    if (process.env.LLM_API_KEY) {
      results.react_agent = await testReactAgent(app, baseUrl, token)
      console.log()
    } else {
      log('main', '跳过 React Agent 测试（未设置 LLM_API_KEY）', colors.yellow)
      results.react_agent = 'skipped'
    }

    // 测试 3：Plan-Execute（依赖 LLM）
    if (process.env.LLM_API_KEY) {
      results.plan_execute = await testPlanExecute(app, baseUrl, token)
      console.log()
    } else {
      log('main', '跳过 Plan-Execute 测试（未设置 LLM_API_KEY）', colors.yellow)
      results.plan_execute = 'skipped'
    }
  } finally {
    // 清理：删除测试用户 + 关闭服务
    log('main', '清理测试数据...', colors.gray)
    try {
      await app.prisma.chatMessage.deleteMany({ where: { userId: user.id } })
      await app.prisma.chatSession.deleteMany({ where: { userId: user.id } })
      await app.prisma.user.delete({ where: { id: user.id } })
      log('main', '✓ 清理完成', colors.green)
    } catch (e) {
      log('main', `清理失败（可忽略）: ${e}`, colors.yellow)
    }

    await app.close()
    log('main', '服务已关闭', colors.gray)
  }

  // 汇总
  log('main', '========== 测试汇总 ==========', colors.yellow)
  for (const [name, result] of Object.entries(results)) {
    const status = result === true ? '✓ PASS' : result === false ? '✗ FAIL' : '⊘ SKIP'
    const color = result === true ? colors.green : result === false ? colors.red : colors.gray
    log('main', `  ${name}: ${status}`, color)
  }

  const allPassed = Object.values(results).every((r) => r === true || r === 'skipped')
  log('main', allPassed ? '✓ 全部测试通过' : '✗ 存在失败用例', allPassed ? colors.green : colors.red)

  process.exit(allPassed ? 0 : 1)
}

main().catch(async (e) => {
  log('main', `未捕获异常: ${e}`, colors.red)
  log('main', `stack: ${e?.stack}`, colors.red)
  process.exit(1)
})
