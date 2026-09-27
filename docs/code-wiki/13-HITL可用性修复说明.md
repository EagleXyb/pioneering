# HITL 可用性修复说明

> 针对「输入框所支持的 HITL（Human-in-the-Loop）机制是否可用」的深度分析结论，
> 按 P0 / P1 / P2 优先级完成的修复记录。覆盖范围：`packages/modu-agent`（Agent 框架）、
> `apps/backend-ts`（云端后端）、`apps/desktop`（Electron 客户端）。
>
> 关联文档：`12-需求澄清HITL机制实施方案.md`（澄清机制设计方案，本次落地了其中的
> 确定性判定 + clarify 节点 + 协议激活部分，LLM 槽位缺失检测仍为后续增强）。

---

## 一、分析结论（修复前）

**输入框对 HITL 的支持仅停留在"视觉精简态"，澄清交互链路为零。**

- 设计文档 `apps/desktop/codewiki/HITL.md` 要求 `InputArea` 在 `mode="hitl"` 时渲染
  "提问卡"、切换 placeholder、提交时调 `hitlStore.resolve()`；实际只做了 UI 裁剪，
  没有任何澄清交互，提交仍走 `sendMessage`。
- 需要澄清用户需求的场景端到端不可用：后端 `USER_QUESTION_REQUEST` 的 `kind` 被硬编码为
  `'tool_confirm'`，`clarifying` / `choice` 无产生路径。
- 暂停期间输入框仍可编辑、可发送，会启动新 run，从而破坏 pause/resume 状态机。

---

## 二、问题清单（修复前）

### P0 — 状态机正确性

| # | 问题 | 位置（修复前） |
|---|------|----------------|
| P0-1 | 暂停态输入框仍可发送，`sendMessage` 无守卫，覆盖 `streamingMessageId` 且不清除暂停标记 | `ChatArea.tsx` / `chatStore.ts` `sendMessage` |
| P0-2 | `resumeHitl` 依赖全局布尔 `isHitlPaused` + `streamingMessageId`，不满足即**静默 return**；`hitlStore.resolve` 已把状态置为 `resolving`，导致弹窗消失、状态永久卡死、队列被吞 | `chatStore.ts:1034` / `hitlStore.ts:86-96` |
| P0-3 | `recover` 只 enqueue 弹窗，不同步 chatStore 暂停容器；暂停消息不落库 → 重连后点"批准"必然失败 | `hitlStore.ts:116-136` |
| P0-4 | 暂停项为全局单例、不按会话隔离；`resolve` 用 `currentSessionId` 而非 `item.sessionId` → 跨会话串线；`reset()` 定义了但全仓无调用 | `hitlStore.ts` / `chatStore.ts:537` |
| P0-5 | 多 interrupt 串行时 `resolving` 期间新项会覆盖 `currentItem`，随后 `dequeue` 在队列为空时清空 → 丢项 | `hitlStore.ts:66-84` |

### P1 — 澄清能力与后端契约

| # | 问题 | 位置（修复前） |
|---|------|----------------|
| P1-1 | `get_interrupt_state` 只读 `state.values`，而 LangGraph 暂停时中断载荷在 `tasks[].interrupts[].value` → `pending_tool_calls` 恒为空、无 `kind`，前端靠布尔值猜 kind | `runner.ts:1108-1149` / `hitlStore.ts:129` |
| P1-2 | 无澄清产生路径（无 clarify 节点、无明确度检测、无 `needs_clarification` 状态字段）；协议无 `answer/answer_id` | `nodes.ts` / `state.ts` / `agui-adapter.ts:1500` |
| P1-3 | checkpointer 默认 `memory` 单例：重启/多实例下暂停态丢失且无告警；超时无主动通知（靠轮询 `getState` 被动发现） | `factory.ts:153-162` / `runtime-config.ts:76` |

### P2 — UI 反馈与工程债

| # | 问题 |
|---|------|
| P2-1 | `Message.paused` 无任何渲染（用户看不到"等待确认"）；无队列指示器；`skip()` 是死代码（"取消"实为中止整轮 run）；resume 失败无可见错误 |
| P2-2 | 无任何 HITL 单测；`chatStore ↔ hitlStore` 循环依赖 |

---

## 三、修复内容

### P0-1 暂停态守卫

- `chatStore.sendMessage`：会话处于暂停态时直接拒绝并提示（`chatStore.ts` 守卫段），
  不再覆盖 `streamingMessageId`、不再与后端未收敛的 interrupt 并存。
- `chatStore.stopStreaming`：暂停态下改走 `hitlStore.dismiss()`（无展示项时回退
  `abortHitl`），语义等价于"取消该待确认操作"，不留悬空暂停态。
- `InputArea`：新增 `hitl` / `onHitlAnswer` / `onHitlSkip` 契约。
  - 工具审批（`tool_confirm`）→ 锁定输入（必须走弹窗 approve/reject/modified_args）；
  - 澄清/多选 → 提交内容**作为澄清回答回传**，不再发起新 run。

### P0-2 状态机收敛（`hitlStore` 重写）

- 队列变更唯一入口：`enqueue / dequeue / resolve / dismiss / skip`，chatStore 流回调只调 `dequeue()`。
- `resolve(input)` 改为对象式入参并**返回布尔结果**；`resumeHitl(sessionId, input)` 返回
  `{ ok } | { ok:false, reason }`，失败时回滚 `status='paused'` 并写入 `error`，由弹窗展示。
- 去重键（`sessionId|kind|runId|标识`）：实时事件 + 恢复查询重复入队只保留一项。
- `resolving` 期间新到暂停项一律入队，不再覆盖 `currentItem`。
- `reset()` 接线到 `chatStore.resetSessions()`（登出/切号清空暂停态）。

### P0-3 / P0-4 恢复链路与会话归属

- `isHitlPaused: boolean` → `hitlPausedSessionId` / `hitlPausedMessageId`，新增
  `selectIsHitlPaused` 选择器（按 `currentSessionId` 判定）。
- 新增 `chatStore.restoreHitlPause()`：按后端仍在等待的暂停项**重建 paused 容器**；
  `selectSession` 改为**先 `loadMessages` 再 `recover`**，避免重建容器被加载结果覆盖。
- 新增 `chatStore.finalizeHitlStale()`：超时/失效时追加说明、解除 paused、清空标记。
- `HitlHost` 增加会话过滤：只渲染属于当前会话的暂停项；`resolve` 前自动切回对应会话。

### P1-1 kind 透传（后端契约）

- `get_interrupt_state` 改为从 `state.tasks[].interrupts[].value` 读取**权威中断载荷**，
  并登记 `clarify` 节点；新增返回 `kind` / `message` / `question` / `options`。
- `human_review` 节点在 interrupt 载荷与状态中写入 `kind='tool_confirm'`、`approval_message`。
- 透传链路：`runner` → `agent-bridge.getPendingAgentState` → `routes/agent.ts` →
  `agent-runtime.getHitlState` → `@shared/types.HitlStateResponse`。

### P1-2 澄清产生路径与内联澄清条

后端（`packages/modu-agent`）：

- 新增 `assessClarificationNeed(state, cfg)`：确定性明确度判定
  （开关关闭 → 不澄清；达 `max_clarify_rounds` → 不再追问；输入 < `min_input_chars`；
  命中 `insufficient_patterns`），判定纯函数、可单测。
- 新增 `makeClarifyNode(config, llm)`：命中判定则
  `interrupt({ kind: 'clarifying'|'choice', question, options, ... })`；resume 后写入
  `clarification_answers`、`clarification_round + 1`，并把澄清结论注入 `messages`
  供下游 agent 基于"补充后的需求"继续执行。
- `buildModuGraph`：仅在 `perception.clarification.enabled=true` 时挂载 `clarify` 节点，
  并用闭包包装感知路由（只在节点已挂载时才返回 `clarify` 目标，避免路由到未注册节点）；
  clarify 完成后回到 `memory_query` 主链路；递归预算按澄清轮次动态增加。
- 配置新增 `perception.clarification`（默认 `enabled: false`，关闭时行为与现状等价）。
- 状态新增 `interrupt_kind / approval_message / needs_clarification /
  clarification_question / clarification_options / clarification_answers /
  clarification_round`（`ModuAgentState`、`HITLModeState`、Annotation、初始状态同步）。

协议与前端：

- `ResumeRequest` 新增 `answer` / `answer_id`，经 `agent-bridge` → `resume_stream` →
  节点 resume 载荷全链路透传。
- `InputArea` 新增**内联澄清条**：问题文本 + `1/N` 序号 + 跳过按钮（`.pro-input-hitl-*` 样式），
  placeholder 与发送按钮文案随 HITL 语义切换。
- `HitlClarifyDialog` / `HitlChoiceDialog` 新增"跳过"入口（`skip()`），
  回答以 `answer` / `answer_id` 回传，与工具审批的 `feedback` 语义解耦。

### P1-3 持久化边界与超时收敛

- `build_checkpointer`：启用 HITL/澄清且使用 `memory` checkpointer 时输出**显式告警**，
  说明暂停态仅存在于本进程、重启或多实例下 `GET /agent/state` 将返回 `pending=false`，
  并提示改用 `memory.checkpointer_type="sqlite"`。
- 前端暂停项展示期间**轮询 `getState`**（15s）：后端超时自动拒绝或暂停项失效时，
  自动关窗、收尾消息（追加"已失效/已超时"说明）并通过全局提示条告知用户。

> 说明：暂停发生时原 SSE 流已终结（`RUN_PAUSED` 为终态），不存在可推送的长连接，
> 因此"超时通知"以前端轮询实现等价效果；`HITL_ABORTED` 仍用于应答路径的收尾。

### P2 UI 反馈与测试

- `MessageBubble` 新增 HITL 暂停徽标（按 `pausedKind` 显示"等待你确认该操作 / 等待你补充信息 /
  等待你选择"）；`Message.pausedKind` 字段补齐。
- `HitlHost` 新增"还有 N 个待答复"队列指示器；三类弹窗均展示 resume 失败原因。
- 新增测试：
  - `packages/modu-agent/tests/graph/clarify-node.test.ts`（9 项）
  - `packages/modu-agent/tests/graph/hitl-interrupt-payload.test.ts`（1 项）
  - `apps/desktop/src/renderer/src/stores/__tests__/hitl.test.ts`（14 项）

---

## 四、验证结果

| 校验项 | 命令 | 结果 |
|--------|------|------|
| Agent 框架构建 | `cd packages/modu-agent && npm run build` | 通过（`dist` 已重建，主进程运行时同步生效） |
| Agent 框架测试 | `npx vitest run tests/graph tests/config tests/perception` | **345 passed**（含新增 10 项） |
| 客户端类型检查 | `cd apps/desktop && npm run typecheck` | 通过（node + web） |
| 客户端测试 | `cd apps/desktop && npx vitest run` | **94 passed**，新增 `hitl.test.ts` 14 项全绿 |
| 云端后端类型检查 | `cd apps/backend-ts && npx tsc --noEmit` | 仅剩 `routes/chat.ts` 中 `runtime` 字段的**既有**问题（Prisma Client 未重新生成，本次未触碰该文件） |

---

## 五、遗留项与已知限制

1. **checkpointer 默认值未改为 `sqlite`**：`@langchain/langgraph-checkpoint-sqlite` 与
   `better-sqlite3` 当前未安装，改默认只会静默回退 MemorySaver 并增加误导性告警；
   已改为"显式告警 + 配置指引"。生产环境启用 HITL 前请安装依赖并设置
   `memory.checkpointer_type: "sqlite"`。
2. **LLM 槽位缺失检测未实现**：`docs/code-wiki/12-...md` 提出的 `clarity_score` /
   `missing_slots` 需要额外 LLM 调用与槽位声明；`makeClarifyNode` 已保留 `use_llm` 开关与
   兜底文案，接入成本低。
3. **多会话并发暂停的边界**：暂停标记为单值（非按会话 Map）。极端情况下（会话 A 暂停期间
   在新会话再次触发暂停）A 的标记会被覆盖，此时点 A 的答复会得到**可见错误提示**（非静默失败），
   切回 A 重新发起即可。如需彻底支持需将 `hitlPausedSessionId` 改为按会话的映射结构。
4. **超时提示依赖轮询**：非服务端主动推送（原因见 P1-3 说明）。
5. **`match-accelerator.test.ts` 5 项失败**为平台相关的历史遗留问题，与本次改动无关。

---

## 六、相关文件索引

**Agent 框架（`packages/modu-agent`）**

- `src/graph/nodes.ts` — `assessClarificationNeed` / `makeClarifyNode` / human_review kind
- `src/graph/graph.ts` — clarify 节点挂载与感知路由分叉
- `src/graph/state.ts` — HITL/澄清状态字段
- `src/graph/runner.ts` — `get_interrupt_state` 中断载荷解析 + kind
- `src/graph/factory.ts` — memory checkpointer 能力边界告警
- `src/config/runtime-config.ts` — `perception.clarification` 配置块

**云端后端（`apps/backend-ts`）**

- `src/core/agent-bridge.ts` — `getPendingAgentState` 透传 kind/answer
- `src/routes/agent.ts` — `/agent/resume`、`/agent/state/:threadId`
- `src/schemas/agent.ts` — `answer` / `answer_id` 校验

**客户端（`apps/desktop`）**

- `src/renderer/src/stores/hitlStore.ts` — 状态机（重写）
- `src/renderer/src/stores/chatStore.ts` — `pauseStreamingMessage` / `resumeHitl` /
  `abortHitl` / `restoreHitlPause` / `finalizeHitlStale` / 暂停态守卫
- `src/renderer/src/components/hitl/*` — HitlHost（会话过滤 + 队列徽标）与三类弹窗
- `src/renderer/src/components/chat/input/InputArea.tsx` — 内联澄清条与提交语义切换
- `src/renderer/src/components/chat/MessageBubble.tsx` — 暂停徽标
- `src/main/agent-runtime.ts` — `getHitlState` kind 透传
- `src/shared/types.ts` — `HitlStateResponse` / `ResumeRequest` / `Message.pausedKind`
