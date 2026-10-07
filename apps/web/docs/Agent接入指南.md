# Agent 接入指南

> 面向：需要在 `apps/web` 中为**新模式**接入 Agent 能力，或为现有 pro / task 扩展能力的开发者。
> 关联：《三模式Agent能力分层实施方案》《模式能力矩阵》《@pioneering/agent-protocol README》。
>
> 前置原则：**chat（`/chat`）栈完全隔离**，不挂 HITL、不挂工具、不引 `@pioneering/*`。新模式接入前先确认其是否真的需要 Agent；若只是轻量对话，应复用 chat 栈而非新建 Agent 模式。

## 1. 接入总览（分层）

一次完整的 Agent 模式接入，自底向上经过四层：

```
L3 模式栈      新模式目录（页面 / 流式 hook / 输入组件 / 面板）
L2 协议层      @pioneering/agent-protocol（HITL 类型 + hitlStore + 卡片）
L1 传输层      lib/parseAguiStream + api/client + api/agent
服务端         apps/backend-ts（/agent/* 路由 + agent-bridge）
内核           @pioneering/modu-agent（LangGraph 图 + 工具 + 场景包）
```

## 2. 会话与端点

1. **创建会话要选对端点**（决策 D3）：
   - 非 Agent → `POST /chat/sessions`，不传 `agentMode`；
   - Agent → `POST /agent/sessions`，body 显式传 `agentMode`（`'react_agent'` / `'plan_execute'`）。
   - 在 `api/session.ts` 与 `store/conversationStore.ts` 中按 `mode` 选端点，维护 `MODE_TO_AGENT_MODE` 映射。
2. **列表读后端权威 `agentMode`**：`sessionToConversation` 优先从后端 `agentMode` 推导模式，localStorage 仅作 fallback，避免双源。

## 3. 流式对话 hook

参照 `modes/pro/hooks/useAgentChat.ts` 与 `modes/task/hooks/usePlanExecuteChat.ts`：

1. 用 `api/agent.ts` 的 `streamCompletion` 发起 `POST /agent/completions`，请求经 `parseAguiStream` 解析。
2. 维护消息累积（**不要每轮 `setMessages([userMsg])` 重置**）；`streamingMessageId` 在 `TEXT_MESSAGE_START` 记录、终态时 finalize。
3. `loadHistory`：进入会话时拉取历史并转换，`temp_` 前缀临时会话跳过。
4. 并发守卫：`status` 为 `streaming` / `pending` 时拒绝新发送。
5. 停止：`AbortController.abort()` + `POST /agent/completions/stop`，AbortSignal 全链透传到 LangGraph。

## 4. HITL（工具审批 / 澄清 / 选择）

1. 从 `@pioneering/agent-protocol` 引入 `useHitlStore`、`HitlInlineCard`。
2. 在 `parseAguiStream` 回调中：
   - `USER_QUESTION_REQUEST`（载荷 **snake_case**）→ 转 `HitlItem`（**camelCase**）入队；
   - `RUN_PAUSED` → 标记暂停态、保留 `streamingMessageId`，不 finalize；
   - `HITL_ABORTED` → 收尾并出队。
3. 输入组件在暂停态渲染 `HitlInlineCard`，并锁定常规发送。
4. 应答走 `POST /agent/resume`（`approved` / `feedback` / `modifiedArgs` / `answer` / `answerId`），**续写同一条** assistant 消息。
5. 刷新恢复：页面按会话调用 `hitlStore.recover(sessionId)`，处理「仍暂停 / 已超时 / 未就绪」三态。
6. `tool_confirm` 不可跳过；改参 JSON 非法时禁用批准。

## 5. 工具、附件与场景包

- **工具注册**：经 `agent-tool-registry` / modu-agent 注册表装配；高危工具（`code_executor` / `sql_query` / `file_ops_write`）显式审批，HITL 未开启时做 fail-closed 裁剪。
- **MCP 远程工具**：通过 `/mcp/servers` 与启停端点管理；连接后远程工具进入图工具集，审批策略写 `sensitive_tools`。
- **附件**：统一使用 `hooks/useAttachments` + `components/attachments/AttachmentBar`，以 Markdown 载荷（图片 `![name](url)`、文件 `[name](url)`）随消息发送。
- **场景包（领域能力）**：
  - 在 `packages/modu-agent/packs/<pack>/` 按 `pack.yaml` + `domains/*.md` + `guardrails/rules.yaml` + `sop/roles.yaml` 声明；
  - 在宿主 `config.yaml` 的 `scenario.packs` 中登记，启动时经 `activateConfiguredPacks` 装配；
  - `agent-bridge` 按模式把已注册域名注入 `configurable.domain`，由 PromptComposer 渲染领域层。

## 6. 可观测性

- 指标采集（请求量/耗时、工具调用、token 用量、迭代轮数）已在 modu-agent 仪表化。
- 通过 `GET /observability/settings` 查看、`PUT /observability/settings` 运行时切换；指标文本在 `GET /observability/metrics`（Prometheus exposition）。
- 外部 Prometheus 抓取该端点，Grafana 据此建看板；框架默认开关为 false，不强制开启。

## 7. 接入自检清单

- [ ] 会话端点与 `agentMode` 正确，列表模式推导不依赖 localStorage
- [ ] 流式消息累积正确，历史恢复与 `temp_` 会话行为对齐
- [ ] 停止经 AbortSignal 真正取消上游
- [ ] HITL 四条流程（批准 / 改参 / 澄清 / 选择）闭环，刷新可恢复
- [ ] 高危工具无绕过路径；附件、场景包、MCP 接线正确
- [ ] 新模式边界不污染 chat；新增单测 / 集成测试并跑通全量回归与 `tsc`
