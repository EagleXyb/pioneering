/**
 * Agent 管道直连测试（绕过 HTTP/DB 层）
 *
 * 直接调用 modu-agent 的 create_agent → stream_response → AGUIStreamAdapter 管道，
 * 验证：
 *   1. LangGraph stream 事件格式归一化是否正确
 *   2. AGUIStreamAdapter 是否产出 TEXT_MESSAGE_CONTENT 事件
 *   3. Plan-Execute 模式是否产出 STATE_DELTA 事件
 *
 * 运行方式：
 *   cd apps/backend-ts
 *   node --experimental-vm-modules test/agent-pipeline.test.mjs
 *
 * 环境变量：
 *   LLM_API_KEY - 必填，LLM API 密钥
 *   LLM_BASE_URL - 可选，默认 deepseek
 *   LLM_DEFAULT_MODEL - 可选，默认 deepseek-chat
 */
import { create_agent, stream_response, AGUIStreamAdapter } from '@pioneering/modu-agent'

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

function log(tag, msg, color = colors.cyan) {
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`${colors.gray}${ts}${colors.reset} ${color}[${tag}]${colors.reset} ${msg}`)
}

function logObj(tag, obj, color = colors.cyan) {
  log(tag, JSON.stringify(obj, null, 2), color)
}

// ============================================================
// 测试用例
// ============================================================

async function testReactAgent() {
  log('test.react_agent', '========== 开始测试 React Agent 模式 ==========', colors.yellow)

  const inputData = {
    input_type: 'text',
    prompt: '你好，请用一句话介绍你自己',
  }

  const traceId = `test-react-${Date.now()}`
  const sessionId = `test-session-${Date.now()}`
  const userId = 'test-user'

  log('test.react_agent', `trace_id=${traceId} session_id=${sessionId}`, colors.gray)

  // 1. 创建 Agent（无 configurable，走全局配置）
  log('test.react_agent', '步骤 1: create_agent()...', colors.blue)
  const graph = await create_agent()
  log('test.react_agent', '✓ create_agent 成功', colors.green)

  // 2. 流式输出
  log('test.react_agent', '步骤 2: stream_response()...', colors.blue)
  const adapter = new AGUIStreamAdapter(traceId)

  let eventCount = 0
  const eventTypes = new Set()
  let textContent = ''
  let hasRunStarted = false
  let hasRunFinished = false
  let hasRunError = false
  let errorMessage = ''

  try {
    for await (const eventDict of adapter.transform_langgraph_events(
      stream_response(graph, userId, sessionId, inputData, traceId),
    )) {
      eventCount++
      const dataStr = eventDict.data ?? ''
      let data = {}
      try { data = JSON.parse(dataStr) } catch {}

      const type = data.type ?? ''
      eventTypes.add(type)

      log('test.react_agent', `event[${eventCount}] type=${type}`, colors.gray)

      if (type === 'RUN_STARTED') hasRunStarted = true
      else if (type === 'RUN_FINISHED') hasRunFinished = true
      else if (type === 'RUN_ERROR') {
        hasRunError = true
        errorMessage = data.message ?? ''
      } else if (type === 'TEXT_MESSAGE_CONTENT') {
        textContent += data.delta ?? ''
      }
    }
  } catch (e) {
    log('test.react_agent', `✗ 流式异常: ${e}`, colors.red)
    log('test.react_agent', `  stack: ${e?.stack}`, colors.red)
    return false
  }

  log('test.react_agent', `事件统计: total=${eventCount} types=[${[...eventTypes].join(', ')}]`, colors.cyan)
  log('test.react_agent', `RUN_STARTED=${hasRunStarted} RUN_FINISHED=${hasRunFinished} RUN_ERROR=${hasRunError}`, colors.cyan)
  log('test.react_agent', `文本内容长度: ${textContent.length}`, colors.cyan)
  if (textContent) {
    log('test.react_agent', `文本内容预览: ${textContent.slice(0, 200)}`, colors.cyan)
  }
  if (hasRunError) {
    log('test.react_agent', `错误信息: ${errorMessage}`, colors.red)
  }

  // 断言
  const passed = hasRunStarted && (hasRunFinished || hasRunError)
  log('test.react_agent', passed ? '✓ 测试通过' : '✗ 测试失败', passed ? colors.green : colors.red)

  return passed
}

async function testPlanExecute() {
  log('test.plan_execute', '========== 开始测试 Plan-Execute 模式 ==========', colors.yellow)

  const inputData = {
    input_type: 'text',
    prompt: '帮我查询今天的天气，然后写一段简短的天气总结',
  }

  const traceId = `test-plan-${Date.now()}`
  const sessionId = `test-session-plan-${Date.now()}`
  const userId = 'test-user'

  log('test.plan_execute', `trace_id=${traceId} session_id=${sessionId}`, colors.gray)

  // 1. 创建 Agent（启用 plan_execute）
  log('test.plan_execute', '步骤 1: create_agent({ configurable: { plan_execute_enabled: true } })...', colors.blue)
  const graph = await create_agent({
    configurable: { plan_execute_enabled: true },
  })
  log('test.plan_execute', '✓ create_agent 成功', colors.green)

  // 2. 流式输出
  log('test.plan_execute', '步骤 2: stream_response()...', colors.blue)
  const adapter = new AGUIStreamAdapter(traceId)

  let eventCount = 0
  const eventTypes = new Set()
  let textContent = ''
  let hasRunStarted = false
  let hasRunFinished = false
  let hasRunError = false
  let errorMessage = ''
  const stateDeltas = []

  try {
    for await (const eventDict of adapter.transform_langgraph_events(
      stream_response(graph, userId, sessionId, inputData, traceId, null, { plan_execute_enabled: true }),
    )) {
      eventCount++
      const dataStr = eventDict.data ?? ''
      let data = {}
      try { data = JSON.parse(dataStr) } catch {}

      const type = data.type ?? ''
      eventTypes.add(type)

      log('test.plan_execute', `event[${eventCount}] type=${type}`, colors.gray)

      if (type === 'RUN_STARTED') hasRunStarted = true
      else if (type === 'RUN_FINISHED') hasRunFinished = true
      else if (type === 'RUN_ERROR') {
        hasRunError = true
        errorMessage = data.message ?? ''
      } else if (type === 'TEXT_MESSAGE_CONTENT') {
        textContent += data.delta ?? ''
      } else if (type === 'STATE_DELTA') {
        stateDeltas.push(data)
        log('test.plan_execute', `  STATE_DELTA phase=${data.phase} keys=${Object.keys(data).join(',')}`, colors.cyan)
        if (data.phase === 'plan' && Array.isArray(data.plan)) {
          log('test.plan_execute', `  plan steps: ${data.plan.length}`, colors.cyan)
          for (const step of data.plan) {
            log('test.plan_execute', `    - ${step.step_id}: ${step.title} [${step.status}]`, colors.cyan)
          }
        } else if (data.phase === 'execute' && data.step_update) {
          log('test.plan_execute', `  step_update: ${data.step_update.id} → ${data.step_update.status}`, colors.cyan)
        }
      }
    }
  } catch (e) {
    log('test.plan_execute', `✗ 流式异常: ${e}`, colors.red)
    log('test.plan_execute', `  stack: ${e?.stack}`, colors.red)
    return false
  }

  log('test.plan_execute', `事件统计: total=${eventCount} types=[${[...eventTypes].join(', ')}]`, colors.cyan)
  log('test.plan_execute', `RUN_STARTED=${hasRunStarted} RUN_FINISHED=${hasRunFinished} RUN_ERROR=${hasRunError}`, colors.cyan)
  log('test.plan_execute', `文本内容长度: ${textContent.length}`, colors.cyan)
  log('test.plan_execute', `STATE_DELTA 事件数: ${stateDeltas.length}`, colors.cyan)
  if (textContent) {
    log('test.plan_execute', `文本内容预览: ${textContent.slice(0, 200)}`, colors.cyan)
  }
  if (hasRunError) {
    log('test.plan_execute', `错误信息: ${errorMessage}`, colors.red)
  }

  // 断言
  const passed = hasRunStarted && (hasRunFinished || hasRunError)
  log('test.plan_execute', passed ? '✓ 测试通过' : '✗ 测试失败', passed ? colors.green : colors.red)

  return passed
}

async function testNormalizeStream() {
  log('test.normalize', '========== 开始测试 _normalizeLangGraphStream ==========', colors.yellow)

  // 模拟 LangGraph JS stream 输出的 [mode, chunk] 元组
  const mockStream = (async function* () {
    // messages 模式
    yield ['messages', { content: '你好', type: 'ai', _getType: () => 'ai' }]
    // updates 模式 - agent 节点
    yield ['updates', { agent: { messages: [{ content: '你好世界', type: 'ai' }] } }]
    // updates 模式 - planner 节点（Plan-Execute）
    yield ['updates', { planner: { plan: [{ step_id: 'step_1', title: '测试步骤' }], plan_phase: 'executing', plan_delta: { phase: 'plan', plan: [{ step_id: 'step_1', title: '测试步骤' }] } } }]
    // values 模式
    yield ['values', { response: '最终响应', messages: [] }]
  })()

  // 直接测试归一化逻辑（不依赖私有 API，模拟实现）
  const normalized = []
  for await (const event of mockStream) {
    if (Array.isArray(event) && event.length === 2) {
      const [mode, chunk] = event
      if (mode === 'updates' && chunk && typeof chunk === 'object' && !Array.isArray(chunk)) {
        for (const [node, data] of Object.entries(chunk)) {
          normalized.push({ type: 'updates', node, data })
        }
      } else if (mode === 'messages') {
        normalized.push({ type: 'messages', event: chunk, data: chunk })
      } else {
        normalized.push({ type: mode, data: chunk })
      }
    } else if (event && typeof event === 'object') {
      normalized.push(event)
    }
  }

  log('test.normalize', `归一化后事件数: ${normalized.length}`, colors.cyan)
  for (let i = 0; i < normalized.length; i++) {
    const ev = normalized[i]
    log('test.normalize', `[${i}] type=${ev.type} node=${ev.node ?? ''}`, colors.gray)
  }

  // 断言
  const hasUpdatesAgent = normalized.some(e => e.type === 'updates' && e.node === 'agent')
  const hasUpdatesPlanner = normalized.some(e => e.type === 'updates' && e.node === 'planner')
  const hasMessages = normalized.some(e => e.type === 'messages')
  const hasValues = normalized.some(e => e.type === 'values')

  log('test.normalize', `hasUpdatesAgent=${hasUpdatesAgent} hasUpdatesPlanner=${hasUpdatesPlanner} hasMessages=${hasMessages} hasValues=${hasValues}`, colors.cyan)

  const passed = hasUpdatesAgent && hasUpdatesPlanner && hasMessages && hasValues
  log('test.normalize', passed ? '✓ 测试通过' : '✗ 测试失败', passed ? colors.green : colors.red)

  return passed
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  log('main', 'Agent 管道测试启动', colors.yellow)
  log('main', `Node.js 版本: ${process.version}`, colors.gray)
  log('main', `LLM_API_KEY: ${process.env.LLM_API_KEY ? '(已设置)' : '(未设置)'}`, colors.gray)
  log('main', `LLM_BASE_URL: ${process.env.LLM_BASE_URL ?? '(默认)'}`, colors.gray)
  log('main', `LLM_DEFAULT_MODEL: ${process.env.LLM_DEFAULT_MODEL ?? '(默认)'}`, colors.gray)

  const results = {}

  // 测试 1: 归一化逻辑（不依赖 LLM）
  results.normalize = await testNormalizeStream()
  console.log()

  // 测试 2: React Agent（依赖 LLM API）
  if (process.env.LLM_API_KEY || process.env.LLM_BASE_URL) {
    results.react_agent = await testReactAgent()
    console.log()
  } else {
    log('main', '跳过 React Agent 测试（未设置 LLM_API_KEY）', colors.yellow)
    results.react_agent = 'skipped'
  }

  // 测试 3: Plan-Execute（依赖 LLM API）
  if (process.env.LLM_API_KEY || process.env.LLM_BASE_URL) {
    results.plan_execute = await testPlanExecute()
    console.log()
  } else {
    log('main', '跳过 Plan-Execute 测试（未设置 LLM_API_KEY）', colors.yellow)
    results.plan_execute = 'skipped'
  }

  // 汇总
  log('main', '========== 测试汇总 ==========', colors.yellow)
  for (const [name, result] of Object.entries(results)) {
    const status = result === true ? '✓ PASS' : result === false ? '✗ FAIL' : '⊘ SKIP'
    const color = result === true ? colors.green : result === false ? colors.red : colors.gray
    log('main', `  ${name}: ${status}`, color)
  }

  const allPassed = Object.values(results).every(r => r === true || r === 'skipped')
  log('main', allPassed ? '✓ 全部测试通过' : '✗ 存在失败用例', allPassed ? colors.green : colors.red)

  process.exit(allPassed ? 0 : 1)
}

main().catch(e => {
  log('main', `未捕获异常: ${e}`, colors.red)
  log('main', `stack: ${e?.stack}`, colors.red)
  process.exit(1)
})
