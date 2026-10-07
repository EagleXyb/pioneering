# Agent 能力缺口清单（已归档）

> 依据：《三模式Agent能力分层实施方案》（v1.0，2026-10-06）。
> 记录当前（基线）能力缺口及对应的 W1–W5 任务编号，作为实施跟踪与回归核对依据。
>
> **归档说明（2026-10-07）**：W0–W5 全部 39 个任务已落地并通过测试，G1–G26 全部标记为 ✅。
> 其中 **D6 已于 2026-10-07 经项目负责人授权落地**（prisma/schema.prisma 所有权移交 TS 侧，见 schema 头部决策记录），
> G25 / T5.5（agent_runs 表 + 事件时间轴 + 执行轨迹回放）随之完成。
>
> 状态约定：⬜ 待处理 / ✅ 已完成 / 🔒 阻塞转 backlog。

## W1 — HITL 闭环（Pro + Task）

| # | 缺口 | 证据 | 对应任务 | 状态 |
|---|---|---|---|---|
| G1 | web 对 `/agent/resume`、`/agent/state`、`/agent/abort` 引用数为 0，用户无法批准敏感操作 | 全仓 grep | T1.3, T1.4 | ✅ |
| G2 | 无独立 HITL 卡组件（clarifying / choice / tool_confirm 均无渲染） | — | T1.1, T1.2 | ✅ |
| G3 | 暂停的半截 assistant 消息不落库，刷新即丢；resume 需续写同一条消息 | `routes/agent.ts` 持久化条件 `!ctx.paused` | T1.5 | ✅ |
| G4 | 进会话无 `recover` 检测，待答复项无法刷新恢复 | Pro 无 recover effect | T1.6 | ✅ |
| G5 | 无模式边界机械化断言（chat 被污染风险） | — | T1.7, T1.8 | ✅ |

## W2 — Agent 通道稳定性

| # | 缺口 | 证据 | 对应任务 | 状态 |
|---|---|---|---|---|
| G6 | checkpointer 为模块级内存单例（LRU 100），进程重启/多实例后暂停态丢失 | `graph/factory.ts`；`@langchain/langgraph-checkpoint-sqlite` 未声明 | T2.1, T2.2 | ✅ |
| G7 | 超期暂停态无 TTL 清理调度 | `sweepExpiredInterrupts` 存在但无调度器 | T2.2 | ✅ |
| G8 | AbortSignal 未透传上游，点「停止」后 LLM 仍在跑、token 仍扣 | `routes/agent.ts` signal 仅用于 break 写循环 | T2.3 | ✅ |
| G9 | 中止时半截内容仍落库，被当成完整回答 | 持久化条件未区分 abort | T2.4 | ✅ |
| G10 | Agent 通道无配额检查与用量记账（ReAct 多轮消耗远高于 chat） | `routes/agent.ts` 对 `checkQuota`/`recordUsage` 零引用 | T2.5 | ✅ |
| G11 | 每请求重建整张图，未走 `get_runner()` 缓存 | `core/agent-bridge.ts` | T2.6 | ✅ |

## W3 — 会话一致性

| # | 缺口 | 证据 | 对应任务 | 状态 |
|---|---|---|---|---|
| G12 | Pro 无历史恢复，每轮 `setMessages([userMsg])` 重置；模型记得、用户看不到 | `useAgentChat.ts` | T3.1, T3.2 | ✅ |
| G13 | `content_blocks` 仅反序列化 reasoning/sources，历史消息的 thinking / tool_call / tool_result 全部丢失 | `api/converter.ts` | T3.3 | ✅ |
| G14 | 会话创建一律走 `/chat/sessions`，`agent_mode` 永远 NULL；mode 仅存 localStorage | `conversationStore.ts` | T3.4, T3.5 | ✅ |
| G15 | Agent 请求体缺 `parentMessageId` / `model` / `systemPrompt` / `tools`，无 regenerate | `schemas/agent.ts` | T3.6 | ✅ |
| G16 | 历史注入固定 20 条（按条数而非 token 预算），长会话易爆 context | `routes/agent.ts` loadSessionHistory | T3.7 | ✅ |

## W4 — 工具与输入协议

| # | 缺口 | 证据 | 对应任务 | 状态 |
|---|---|---|---|---|
| G17 | 仅 4 个默认工具（datetime / search / calculator / doc_writer），高危工具未注册 | `graph/factory.ts` 注释 | T4.1 | ✅ |
| G18 | Agent 通道搜索结果落在普通工具结果里，无结构化来源、无来源面板 | tools/search.ts | T4.2, T4.3 | ✅ |
| G19 | 工具展示为 `JSON.stringify(...).slice(0,200)`，无参数表/结果折叠/耗时/状态 | `ProcessPanel.tsx` | T4.4, T4.5 | ✅ |
| G20 | 「+」菜单 5 大类 11 项全是 UI 壳，无请求字段、无接线 | `ProInputMoreMenu` / `TaskInputMoreMenu` | T4.6 | ✅ |

## W5 — 生态与差异化

| # | 缺口 | 证据 | 对应任务 | 状态 |
|---|---|---|---|---|
| G21 | MCP 默认关闭且无配置端点 | `mcp.enabled=false` | T5.1 | ✅ |
| G22 | 无 MCP 管理面板（desktop 也没有） | — | T5.2 | ✅ |
| G23 | Scenario Pack / Domain Adapter 全部未挂载 | `ScenarioHost` 完整但无 pack 激活 | T5.3 | ✅ |
| G24 | tracing / metrics / structured logging 默认全 false | `factory.ts` boot 走 no-op | T5.4 | ✅ |
| G25 | run 只存在于 SSE 帧、不落库，无法回放/分享/分叉 | D6 已授权，agent_runs 已建表 | T5.5 | ✅ |
| G26 | 能力矩阵与接入文档待收尾 | — | T5.6 | ✅ |
