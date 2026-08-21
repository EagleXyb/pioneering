# HITL 文件级落地清单（修正版）

> 配套文档见 `codewiki/HITL.md`。本清单基于对实际代码的逐条核实，修正了三处关键偏差：
> 1. 后端 `packages/modu-agent/src/graph/runner.ts` 已内置中断恢复/查询/超时机制，**P0 是"接线"而非"造轮子"**；
> 2. interrupt 时 LangGraph 流会**正常结束**（不是挂起保持 SSE），因此须在"流结束后检测中断→发 `RUN_PAUSED`→抑制 `RUN_FINISHED`/空消息持久化"；
> 3. `components/ui` 下**没有** `radio-group/input/label`，`HitlChoiceDialog` 需新增依赖与自建组件，不是"0 额外依赖"。
>
> 图1（澄清追问）与图2（多选确认）目前**只有前端目标、无后端节点支撑**（现有 HITL 仅是"工具审批"一种）。见阶段三。

---

## 阶段零：前置决策（先定后写）

- [ ] **D1 部署后端确认**：desktop 默认连 `http://127.0.0.1:8088`（`src/renderer/src/services/api/client.ts`），判定线上跑的是 `apps/backend-ts`（Fastify + `@pioneering/modu-agent`）。若实际是 python 后端 `apps/backend`，本清单全部改动点迁移到对应 python 层（协议同构）。**必做**。
- [ ] **D2 消息持久化策略**：约定"interrupt 的 run **不持久化**空/半截 assistant 消息；resume 的 run **落库为完整终态消息**；前端以 assistantMsgId 维持单一视觉消息，允许 DB 中"partial(丢弃) + final(保留)"结构"。避免跨消息 merge 的复杂度。
- [ ] **D3 事件集合收敛**：只定义最小 3 个新 AG-UI 事件，避免与多后端协议漂移：
  - `USER_QUESTION_REQUEST`（携带 `kind: 'tool_confirm' | 'clarifying' | 'choice'` + `session_id` + `tool_calls`/`question`/`options`）
  - `RUN_PAUSED`
  - `HITL_ABORTED`（超时/用户取消后追加一条，让前端收尾）
- [ ] **D4 开关：接受行为变更**：HITL 后端默认关（`tools.human_in_loop.enabled`），一期只在 agent 链路启用；普通 `/chat/completions` 不受影响。

---

## 阶段一：后端接线（P0，复用既有能力）

### 1.1 事件常量 `packages/modu-agent/src/orchestration/communication/agui-adapter.ts`
- 在 `AGUIEventType` 枚举新增：`USER_QUESTION_REQUEST`、`RUN_PAUSED`、`HITL_ABORTED`。
- 新增 payload 类型（与上传 `interrupt()` 载荷对齐）：`UserQuestionRequestPayload { kind; session_id; tool_calls?; question?; options? }`。
- `transform_langgraph_events` / `_process_langgraph_event`：
  - 在 `values` 分支增加 `__interrupt__` 探测；在 `for await` **结束处**判断本次 run 是否中断，命中则：
    - 读取 `get_interrupt_state(graph, sessionId)` 回填 payload；
    - `emit` `USER_QUESTION_REQUEST` → `RUN_PAUSED`；
    - **跳过** `RUN_FINISHED`、`flush_message_buffer`、`emit_text_end` 的"完成"语义（改为 paused 语义）。
  - 新增 `_process_interrupt_event(payload)` 辅助函数，保持与主循环解耦。

### 1.2 导出恢复原语 `packages/modu-agent/src/graph/runner.ts`
- 三处既有函数已存在，仅需确认对外导出与入参稳定，供 backend-ts 复用（**不新建**）：
  - `get_interrupt_state(graph, sessionId)`（L1092 附近）
  - `resume_response_streaming(...)`（L1030 附近，内部 `new Command({ resume })` 按 `thread_id=sessionId` 续跑）
  - `check_interrupt_timeout` / `cleanup_expired_interrupts`（L1140/L1253，超时治理）
- 如需单测，补 `packages/modu-agent` 对应测试文件覆盖"中断→恢复→继续输出"链路。

### 1.3 桥接层 `apps/backend-ts/src/core/agent-bridge.ts`
- `streamAgentCompletion`：
  - 末尾由"无条件完成"改为"**按是否中断分流**"：中断则不写空消息、不发 `RUN_FINISHED`。
- 新增 `streamAgentResume(graph, sessionId, userId, approvedPayload)`：包装 `resume_response_streaming`，产出与 `streamAgentCompletion` 一致的 AG-UI SSE。
- 新增 `getPendingAgentState(graph, sessionId, userId)`：包装 `get_interrupt_state`。

### 1.4 路由 `apps/backend-ts/src/routes/agent.ts`
> 均挂在现有 `/agent` 组下（已带 `authGuard`），只需补会话归属校验。
- [ ] `POST /agent/resume`：body `{ endUserId, sessionId, approvedTimestamp, jobStore, ... }`（对应 `Command(resume)` 载荷：`approved: boolean` / `feedback` / `modified_args`），**返回 SSE 流**（复用阶段一 1.3 的 resume 桥接）。
- [ ] `GET /agent/state/:threadId`：返回 `get_pending_interrupts` 结构化结果（前端重连/进页拉取待回答项）。
- [ ] `POST /agent/abort`：对 `threadId` 的中断执行超时/拒绝语义（落库 HITL_ABORTED 或按拒绝处理）。

### 1.5 安全
- 三个新端点显式校验 `threadId` 归属当前 `userId`（复用 `verifySessionOwner` 同类逻辑），防 IDOR。

---

## 阶段二：前端协议层与状态机（P1）

### 2.1 解析层 `apps/desktop/src/renderer/src/services/api/agui.ts`
- `AguiStreamCallbacks` 接口新增：
  - `onHumanInputRequest?(p: UserQuestionRequestPayload)`
  - `onRunPaused?(p?)`
  - `onHitlAborted?(p?)`
- `switch(event.type)` 为上述事件加 case（**未知类型目前静默忽略**，必须显式补，否则事件被吞）。
- 导出 `UserQuestionRequestPayload` 类型（可在 `@shared/types` 或本文件集中声明）。

### 2.2 服务 `apps/desktop/src/renderer/src/services/api/agent.ts`
- 新增：
  - `resumeStream(request, cb): AbortController` → 复用 `streamAgui` 指向 `/agent/resume`；
  - `abortHitl(threadId)` → `POST /agent/abort`；
  - `getHitlState(threadId)` → `GET /agent/state/:threadId`。
- （参照 `chat.ts` 的 `sendMessageStream`/`stopGeneration` 同款写法。）

### 2.3 流处理 `apps/desktop/src/renderer/src/services/stream-handler.ts`
- 返回对象新增 `onHumanInputRequest` / `onRunPaused` / `onHitlAborted` 处理：
  - `onRunPaused`：**不触发 onDone 完成语义**；把消息标记 paused、暴露"待答项"（回传给 chatStore）。
  - `onHumanInputRequest`：把暂停项入队 → 由 hitlStore 弹 UI。
  - idle 定时器：`onRunPaused` 时保持计时但语义改为"待用户答复"，不以 idle 失败收场；真正的超时以服务端 `check_interrupt_timeout` 为准。
  - 新增 `resume()` 续写容器的概念：第二次 SSE 依旧写入同 `assistantMsgId`（复用 `makeThinkingNodeId/makeTextNodeId` 等，避免开新节点）。

### 2.4 会话状态机 `apps/desktop/src/renderer/src/stores/chatStore.ts`
- 消息生命周期由 `streaming→done/error` 扩展为 `streaming→paused→resuming→done`：
  - `sendMessage` 的 onDone 分支**遇 paused 不 finalize**；
  - `stopGeneration` 覆盖 `/agent/completions/stop` 与新增 `/agent/abort` 两条路径。
- 调用 `sendMessageStream` 时透传 `threadId/runId`，供 resume 定位到同一条 assistant 消息。

### 2.5 独立状态 `apps/desktop/src/renderer/src/stores/hitlStore.ts`（新增，Zustand）
- 字段：`pendingQueue`、`currentItem`、`status: idle|paused|awaiting|resolving`。
- Actions：`enqueue(item)`、`resolve(approved/feedback/modified_args)`（触发 agent.resumeStream 并把流回灌到对应消息）、`dismiss()`、`skip()`、`recover(threadId)`（进页/重连调 getHitlState 补挂）。
- 与 chatStore 单向协作：hitlStore 只消费暂停项、回写"resume 后继续渲染到同消息"。

---

## 阶段三：UI（P2）—— 需先补依赖

### 3.1 前置依赖 `apps/desktop/package.json`
- 新增 `@radix-ui/react-radio-group`、`@radix-ui/react-label`。
- 自建 shadcn 风格组件（`components/ui/` 下新建，现无）：
  - `radio-group.tsx`、`radio-group-item.tsx`
  - `input.tsx`
  - `label.tsx`
  - `progress.tsx`（可选，用于澄清/超时进度提示）

### 3.2 挂载容器（建议放布局层，跨路由保持）
- `apps/desktop/src/renderer/src/App.tsx`：在 `RootLayout`（与 `ConfirmDialog` 同层、**Router 之外**）新增 `<HitlHost />`，确保设置/聊天页切换不卸载，暂停项不丢失。
- 若坚持用现有弹窗范式：参照 `confirmDialogAtom`（`stores/atoms.ts`）+ `ConfirmDialog` 的组合。

### 3.3 组件 `apps/desktop/src/renderer/src/components/hitl/`
- `HitlHost.tsx`：订阅 hitlStore，按 `currentItem.kind` 分发给下面两类弹窗；处理"超时/切页/关窗后重连恢复"。
- `HitlChoiceDialog.tsx`（图2 · 多选确认）：RadioGroup 单选或多选，选项来自 `options`，确认→`resolve()`；支持"修改参数"(可选 input 区)。
- `HitlClarifyDialog.tsx`（图1 · 澄清追问）：自由文本 input，发送→`resolve({ feedback })`。
- `HitlToolConfirmDialog.tsx`（一期主链路 · 工具审批）：展示待批准的工具调用（工具名+参数），`approve` / `reject` + 可带 `modified_args`。
- 空态/加载/错误与现有弹窗视觉一致（圆角5px、无阴影）。

### 3.4 输入区 `apps/desktop/src/renderer/src/components/chat/input/InputArea.tsx`
- 一期做 `mode="hitl"` 精简态：省略 ModelSelect、Agent badge、`/`命令、技能；`+` 仅附件；仅 `↑` 发送；**命中该态禁用草稿持久化**。
- 若引入"内联澄清条"，在 InputArea 上方渲染 HitlClarify 输入条，冲突判定见 3.3。

---

## 阶段四：灰度与收尾（P3）

- [ ] 灰度开关：
  - 后端：`tools.human_in_loop.enabled` + `sensitive_tools` 配置（默认关）。
  - 前端（可选）：`lib/feature-flags.ts` 增加 `hitlUserInput`。注意该文件当前注释明确"收敛、去掉用户可感知 flag"——若遵循收敛方向，可改为**后端配置驱动 + 前端按服务端 `state` 中是否出现暂停项自动升级 UI**，不加本地 flag。
- [ ] 边界处理：
  - 多次 interrupt 串行 resume；
  - 超时（服务端 `check_interrupt_timeout`）→ 前端收 HITL_ABORTED 完成收尾；
  - 关窗/刷新后重连：`getHitlState(threadId)` 恢复暂停项。
- [ ] 回归验证：普通 `/chat/completions`、非敏感工具、未开启 HITL 时行为零变化。

---

## 验证清单（每阶段完成对照）

- [ ] P0：触发敏感工具 → 前端收到 `USER_QUESTION_REQUEST`+`RUN_PAUSED`，**没有**空 assistant 消息落库、无 `RUN_FINISHED`。
- [ ] P0：`/agent/resume` 返回 SSE，resume 后继续输出工具结果与正文。
- [ ] P1：前端 paused 不 finalize；resume 事件渲染进**同一条** assistant 消息。
- [ ] P2：三类弹窗（工具审批/澄清/多选）在切换页面后仍挂起、答复后正确恢复。
- [ ] P3：超时自动拒绝；关窗重进恢复待回答项；默认（未启用）行为与现状一致。