/**
 * reasoning-sink —— agent 通道思维链（reasoning_content）采集
 *
 * 背景：DeepSeek「thinking 模式」在流式响应里以 `choices[0].delta.reasoning_content`
 * 返回模型真实思维链，但 `@langchain/openai` 的 delta→AIMessageChunk 转换只保留
 * content / tool_calls（见 node_modules/@langchain/openai/dist/chat_models.js
 * `_convertDeltaToMessageChunk`），reasoning_content 被静默丢弃 —— agent 通道
 * （pro / task）因此拿不到真实思考内容：前端「深度思考」面板只能显示 ReAct
 * 中间轮叙述，纯知识类提问（无工具调用）下思考段直接为空。
 *
 * 方案：在 LLM 出口的 fetch 层旁路嗅探 provider 的 SSE 流（llm-adapter 注入的
 * 自定义 fetch），把 reasoning_content 增量送回**当前 run**。
 * 「当前 run」由 AsyncLocalStorage 绑定，保证并发会话之间不串流；
 * 未挂载 sink 时（如非流式调用、其它宿主）零开销透传。
 */
import { AsyncLocalStorage } from 'node:async_hooks'

/** 思维链增量接收器（一次 run 一个） */
export type ReasoningDeltaSink = (delta: string) => void

const _als = new AsyncLocalStorage<ReasoningDeltaSink>()

/**
 * 在指定 sink 的上下文中执行 fn。
 *
 * 用法：把「创建图流 + 消费图流」整体包进来 —— 图内部发起的 LLM 请求
 * （进而触发的 fetch）才会看到该 sink。
 *
 * @param sink 增量子接收器；null / undefined 时等价于直接执行
 */
export function run_with_reasoning_sink<T>(
  sink: ReasoningDeltaSink | null | undefined,
  fn: () => T,
): T {
  if (!sink) return fn()
  return _als.run(sink, fn)
}

/** 当前异步上下文中的 sink（fetch 拦截器在请求入口捕获一次，避免依赖后续微任务继承） */
export function current_reasoning_sink(): ReasoningDeltaSink | null {
  return _als.getStore() ?? null
}

/** 上报思维链增量（无 sink 或空内容时 no-op） */
export function emit_reasoning_delta(delta: string): void {
  if (!delta) return
  const sink = _als.getStore()
  if (sink) sink(delta)
}
