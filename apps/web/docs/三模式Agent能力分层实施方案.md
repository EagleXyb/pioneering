# 三模式 Agent 能力分层实施方案

> **文档状态**：决策已拍板，待执行
> **适用范围**：`apps/web`（前端）、`apps/backend-ts`（后端）、`packages/modu-agent`（Agent 内核，仅少量改动）
> **基线commit**：`4ef2741feat(desktop): P1-P4 全量修复 (26项) + 170单测全绿`
> **关联分析**：本文档是《apps/web / apps/backend-ts / packages/modu-agent 深度分析》的落地实施方案

---

## 目录

- [0. 决策记录（ADR 摘要）](#0-决策记录adr-摘要)
- [1. 目标与模式边界](#1-目标与模式边界)
- [2. 架构调整](#2-架构调整)
- [3. 实施优先级总纲](#3-实施优先级总纲)
- [4. W0 — 边界固化与协议层](#4-w0--边界固化与协议层)
- [5. W1 — HITL 闭环（Pro + Task）](#5-w1--hitl-闭环pro--task)
- [6. W2 — Agent 通道稳定性](#6-w2--agent-通道稳定性)
- [7. W3 — 会话一致性](#7-w3--会话一致性)
- [8. W4 — 工具与输入协议](#8-w4--工具与输入协议)
- [9. W5 — 生态与差异化](#9-w5--生态与差异化)
- [10. 里程碑与停点](#10-里程碑与停点)
- [11. 风险登记册](#11-风险登记册)
- [12. 验收标准](#12-验收标准)
- [13. 资源与假设](#13-资源与假设)
- [附录 A — 能力矩阵（PR 审查基准）](#附录-a--能力矩阵pr-审查基准)
- [附录 B — 任务总表](#附录-b--任务总表)
- [附录 C — 关键文件清单](#附录-c--关键文件清单)

---

## 0. 决策记录（ADR 摘要）

以下 5 项决策已拍板，作为后续所有 PR 的审查基准。

| # | 决策点 | 结论 | 理由 |
|---|---|---|---|
| **D1** | Pro 模式执行过程展示形态 | **方案 A：保持右侧 `ProcessPanel` 并增强卡片**，不引入消息内时间线 | 豆包/元宝的思考过程也在独立区域；右侧面板可折叠、屏幕利用率更高。额外预留组件位，M4 后按实际使用数据决定是否立项做消息内时间线（+3~5 人日） |
| **D2** | Pro 模式是否加「深度思考」开关 | **不加**。UI 上明示「ReAct 推理过程」以区别于 chat 的「深度思考」 | 该开关控制不了 Agent 行为（chat 的 `deepThink` 只是换模型 `deepseek-v4-pro`），加了会误导用户 |
| **D3** | 三模式会话创建端点 | **方案 B**：chat → `/chat/sessions`；pro/task → 已存在的 `/agent/sessions` | `/agent/sessions` 本就为 Agent 会话准备（`schemas/agent.ts:7` 已含 `agentMode`），语义正确；前端按 `mode` 选端点约 3 行。两者**均为零 migration** |
| **D4** | `rag_agent` 死枚举 | **删除**，只留 `react_agent \| plan_execute` | `schemas/agent.ts:7` 允许写入但 `agent-bridge.ts:84-101` 无分支，实际仍跑 ReAct；三模式架构下更明确是死代码 |
| **D5** | 实施停点 | **M3（W0–W3）= 32.5 人日 ≈ 6–7 周** | 拿到「三模式边界清晰 + pro/task 能批准能恢复 + 会话一致」的可用状态；W4/W5 按季度节奏推进 |

### 范围冻结（D2边界）

|纳入 P0/P1 | 明确排除 |
|---|---|
| HITL（tool_confirm / clarifying / choice）、parser 扩展、resume/recover | `plan_confirm`（协议预留，后端无发射节点，`shared/types.ts:310`） |
| checkpointer 外置、abort 贯通、Agent 通道配额 | MCP 前端面板（推到 W5） |
| Pro 历史恢复、三模式会话类型落库 | `apps/backend`（Python，已冻结）任何改动 |
| 工具注册与结构化展示 | `apps/mobile`、`apps/desktop` 的UI 改动 |
| 来源面板复用 | chat 模式的任何 agent 化改造 |

### 待W5 前置决策

| # | 决策点 | 说明 |
|---|---|---|
| D6 | `prisma/schema.prisma` 所有权是否移交 TS 侧 | 文件第1-7 行写明「表结构由 Python 版 `init_db()` 创建维护，TS 侧绝不 migrate / db push」。**W0–W4 零 migration**（`chat_sessions.agent_mode`、`plan_steps` 列已存在），仅 T5.5（run 实体）受阻 |

---

## 1. 目标与模式边界

### 1.1 三模式职责

| | **对话模式** `/chat` | **分析模式** `/pro` | **任务模式** `/task` |
|---|---|---|---|
| **定位** | 轻量对话，**不引入 Agent** | ReAct Agent 分析 | Plan-and-Execute 任务 |
| **后端通道** | `/chat/completions` | `/agent/completions` | `/agent/completions` |
| **`agentMode`** | **不传** | `'react_agent'`（显式） | `'plan_execute'`（显式） |
| **modu-agent 图** | **不经过** | ReAct 默认拓扑 | + planner / step_dispatch / step_finalize |
| **LLM 通道** | `core/llm.ts` 直连 DeepSeek | modu-agent 内 LangGraph | 同 pro |
| **工具** | 无 | 4 → 8（高危需审批） | 同 pro |
| **推理展示** | 原生 `reasoning_content` | 右侧 `ProcessPanel` | `PlanPipelineTree` 时间轴 |
| **HITL** | ❌ **不适用** | ✅ tool_confirm / clarifying / choice | ✅ 同 pro + plan_confirm（预留） |
| **需求澄清** | ❌ | ✅ **重点**（分析需求最易模糊） | ✅ |
| **Plan 计划** | ❌ | ❌ **不需要** | ✅ + 落库 + 回放 |
| **Artifact / 来源** | ✅ 已有 `SourcesPanel` | 收敛后接入 | 收敛后接入 |
| **历史恢复** | ✅ 已有 | ❌ 待补 | ✅ 已有 |
| **配额 / 停止** | ✅ 已有 | ❌ 待补 | ❌ 待补 |

### 1.2 三条架构原则

**原则 1：chat 栈完全隔离。**
不挂 HITL、不挂工具、不挂 pipeline、不引任何 `@pioneering/*` 依赖。它是一条更轻更便宜的路。其「深度思考」是 DeepSeek 原生 `reasoning_content`，与 Agent 的多轮工具 ReAct 是**不同产品语义**，UI 文案必须区分。

**原则 2：共享协议层，不共享 UI 层。**
服务 desktop「单页 + 统一消息时间线」的 `stream-handler.ts` / `trace-builder.ts` **不移植**——web的 pro/task 各有独立面板（`ProcessPanel` / `PlanPipelineTree`），强行共享会把两套布局搅在一起。

**原则 3：HITL 只接两处（pro + task），chat 不参与。**

---

## 2. 架构调整

```
┌─────────────────────────────────────────────────────────────┐
│  L3 模式栈（互不共享，各自演进）│
│                                                              │
│  ChatStack ProStack              TaskStack        │
│  useAguiChat          useAgentChat          usePlanExecuteChat│
│  SourcesPanel         ProcessPanel          PlanPipelineTree │
│  （不引 agent 依赖）    HitlInlineCard        HitlInlineCard   │
└───────────────────────────┬─────────────────────────────────┘
                            │ 共享（且仅共享）
┌───────────────────────────▼─────────────────────────────────┐
│  L2 Agent 协议层  packages/agent-protocol（新建）            │
│    · HITL 类型（UserQuestionRequestPayload / ResumeRequest）  │
│    · hitlStore（队列 + 去重 + resolving + recover）           │
│    · hitl-bridge（切断循环依赖）                             │
│    · HitlInlineCard（Pro & Task 共用）                       │
│    · ToolCallCard / ThinkingBlock（Pro & Task 共用）         │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  L1 传输层（已存在，只扩展不替换）│
│    lib/parseAguiStream.ts  ← 三模式共用，含 95 单测基线       │
│    api/client.ts / api/plan.ts / api/message.ts              │
└─────────────────────────────────────────────────────────────┘
```

### 与「向 desktop 对齐」方案的关键差异

| 项 | 向 desktop 对齐 | **本方案（三模式分层）** |
|---|---|---|
| 策略分叉 | 纠结「保留三路由 vs 收敛单页」 | **无分叉**：三栈并行是产品定义 |
| 移植 `chatStore.ts`(65KB) | 关键路径，风险「高」 | **不移植**，风险消除 |
| 移植 `stream-handler.ts` / `trace-builder.ts` | 需要（20KB+） | **不需要** |
| 移植 `agui.ts` 替换 web parser | 建议 | **不替换**——扩展 web 现有 `parseAguiStream` |
| HITL 集成点 | 3 处（含 chat） | **2 处**（pro、task） |
| chat 模式工作量 | 1/3 集成 + 一致性改造 | **≈0.5 人日** |
| 搜索收敛风险 | 需改 chat 生产路径 | **chat 路径完全不动**，风险「高」→「低」 |

### L2 包内容清单

| 导出 | 来源 | 类型 |
|---|---|---|
| `HitlKind` / `HitlItem` / `HitlResolveInput` | desktop `shared/types.ts:309-341` 摘取 | 类型 |
| `UserQuestionRequestPayload` | desktop `shared/types.ts`（AG-UI 载荷，**snake_case**） | 类型 |
| `ResumeRequest` / `AbortRequest` / `HitlStateResponse` | desktop `shared/types.ts:336-377` | 类型 |
| `useHitlStore` / `bindHitlStore` / `getHitlStore` | desktop `stores/hitlStore.ts`(13KB) + `hitl-bridge.ts` | 移植（含 16 单测） |
| `HitlInlineCard` | 从 desktop `InputArea.tsx:309-470` 摘取 | 新组件 |
| `ToolCallCard` / `ThinkingBlock` | desktop `chat/ToolCallCard.tsx` / `ThinkingBlock.tsx` 参考实现 | 新组件 |

> **命名约定必须保留**：AG-UI 事件载荷是 **snake_case**（`session_id` / `tool_calls`），REST 请求体是 **camelCase**（`sessionId` / `modifiedArgs`）。

---

## 3. 实施优先级总纲

### 3.1 排序依据

| 准则 | 权重 | 说明 |
|---|---|---|
| **G1 模式边界纯度** | 30% | chat 栈不得被agent 能力污染；pro/task 不得互相渗透（pro 不该出现 plan） |
| **G2 用户可感知的能力断点** | 25% | 「能不能用」优先于「用得好不好」。HITL 缺失 = 无法批准任何敏感操作 = Agent 不能真正干活 |
| **G3 阻塞关系（前置依赖）** | 20% | 协议层抽取阻塞全部移植工作；parser 扩展阻塞 HITL 消费 |
| **G4 不可逆性 / 越晚做越贵** | 15% | 数据模型、schema 所有权、状态模型一旦定型再改是返工 |
| **G5 复用杠杆（port vs build）** | 10% | 可抄的部分；本版明确「不照搬 UI 层」，可抄范围已大幅缩小 |

### 3.2 分级总览

| Wave | 定位 | 准则命中 | 任务数 | 人日 | 日历周 |
|---|---|---|---|---|---|
| **W0** 边界固化与协议层 | 解阻塞 | G3·G4 | 6 | **5.0** | 1 |
| **W1** HITL 闭环（Pro+Task） | **能力分水岭** | G2·G3·G5 | 8 | **10.0** | 2 |
| **W2** Agent 通道稳定性 | 生产底线 | G4 | 6 | **7.0** | 1.5 |
| **W3** 会话一致性 | 补体验割裂 | G2·G4 | 7 | **10.5** | 2 |
| **W4** 工具与输入协议 | 从「能说」到「能做」 | G2·G1 | 6 | **10.5** | 2 |
| **W5** 生态与差异化 | 护城河 | G5 | 6 | **14.5** | 3 |
| **合计** | | | **39** | **57.5** | **~11** |

### 3.3 迭代建议（2 周/ Sprint）

| Sprint | 内容 | 人日 | Gate |
|---|---|---|---|
| **S1** | W0 全部 + W1 的 T1.1/T1.2（协议层 + HITL 卡组件） | 10.0 | 协议层建成、卡片组件就绪（可mock 预览） |
| **S2** | W1 剩余（Pro/Task 接入 + 暂存 + recover + 测试） | 8.0 | **M1：HITL 全链路通过，chat 确认未污染** |
| **S3** | W2 全部 | 7.0 | **M2：生产就绪** |
| **S4** | W3 全部 | 10.5 | **M3：会话一致（D5 停点）** |
| **S5** | W4 全部 | 10.5 | M4：能真正干活 |
| **S6** | W5 全部 | 14.5 | M5：生态 |

---

## 4. W0 — 边界固化与协议层（5.0 人日）

**目标**：把「三模式边界」从口头共识变成可审查的文档与代码结构，并建立 HITL 所需的协议层基础。
**Gate**：协议层建成、`parseAguiStream` 覆盖 19 类事件、HITL 卡可摘性结论产出。

### T0.1 决策固化与文档基线

| 项 | 内容 |
|---|---|
| **目标** | 把 D1–D5 决策、范围冻结、能力矩阵写入仓库，作为 PR 审查基准 |
| **依赖** | 无 |
| **估算** | 0.5 人日 |

**步骤**
1. 新建 `apps/web/docs/三模式Agent能力分层实施方案.md`（本文档）并提交
2. 在 `apps/web/docs/` 新增 `模式能力矩阵.md`，只放第 1.1 节的能力矩阵表 + 「PR 审查清单」小节
3. 在 `apps/web/docs/` 新增 `Agent能力缺口清单.md`，记录当前缺口与对应任务编号（W1–W5）
4. 在 `packages/modu-agent/AGENTS.md` 或 `apps/backend-ts/README` 补一句：web 三模式与 agentMode 的映射约定

**涉及文件**：`apps/web/docs/`（新增 2 个 md）

**验收标准**
- [ ] 能力矩阵表被 3 个以上文档引用
- [ ] PR 模板或 `docs/` 索引中可查到本方案
- [ ] 明确记录「chat 栈不引 agent 依赖」为硬约束

---

### T0.2 删除 `rag_agent` 死枚举

| 项 | 内容 |
|---|---|
| **目标** | 执行 D4 决策，清除死代码 |
| **依赖** | 无 |
| **估算** | 0.5 人日 |

**步骤**
1. `apps/backend-ts/src/schemas/agent.ts:7` — `CreateAgentSessionRequestSchema.agentMode` 的枚举改为 `['react_agent','plan_execute']`
2. 全仓检索 `'rag_agent'` / `ragAgent`，清除残留引用（注意 `apps/desktop` 可能也有定义，需同步）
3. 若 DB 中已有 `agent_mode='rag_agent'` 的历史数据，写一次性迁移脚本或降级映射为 `'react_agent'`
4. 补一条 schema 单测：非法 `agentMode` 被拒

**涉及文件**
- `apps/backend-ts/src/schemas/agent.ts:7`
- `apps/desktop/src/`（若有同步定义，需检索确认）

**验收标准**
- [ ] 全仓 `rg 'rag_agent'` 仅剩注释/文档提及
- [ ] `POST /agent/sessions` 传 `rag_agent` 返回 400
- [ ] 后端 schema 单测通过

---

### T0.3 建立 `packages/agent-protocol` 骨架与 HITL 类型

| 项 | 内容 |
|---|---|
| **目标** | 新建共享包，只放 HITL 相关**类型**（不抽整个 desktop `shared/types.ts`） |
| **依赖** | T0.1 |
| **估算** | 0.75 人日 |

**步骤**
1. 新建 `packages/agent-protocol/package.json`，`name: "@pioneering/agent-protocol"`, `type: module`
   - 根 `package.json` 的 `workspaces` 已含 `packages/*`，**无需修改根配置**
2. 参照 `packages/modu-agent/tsconfig.json` 建 `tsconfig.json` + `tsconfig.build.json`
3. 建 `src/index.ts` barrel
4. 从 `apps/desktop/src/shared/types.ts` **只摘取**以下类型（不要整文件搬）：
   - `HitlKind`（`'tool_confirm' | 'clarifying' | 'choice' | 'plan_confirm'`，L312）
   - `HitlArtifact`
   - `UserQuestionRequestPayload`（注意 snake_case）
   - `ResumeRequest` / `AbortRequest`（L336-377）
   - `HitlStateResponse`
5. 补 `HitlItem` / `HitlResolveInput` / `HitlItemInput`（以 desktop `hitlStore.ts:30-46` 为准）
6. desktop 与 web 各自改为从 `@pioneering/agent-protocol` 引用，删除本地重复定义
7. 在 `packages/agent-protocol/README.md` 记录命名约定（AG-UI snake_case vs REST camelCase）

**涉及文件**
- 新增：`packages/agent-protocol/{package.json,tsconfig.json,tsconfig.build.json,src/index.ts,README.md}`
- 改动：`apps/desktop/src/shared/types.ts`（摘除）、`apps/web/src/types/chat.ts`

**验收标准**
- [ ] `packages/agent-protocol` 可被web 与 desktop 同时import
- [ ] 全仓 `HitlKind` 只有一处定义
- [ ] desktop 177 单测不回归
- [ ] `npm run build` 两端零报错

---

### T0.4 移植 `hitlStore` + `hitl-bridge`

| 项 | 内容 |
|---|---|
| **目标** | 移植 desktop 已验证的 HITL 状态机（**16 个单测可直接复用**） |
| **依赖** | T0.3 |
| **估算** | 1.25 人日 |

**移植清单**

| 源文件 | 体积 | 处理 |
|---|---|---|
| `apps/desktop/src/renderer/src/stores/hitlStore.ts` | 13KB | **整体移植**，仅改 zustand import 路径 |
| `apps/desktop/src/renderer/src/stores/hitl-bridge.ts` | 小 | **整体移植**（用于切断 `chatStore ↔ hitlStore` 的 ESM 循环依赖，web 会踩同一个坑） |
| `apps/desktop/src/renderer/src/stores/__tests__/hitl.test.ts` | 16 it() | **整体移植**测试 |

**必须保留的设计要点**（移植时勿丢）
- `pendingQueue` 串行队列 + `itemKey()` 去重（`hitlStore.ts:71-77`）
- `resolving` 期间新项只排队不覆盖（`:141`）
- 15s 轮询 `HITL_STATE_POLL_MS` 检测超时（`:68`）
- `skip()` 对 `tool_confirm` 直接 `return false`（`:211`）
- `recover()` 三态处理：仍暂停 / 已超时 / 未就绪（`:215-283`）

**步骤**
1. 复制三个文件到 `packages/agent-protocol/src/`
2. 改 import：zustand 从 `packages/agent-protocol` 自身依赖
3. desktop 改为从包引用，删除原文件
4. 跑 desktop 测试确认 177 全绿
5. web 侧暂不接入（T1.3/T1.4 才接入），但确保可import

**涉及文件**
- 新增：`packages/agent-protocol/src/hitlStore.ts`、`src/hitl-bridge.ts`、`src/__tests__/hitl.test.ts`
- 改动：`apps/desktop/src/renderer/src/stores/hitlStore.ts`（改为 re-export 或删除）

**验收标准**
- [ ] `hitl.test.ts` 16 个用例在包内通过
- [ ] desktop `npm test` 177 全绿（不回归）
- [ ] web 可 `import { useHitlStore, bindHitlStore } from '@pioneering/agent-protocol'`
- [ ] `recover` 三态测试用例齐全（对照 desktop `hitl.test.ts`）

---

### T0.5 扩展 `parseAguiStream` 至 19 类事件

| 项 | 内容 |
|---|---|
| **目标** | 把 web 现有解析器扩到 AG-UI 全事件集，**不替换**（web 版本已在服务三模式且有测试） |
| **依赖** | 无（可与 T0.3/T0.4 并行） |
| **估算** | 1.5 人日 |

**当前状态**：`apps/web/src/lib/parseAguiStream.ts`（6.8KB）已处理 6 类事件 —— `RUN_STARTED` `RUN_FINISHED` `RUN_ERROR` `TEXT_MESSAGE_*` `THINKING_*` `TOOL_CALL_*` `STATE_DELTA` `WEB_SEARCH_SOURCES`

**新增 6 类**

| 事件 | 载荷关键字段 | 消费方 |
|---|---|---|
| `USER_QUESTION_REQUEST` | `kind`, `session_id`, `run_id?`, `message?`, `tool_calls?`, `question?`, `options?`, `artifacts?`（**snake_case**） | pro / task → hitlStore |
| `RUN_PAUSED` | `threadId`, `runId` | pro / task → 暂停态（**不 finalize**） |
| `HITL_ABORTED` | `threadId`, `runId`, `reason` | pro / task → 收尾 |
| `ARTIFACT_CREATED` | `artifactId`, `name`, `path`, `format`, `type`, `operation`, `summary`, `title` | W4 |
| `STATE_SNAPSHOT` | 任意 | 预留 |
| `MESSAGES_SNAPSHOT` | 任意 | 预留 |

**步骤**
1. 扩展 `AguiStreamHandlers` 接口，新增 6 个可选回调
2. 扩展 `dispatch()` 的 switch；**保持 `default` 分支前向兼容**（`:139-141` 已有）
3. `parseAguiStream` 返回值扩展 `terminal: boolean`（是否收到终态事件）
   - 终态集合：`RUN_FINISHED` / `RUN_ERROR` / `RUN_PAUSED` / `HITL_ABORTED`
   - 参照 desktop `agui.ts:126-131` 的 `TERMINAL_AGUI_EVENTS`
4. **新增 `AguiStreamEndReason`**：`'finished' | 'closed' | 'error-event' | 'aborted' | 'paused'`
5. 在 `RUN_ERROR` 后提前 return 的逻辑（`:172-179`）保持不变
6. 补契约测试：用真实 SSE 文本 fixture 覆盖 19 类事件

**涉及文件**：`apps/web/src/lib/parseAguiStream.ts`（8KB → 约 13KB）、`apps/web/src/lib/parseAguiStream.test.ts`（8KB）

**验收标准**
- [ ] 19 类事件各有 ≥2 条 fixture 测试
- [ ] 现有 8KB 测试全部不修改即通过
- [ ] `AguiStreamResult` 新增 `terminal` 字段且被 T1.3 使用
- [ ] 单测数 95 → ≥108

---

### T0.6 Spike：HITL 卡片段可摘性判定

| 项 | 内容 |
|---|---|
| **目标** | 在动手前判定 desktop `InputArea.tsx` 中 HITL 卡的可摘性，避免 T1.1/T1.2 返工 |
| **依赖** | T0.1 |
| **估算** | 0.5 人日 |
| **产出** | 一份「可摘 / 需重写」段落清单 |

**检查对象**

| 源位置 | 内容 | 关注点 |
|---|---|---|
| `desktop/.../input/InputArea.tsx:116-125` | `InputAreaHitlState` 接口 | 是否零外部依赖 |
| `desktop/.../input/InputArea.tsx:309-470` | `HitlToolConfirmPanel`（**文件内私有函数，未 export**） | 依赖了 InputArea 的哪些状态/样式 |
| `desktop/.../input/InputArea.tsx:1112-1235` | 三分支渲染逻辑 | 是否可抽成独立组件 props |
| `desktop/.../input/InputArea.tsx:184-197` | `PLAN_CONFIRM_HINT` / `PLAN_CONFIRM_FALLBACK_QUESTION` / `MOCK_PLAN_CONFIRM_*` | **plan_confirm 属排除范围**，这些常量本期不用，但要标注 |
| desktop CSS 类名 `pro-input-hitl-*` | 样式 | 是否在 web `pro.css` 中已有对应 |

**判定标准**

| 结论 | 判定条件 | 后续动作 |
|---|---|---|
| **完全可摘** | 私有组件无 InputArea 状态依赖，样式可独立迁移 | T1.1 + T1.2 按原样移植（2.5 人日） |
| **部分可摘** | 逻辑可摘但样式需重写（web 用 `pro.css` / `task.css` 独立样式体系） | T1.1 + T1.2 = 3.5 人日 |
| **需重写** | 深度耦合 autosize / scrolledAncestors 上下文 | T1.1 + T1.2 = 4.0 人日（**+60%**） |

**步骤**
1. 逐段阅读上述 4 处，列出对 `InputArea.tsx` 内部变量的依赖清单
2. 检查 `desktop` 与 `web` 的 CSS 变量/类名差异
3. 产出结论并更新 W1 的估算

**验收标准**
- [ ] 产出可摘性结论表（含依赖清单）
- [ ] 明确 T1.1+T1.2 的最终估算
- [ ] 若结论为「需重写」，立即上报调整 W1 排期

---

## 5. W1 — HITL 闭环（Pro + Task）（10.0 人日）

**目标**：让 pro 与 task 具备完整的「触发中断 → 渲染卡片 → 用户应答 → 续写 → 落库」闭环，以及刷新后恢复。
**为什么这是分水岭**：当前 `apps/web/src` 对 `/agent/(resume|state|abort)` 的引用数为 **0**。后端 4 个端点 + modu-agent 的 `USER_QUESTION_REQUEST`/`RUN_PAUSED` 全部就绪。用户无法批准任何敏感工具；`packages/modu-agent/config.yaml` 里已配好的中文澄清选项卡（「你想搞的是什么东西？」+ 网页 / 内容 / 分析文档 / AI Agent 演示 4 张卡）完全无人消费。
**Gate**：M1—— 两模式 HITL 全链路通过，**chat 确认未污染**。

### 为什么 pro 比 task 更需要 HITL

分析需求是三模式中最模糊的（"帮我分析一下竞品"），`config.yaml` 的 `insufficient_patterns`（`帮我弄一下` / `随便弄` / `你看着办` / `搞个东西`）命中率最高，clarify 触发最多。task 模式下用户已把需求拆成步骤，clarify 触发少、主要用 `tool_confirm`。

### T1.1 `HitlInlineCard` 骨架 + clarifying/choice 分支

| 项 | 内容 |
|---|---|
| **目标** | 建立独立 HITL 卡组件（**不改造任一现有输入框**），先做不需要改参的两类 |
| **依赖** | T0.3（类型）、T0.5（parser 事件）、T0.6（spike 结论） |
| **估算** | 1.0 人日 |

**组件 Props 设计**

```ts
export interface HitlInlineCardProps {
  kind: 'tool_confirm' | 'clarifying' | 'choice' | 'plan_confirm';
  question?: string;
  message?: string;
  options?: Array<{ id: string; label: string; description?: string }>;
  /** 队列序号：第index / total 个待答复项 */
  index?: number;
  total?: number;
  error?: string | null;
  busy?: boolean;                       // resolving 中，禁用交互
  onAnswer?: (text: string) => void;                // clarifying
  onSelectOption?: (optionId: string) => void;      // choice
  onSkip?: () => void;                              // X 跳过（tool_confirm 时不可用）
  onDismiss?: () => void;
}
```

**步骤**
1. 建 `packages/agent-protocol/src/components/HitlInlineCard.tsx`
2. 实现 `clarifying` 分支：HelpCircle 图标 + question + 文本输入 + 提交
3. 实现 `choice` 分支：编号候选选项列表（**点击即答**，提交 `optionId`）
4. 统一 Skip / X 中止按钮；`kind==='tool_confirm'` 时隐藏 Skip（对齐 `hitlStore.ts:211` 的约束）
5. 样式放 `packages/agent-protocol/src/components/HitlInlineCard.css`，用 CSS 变量以适配 web的 `pro.css` / `task.css`
6. 支持 `busy`（resolving）态：禁用所有交互并显示 loading
7. 支持队列提示：`index/total` 时显示「第 N / M 项」

**涉及文件**
- 新增：`packages/agent-protocol/src/components/HitlInlineCard.tsx` + `.css`

**验收标准**
- [ ] clarifying / choice 两类可独立渲染并交互
- [ ] `tool_confirm` 时不显示 Skip
- [ ] `busy=true` 时全部交互禁用
- [ ] 组件不 import 任何 web / desktop 私有模块

---

### T1.2 `tool_confirm` 分支（含改参 textarea）

| 项 | 内容 |
|---|---|
| **目标** | 实现工具审批卡，含工具列表折叠 + JSON 参数改参 |
| **依赖** | T1.1、T0.6 spike 结论 |
| **估算** | 1.5 人日 |

**步骤**
1. 按 spike 结论从 desktop `InputArea.tsx:309-470` 摘取 `HitlToolConfirmPanel` 逻辑（或按结论重写）
2. 工具列表：可折叠，每个工具显示 `name` + 参数摘要
3. 每个工具一个「修改参数」textarea（预填原 args 的 JSON）
4. 底部两个动作：
   - **拒绝并说明** → `onReject(feedback)`
   - **批准并继续** → `onApprove(modifiedArgs | null)`
     - 无改参时 `modifiedArgs = null`
     - 有改参时 `{ [tool_call_id]: { ...原始args, ...用户改动 } }`
5. JSON 校验：解析失败时在 textarea 下红字提示且禁用批准按钮
6. X 中止 → `onDismiss()`
7. 敏感工具视觉区分：可配 `sensitive?: boolean` 标记（如 `code_executor` / `sql_query`），用警示样式

**验收标准**
- [ ] 工具列表可折叠，参数格式化展示
- [ ] 改参后批准，`modifiedArgs` 结构符合 `ResumeRequest` 定义
- [ ] JSON 非法时禁用批准
- [ ] 无改参时 `modifiedArgs` 传 `null` 而非 `{}`
- [ ] 敏感工具有明显视觉区分

---

### T1.3 Pro 模式接入 HITL

| 项 | 内容 |
|---|---|
| **目标** | `useAgentChat` 消费 HITL 事件 → `hitlStore` → 渲染卡片 → resume |
| **依赖** | T0.4、T0.5、T1.1、T1.2 |
| **估算** | 2.0 人日 |

**现状**：`apps/web/src/modes/pro/hooks/useAgentChat.ts` 只处理 `THINKING_*` / `TOOL_CALL_*` / `TEXT_*` / `RUN_FINISHED` / `RUN_ERROR`（`:164-274`），**无任何 HITL 处理**。

**步骤**
1. `useAgentChat` 新增 `hitlPending` 派生状态（从 `useHitlStore`）
2. `parseAguiStream` 回调新增：
   - `onHumanInputRequest(payload)` → `useHitlStore.getState().enqueue(toHitlItem(payload))`
     - 注意载荷是 **snake_case**，需转成 camelCase 的 `HitlItem`
     - 参考 desktop `chatStore.ts:370toHitlItem`
   - `onRunPaused()` → **不 finalize**，保留 `streamingMessageId` 供后续续写
     - 对照 desktop `chatStore.ts:308 pauseStreamingMessage`
   - `onHitlAborted()` → 收尾 + `dequeue()`
3. `AnalysisInput.tsx` 接入 `HitlInlineCard`（当前该组件只渲染 textarea + 工具栏）
4. 实现 resume 流程：
   - `POST /agent/resume` body：`{ sessionId, approved, feedback?, modifiedArgs?, answer?, answerId? }`
   - SSE 消费复用同一 `parseAguiStream`
   - **续写同一条 assistant 消息**（T1.5 配合）
5. 实现「HITL 暂停时禁止发送新消息」守卫（对齐 desktop `chatStore.ts:725-731`）
6. `abort()` 扩展：HITL 暂停态下 `abort()` ≡ 取消待确认操作（调 `hitl.dismiss()` 或 `POST /agent/abort`）

**涉及文件**
- `apps/web/src/modes/pro/hooks/useAgentChat.ts`
- `apps/web/src/modes/pro/components/AnalysisInput.tsx`
- `apps/web/src/api/agent.ts`（**新建**，见 T1.4）
- `apps/web/src/modes/pro/ProMode.tsx`

**验收标准**
- [ ] 四条流程手工通过：工具批准→续写 / 改参批准 / 澄清回答 / 拒绝
- [ ] **澄清场景专项验收**：输入「帮我弄一下」类模糊输入，`config.yaml` 的中文问题与 4 张选项卡正确展示
- [ ] HITL 暂停时输入框被锁定，不能发送新消息
- [ ] **chat 模式确认未挂 HITL**（G1 准则）

---

### T1.4 Task 模式接入 HITL

| 项 | 内容 |
|---|---|
| **目标** | 同 T1.3，接入 `usePlanExecuteChat` |
| **依赖** | T1.3（复用卡片与 API 层）、T1.1、T1.2 |
| **估算** | 2.0 人日 |

**步骤**
1.新建 `apps/web/src/api/agent.ts`（若 T1.3 未建）：
   - `streamCompletion(body, handlers)` → `POST /agent/completions`
   - `streamResume(body, handlers)` → `POST /agent/resume`
   - `getHitlState(threadId)` → `GET /agent/state/:threadId`
   - `abortHitl(threadId, reason)` → `POST /agent/abort`
   - `stopGeneration(sessionId)` → `POST /agent/completions/stop`
   - 复用 `api/client.ts` 的 token 注入与 401 单飞刷新
2. `usePlanExecuteChat` 新增 HITL 处理（同 T1.3 步骤 2）
3. `TaskInput.tsx` 接入 `HitlInlineCard`
4. **plan 步骤状态与 HITL 状态互斥保护**：HITL 暂停时禁止用户手动 `toggleStep`，且 plan store 的 `phase` 不得推进
5. 澄清/选择完成后，若phase 仍是 `planning`/`executing`，需正确恢复

**涉及文件**
- `apps/web/src/api/agent.ts`（**新建**）
- `apps/web/src/modes/task/hooks/usePlanExecuteChat.ts`
- `apps/web/src/modes/task/components/TaskInput.tsx`
- `apps/web/src/store/planExecuteStore.ts`（加互斥保护）

**验收标准**
- [ ] T1.3 的四条流程在 task 模式同样通过
- [ ] **plan_confirm 不出现**（D2 排除范围，类型保留但无UI）
- [ ] HITL 暂停期间 plan 步骤不可交互
- [ ] 澄清后 plan 执行能正常继续
- [ ] `chat.ts`（对话模式）文件**零改动**

---

### T1.5 暂停期部分消息暂存与续写

| 项 | 内容 |
|---|---|
| **目标** | 解决「暂停时不落库 → 刷新即丢内容」 |
| **依赖** | T1.3、T1.4 |
| **估算** | 1.5 人日 |

**问题**：`apps/backend-ts/src/routes/agent.ts:418` 的持久化条件是 `if (!streamError && !ctx.paused)`；`:431-435` 在 `ctx.paused` 时跳过落库（log `skip_persist.run_paused`）。因此暂停期间已生成的文本**只存在于前端内存**。

**步骤**
1. Pro 与 Task 的 hook 各引入 `streamingMessageId` 概念（当前 web 没有）：
   - `TEXT_MESSAGE_START` 时记录
   - `RUN_PAUSED` 时**保留**（不 finalize）
   - `RUN_FINISHED` / `RUN_ERROR` / `HITL_ABORTED` 时 finalize
   - 参考 desktop `chatStore.ts:284 finalizeStreamingMessage` / `:308 pauseStreamingMessage`
2. 提供 `restoreHitlPause({ sessionId, assistantMsgId, partialContent })` 供 T1.6 刷新恢复调用
   - 参考 desktop `chatStore.ts:69RestoreHitlPauseInput`
3. resume 时**续写同一条** assistant 消息（不是新增一条）
4. 补单测：暂停 → 刷新 → 恢复 → resume 后消息条数不变

**涉及文件**
- `apps/web/src/modes/pro/hooks/useAgentChat.ts`
- `apps/web/src/modes/task/hooks/usePlanExecuteChat.ts`

**验收标准**
- [ ] 暂停后刷新页面，已生成文本不丢
- [ ] resume 后**续写同一条** assistant 消息（消息列表条数不变）
- [ ] 单测覆盖「暂停→恢复→续写」全序列

---

### T1.6 刷新恢复（`recover`）接线

| 项 | 内容 |
|---|---|
| **目标** | 进入会话时检测并恢复待答复项 |
| **依赖** | T1.3、T1.4、T1.5 |
| **估算** | 1.0 人日 |

**步骤**
1. 会话切换时（`ProMode` / `TaskMode` 的 `useEffect([activeId])`）调用 `useHitlStore.getState().recover(sessionId)`
   - Pro 当前**完全没有**这个 effect；Task 有 `loadHistory`（`usePlanExecuteChat.ts:294-329`），在其后追加 recover 调用
2. `recover` 内部（已在 `hitlStore.ts:215-283` 实现，web 侧只需传 transport）：
   - `GET /agent/state/:threadId`
   - `!pending || expired` → `finalizeHitlStale()` + 清该会话残留队列项
   - `pending` → 归一化 `pending_tool_calls`，推断 `kind`（`st.kind ?? (toolCalls.length || tool_requires_approval ? 'tool_confirm' : 'clarifying')`，`hitlStore.ts:257-258`）
   - 调 `restoreHitlPause(...)` 重建可续写的占位消息（**因为暂停的半截消息不落库**）
   - `enqueue({ ..., origin: 'recover' })`
3. 后端 `getPendingAgentState`（`agent-bridge.ts:231-259`）返回结构已就绪，注意 IDOR 防护字段 `user_id`
4. 处理超时：`config.yaml` `approval_timeout_seconds: 300`；后端 `checkInterruptTimeout`（`runner.ts:1300`）会返回 `expired`

**涉及文件**
- `apps/web/src/modes/pro/ProMode.tsx`（新增 recover effect）
- `apps/web/src/modes/task/TaskMode.tsx`
- `apps/web/src/api/agent.ts`

**验收标准**
- [ ] 暂停后刷新页面，待答复卡片正确恢复
- [ ] **recover 三态测试通过**：仍暂停 / 已超时 / 未就绪（直接移植 desktop `hitl.test.ts` 的 3 个用例）
- [ ] `expired` 时不显示卡片，且清理残留队列项

---

### T1.7 契约与回归测试

| 项 | 内容 |
|---|---|
| **依赖** | T1.1–T1.6 |
| **估算** | 0.5 人日 |

**步骤**
1. 移植 desktop `hitl.test.ts` 的 16 个用例到 `packages/agent-protocol`（若 T0.4 已做则跳过）
2. 为 `useAgentChat` / `usePlanExecuteChat` 各补 HITL 序列测试（mock SSE 流）
3. 跑全量回归

**验收标准**
- [ ] web 单测 108 → **≥120**
- [ ] 全部测试通过
- [ ] `npm run build` 零报错

---

### T1.8 模式边界验收

| 项 | 内容 |
|---|---|
| **目标** | 机械化验证 G1 准则（chat 未被污染） |
| **依赖** | T1.1–T1.7 |
| **估算** | 0.5 人日 |

**步骤**
1. 新增边界断言测试：
   - `ChatInput.tsx` / `useAguiChat.ts` 不 import 任何 `@pioneering/*` 或 HITL 相关模块
   - `useAguiChat.ts` 不请求 `/agent/*`
   - `useAgentChat.ts` 不处理 plan 相关字段
   - `ProMode.tsx` 不出现 `planExecuteStore`
2. 手工验收三模式 × 6 场景矩阵
3. 把断言写进 `apps/web/docs/模式能力矩阵.md` 作为回归清单

**验收标准**
- [ ] 自动化断言覆盖附录 A 的「模式边界验收」表全部行
- [ ] 三模式 × 6 场景手工用例全绿
- [ ] **chat 模式确认零改动**

---

## 6. W2 — Agent 通道稳定性（7.0 人日）

**范围**：仅 `/agent/*`。**chat 通道已有配额与联动停止，不动。**
**Gate**：M2 —— 生产就绪。

### T2.1 引入 sqlite checkpointer 依赖与配置开关

| 项 | 内容 |
|---|---|
| **目标** | 把会话状态从进程内存外置 |
| **依赖** | 无|
| **估算** | 1.0 人日 |

**现状**：`packages/modu-agent/src/graph/factory.ts:202-209` 使用模块级单例 `BoundedMemorySaver`（LRU，默认 100 线程）。`:211-223` 有明确 warning：进程重启 / 多实例部署后 HITL 暂停态丢失，`GET /agent/state` 返回 `pending=false`。`'sqlite'` 分支（`:178-192`）已实现，但 `@langchain/langgraph-checkpoint-sqlite` **未在 package.json 声明**。

**步骤**
1. 在 `packages/modu-agent/package.json` 的 `optionalDependencies` 加 `@langchain/langgraph-checkpoint-sqlite`
2. 验证 darwin(arm64) 可安装可加载
3. `packages/modu-agent/config.yaml` 设 `memory.checkpointer_type: sqlite`
4. **保留 memory 回退开关**（配置项可切回`memory`，便于对比与应急）
5. `BoundedMemorySaver` 的 LRU 上限（`memory.checkpointer_max_threads`）在 sqlite 模式下不再生效，需在文档说明

**验收标准**
- [ ] `sqlite` 模式可正常加载
- [ ] 回退开关可用（切回 `memory` 无异常）
- [ ] 配置项写入 `config.yaml` 且有注释说明

---

### T2.2 外置验证 + TTL 清理调度

| 项 | 内容 |
|---|---|
| **目标** | 验证重启可恢复，并解决长时间暂停态占用 |
| **依赖** | T2.1 |
| **估算** | 1.0 人日 |

**背景**：`config.yaml` `approval_timeout_seconds: 300`，暂停态会占用 thread；内存 LRU 上限 100，高并发下会互相挤掉。

**步骤**
1. 重启验证：`kill -9` backend-ts → 重启 → `GET /agent/state/:threadId` 应返回 `pending:true`
2. 加 TTL 清理调度：调用 `sweepExpiredInterrupts`（`runner.ts:1444`）+ `checkInterruptTimeout`（`:1300`）
   - 建议 60s 间隔的定时器，在 `agent-bridge.ts` 或新 `core/agent-scheduler.ts`
3. 加 `expired` 事件的观测日志
4. **引入 e2e 能力**：当前 web/desktop 均为纯单测，**无 e2e 框架**。需支持「kill -9 进程后断言 pending 恢复」
   - 轻量方案：Node 脚本 + `child_process` 编排，无需引入 Playwright
   - 验收脚本纳入 `apps/backend-ts/test/`

**验收标准**
- [ ] **kill -9 重启后 `pending:true`**（当前必然 false）
- [ ] TTL 清理任务生效，超期暂停态被清
- [ ] e2e 验收脚本可重复执行且通过

---

### T2.3 AbortSignal 全链贯通

| 项 | 内容 |
|---|---|
| **目标** | 让「停止」真正取消上游 LLM 请求 |
| **依赖** | 无 |
| **估算** | 1.5 人日 |

**现状**：`apps/backend-ts/src/routes/agent.ts:390-393` 检测 `stopController.signal.aborted` 后 `break` 出写循环，但该 signal **从未传给** `streamAgentCompletion` / `stream_response`。LLM 仍在跑、token 仍扣。对照 `/chat/completions/stop`（`chat.ts:800`）是真正中止上游 HTTP。

**步骤**
1. `StreamAgentCompletionOptions` 增加 `signal?: AbortSignal`（`core/agent-bridge.ts:57-67`）
2. `streamAgentCompletion` 透传给 `stream_response` 的 `extraConfigurable`或新参数
3. `runner.ts` 的 `stream_response` / `run_sync` 增加 `signal` 支持，透传给 `graph.stream(initialState, { ..., signal })`
4. `routes/agent.ts:379` 传入 `stopController.signal`
5. 同样处理 `/agent/resume`（`agent.ts:531-540`）
6. `routes/agent.ts:20` 已导入 `checkInterruptTimeout`；`/agent/abort` 路径保持不变
7. **前端联动**：当前 pro/task 的 `abort()` 只 `AbortController.abort()`（`useAgentChat.ts:316-318`、`usePlanExecuteChat.ts:268-271`），需补调 `POST /agent/completions/stop`

**涉及文件**
- `apps/backend-ts/src/core/agent-bridge.ts`
- `apps/backend-ts/src/routes/agent.ts`
- `packages/modu-agent/src/graph/runner.ts`
- `apps/web/src/api/agent.ts`、`apps/web/src/modes/*/hooks/*.ts`

**验收标准**
- [ ] 点「停止」后 LLM 上游日志验证**请求真正取消**（token 不再增长）
- [ ] `stream_response` 中断时正常清理，不留悬挂 coroutine
- [ ] 前端停止后 `chat_messages` **无半截 assistant 记录**

---

### T2.4 中止语义与不落库

| 项 | 内容 |
|---|---|
| **目标** | 区分中止原因，避免半截内容被当完整回答 |
| **依赖** | T2.3 |
| **估算** | 1.0 人日 |

**现状**：`agent.ts:418` 条件为 `!streamError && !ctx.paused` → 中止时两者皆false **仍会落库**。

**步骤**
1. `StreamContext`（`agent-bridge.ts:29-55`）增加 `abortReason?: 'user_cancel' \| 'timeout' \| 'reject'`
2. 持久化条件改为：`!streamError && !ctx.paused && !ctx.abortReason`
3. 复用 `schemas/agent.ts:135` `AgentAbortRequestSchema` 已有的 `reason` 枚举（`user_cancel` / `timeout` / `reject`）
4. 前端区分展示：用户主动停止不算错误（对照 desktop `chatStore.ts:1082-1088` 把 `running|pending → completed`）
5. 「已中止」在消息尾部追加标记（对照 desktop `buildHitlAbortedPatch`）

**验收标准**
- [ ] 用户停止后 `chat_messages` 无该 assistant 记录
- [ ] 拒绝工具（`reject`）与用户取消（`user_cancel`）在日志与前端反馈上可区分
- [ ] 超时自动拒绝走 `timeout` 语义

---

### T2.5 Agent 通道配额与用量

| 项 | 内容 |
|---|---|
| **目标** | 给Agent 通道加闸门 |
| **依赖** | 无 |
| **估算** | 1.5 人日 |

**现状**：`apps/backend-ts/src/routes/chat.ts` 有 `checkQuota`（`:525`）与 `recordUsage`（`:560`），写 `token_usage` 表 + 扣 `user_quota`。**`routes/agent.ts` 全文件 0 引用**（已 grep 确认）。而 ReAct 多轮消耗远高于单轮 chat。

**步骤**
1. 把 `checkQuota` / `recordUsage` 抽到 `src/core/quota.ts`（chat 与 agent 共用）
2. `routes/agent.ts` 的 `/agent/completions` 与 `/agent/resume` 入口加配额检查
3. 从 `RUN_FINISHED` 事件的 `usage` 或 `ctx.promptTokens/completionTokens` 取用量
4. 写入 `token_usage` + 更新 `user_quota`（`dailyLimit` / `dailyUsed` / `resetAt`）
5. `RUN_FINISHED` 之后、`reply.raw.end()` 之前完成记账
6. 参考 desktop `main/ipc-handlers.ts` 的 `localRuntimeSection` 对 `ipc-handlers` 的 token 口径（若 desktop 有本地记账，需对齐两侧口径）

**验收标准**
- [ ] Agent 用量写入 `token_usage` 表
- [ ] `user_quota` 正确扣减
- [ ] 超限返回 429 + `resetAt`
- [ ] `checkQuota` / `recordUsage` 只有一处实现

---

### T2.6 图缓存切换

| 项 | 内容 |
|---|---|
| **目标** | 消除「每请求重建整张图」的开销 |
| **依赖** | 无 |
| **估算** | 1.0 人日 |

**现状**：`core/agent-bridge.ts:99-101` 每次请求调`create_agent()`，**绕过**了 `runner.ts:682get_runner()` 的缓存机制（`:86-114` 有完整的 `_GRAPH_REBUILD_PREFIXES` 硬失效 + `_LLM_PARAM_ONLY_KEYS` 软失效 + 100ms 去抖）。`routes/agent.ts:20` 已导入 `get_runner`，但只用在 `/agent/state` 与 `/agent/abort`。

**步骤**
1. `streamAgentCompletion`（`agent-bridge.ts:99-101`）改用 `get_runner()`
2. `/agent/resume`（`agent.ts:531-540`）同步改用 `get_runner()`
3. **验证 `plan_execute_enabled` 在缓存下仍生效**：
   - 该标志影响**图拓扑**（`factory.ts:1009-1020`）
   - `get_runner` 的软失效机制（`_LLM_PARAM_ONLY_KEYS`）需确认是否会误命中
   - 若命中不足，需把 `plan_execute_enabled` 加入 `_GRAPH_REBUILD_PREFIXES` 或提供显式缓存 key
4. 基准测试：P95 首token 延迟前后各 200 次

**验收标准**
- [ ] P95 首 token 延迟有可量化下降
- [ ] **`plan_execute` 拓扑切换专项回归通过**（切回 `react_agent` 也要验证）
- [ ] desktop 与web 行为一致

---

## 7. W3 — 会话一致性（10.5 人日）

**目标**：消除三模式之间的会话行为割裂。
**Gate**：M3 —— 会话一致（D5 停点）。

### T3.1 Pro 补历史恢复

| 项 | 内容 |
|---|---|
| **目标** | 消除「模型记得、用户看不到」的割裂 |
| **依赖** | W1 完成 |
| **估算** | 1.0 人日 |

**问题**：`useAgentChat.ts:114` 每次发送 `setMessages([userMsg])` 重置整个消息数组；而后端 `routes/agent.ts:336` **每轮都调用** `loadSessionHistory`（最近 20 条）注入 modu-agent。模型看得到上文，用户界面却清空重来。

**步骤**
1. 参照 `usePlanExecuteChat.ts:294-329` 的 `loadHistory` 实现，在 `useAgentChat` 中新增同名能力
2. `ProMode.tsx` 新增 `useEffect([activeId])` 调用 `loadHistory`
3. **删除** `setMessages([userMsg])`，改为累加
4. `sendMessage` 的并发守卫对齐 task 版（`status === 'streaming' || status === 'pending'` 时拒绝）

**涉及文件**：`apps/web/src/modes/pro/hooks/useAgentChat.ts`、`apps/web/src/modes/pro/ProMode.tsx`

**验收标准**
- [ ] 分析模式第二轮回显上文
- [ ] 连续 3 轮对话上下文正确
- [ ] `temp_` 前缀临时会话跳过 loadHistory（对齐 task 版逻辑）

---

### T3.2 Task / Chat 历史统一核对

| 项 | 内容 |
|---|---|
| **目标** | 确认三模式历史恢复行为一致，避免 T3.1 引入不对称 |
| **依赖** | T3.1 |
| **估算** | 0.5 人日 |

**步骤**
1. 核对 `usePlanExecuteChat.loadHistory` 与新建的 pro 版差异（前者多一步 plan快照恢复）
2. 核对 `useAguiChat`（chat 模式）的历史加载路径
3. 抽掉三处重复的「取历史 → convertMessages → setMessages」样板（若差异确实很小）
   - **遵守 Rule of Three**：确认是第2 处真实重复才抽，否则保留
4. 确认 chat 模式不受影响

**验收标准**
- [ ] 三模式历史恢复行为一致（除 plan 快照这一 task 独有步骤）
- [ ] chat 模式零回归

---

### T3.3 `contentBlocks` 反序列化

| 项 | 内容 |
|---|---|
| **目标** | 让历史消息的推理过程与工具调用可见 |
| **依赖** | T0.5（事件结构）、T1.1/T1.2（块结构） |
| **估算** | 2.0 人日 |

**问题**：`routes/agent.ts:149` 已把 thinking / tool_call / tool_result 块写入 `chat_messages.content_blocks`，但 `apps/web/src/api/converter.ts` **只会还原 reasoning 和 sources**。历史消息里推理过程与工具调用**全部丢失**，只剩 markdown。

**步骤**
1. 盘点后端实际写入的 `contentBlocks` 块类型（对照 `agent-bridge.ts` 的 `collectMetadataFromEvent:270-366`）
2. 在 `converter.ts` 补反序列化：
   - `thinking` 块 → 对应 `ThinkingBlock` 组件
   - `tool_call` 块 → `ToolCallCard`（W4 提供）
   - `tool_result` 块 → `ToolCallCard` 的结果区
   - `text_stream` 块 → markdown（现有逻辑）
3. 保持与流式渲染**像素级一致**（对照 desktop `chatStore.ts:393` 注释：重建 trace 树保证历史与流式一致）
4. 补单测：流式产出 → 落库结构 → 反序列化结果 的往返一致性测试

**涉及文件**：`apps/web/src/api/converter.ts`、`apps/web/src/api/converter.test.ts`

**验收标准**
- [ ] 历史消息的推理过程可展开查看
- [ ] 历史消息的工具调用可查看参数与结果
- [ ] 往返一致性测试通过（流式与历史渲染结构相同）
- [ ] chat 模式的 `reasoning` / `sources` 还原不回归

---

### T3.4 三模式会话创建端点分离

| 项 | 内容 |
|---|---|
| **目标** | 执行 D3 决策，让会话类型由后端权威记录 |
| **依赖** | 无 |
| **估算** | 1.0 人日 |

**现状**：`conversationStore.ts:219` 一律调`sessionApi.createSession` → `POST /chat/sessions`，因此 `chat_sessions.agent_mode` **永远是 NULL**；mode 只存在 localStorage 的 `sessionModes`（`:328-331` 只持久化这一个字段）。

**步骤**
1. `apps/web/src/api/session.ts` 新增 `createAgentSession(data)` → `POST /agent/sessions`
   - body：`{ title, agentMode }`（`schemas/agent.ts:5` 已支持）
2. `conversationStore.create(mode)`（`:176`）按 `mode` 选端点：
   - `'chat'` → `POST /chat/sessions`（`agentMode` 不传）
   - `'pro'` → `POST /agent/sessions`（`agentMode: 'react_agent'`）
   - `'task'` → `POST /agent/sessions`（`agentMode: 'plan_execute'`）
3. 前端定义明确映射常量：`MODE_TO_AGENT_MODE: Record<AppMode, string | undefined>`
4. **零 migration 确认**：`chat_sessions.agent_mode` 列已存在（`prisma/schema.prisma:90`）
5. 补单测：三模式各自创建的会话，后端 `agentMode` 字段正确

**涉及文件**：`apps/web/src/api/session.ts`、`apps/web/src/store/conversationStore.ts`、`apps/web/src/modes/*/*.tsx`

**验收标准**
- [ ] 三模式创建的会话 `agent_mode` 分别为 `NULL` / `react_agent` / `plan_execute`
- [ ] **零 DB migration**
- [ ] 临时会话（`temp_` 前缀）逻辑不受影响

---

### T3.5 列表响应补 `agentMode` + 前端改读后端

| 项 | 内容 |
|---|---|
| **目标** | 消除 `sessionModes` localStorage 双源 |
| **依赖** | T3.4 |
| **估算** | 1.0 人日 |

**步骤**
1. `routes/chat.ts` 的 `sessionToResponse` 增加 `agentMode: s.agentMode`（**仅响应字段，无 migration**）
2. `apps/web/src/api/types.ts` 的 `Session` 加 `agentMode?: string | null`
3. `conversationStore.ts:75-86 sessionToConversation` 改为**优先从后端 `agentMode` 推导 mode**，localStorage 仅作fallback：
   ```
   agentMode==='plan_execute' → 'task'
   agentMode==='react_agent'  → 'pro'
   否则→ 'chat'
   ```
4. 保留 `sessionModes` 一轮发布做兼容，下一轮删除
5. 补单测：三 mode 的 session 列表项 mode 正确

**验收标准**
- [ ] 清空 localStorage 后三模式路由仍正确
- [ ] `sessionToConversation` 的 mode 推导有单测
- [ ] `agentMode` 缺失时安全降级为 `'chat'`

---

### T3.6 Agent 通道请求体补齐 + regenerate

| 项 | 内容 |
|---|---|
| **目标** | 让 Agent 会话具备与 chat 对等的会话操作 |
| **依赖** | T3.4 |
| **估算** | 2.5 人日 |

**现状**：`AgentChatRequestSchema`（`schemas/agent.ts:30-38`）仅 4 个字段：`sessionId` / `message` / `stream` / `agentMode`。**无** `parentMessageId` / `model` / `systemPrompt` / `tools`。而 `/chat` 已有 `regenerate` + `parentMessageId`。

**步骤**
1. `schemas/agent.ts` 的 `AgentChatRequestSchema` 增加：
   - `parentMessageId?: string | null`（编辑重发）
   - `model?: string | null`（对齐 `chat.ts:338` 的「model=None 忽略会话 model」语义）
   - `systemPrompt?: string | null`
   - `tools?: string[] | null`
2. `routes/agent.ts:289` 消费新增字段：
   - `parentMessageId` 落库到 `chat_messages.parent_message_id`（**列已存在，无 migration**）
   - `systemPrompt` 透传给 `streamAgentCompletion`（`agent-bridge.ts:91-93` 已支持）
   - `tools` 收敛到 `configurable`（注意：当前 `create_agent` 的 `configurable` 只处理 model/system_prompt/plan_execute_enabled）
3. 新增 `POST /agent/messages/:messageId/regenerate`：
   - 参照 `routes/chat.ts:940` 的 `doRegenerate`（`:1000`）
   - 走 `streamAgentCompletion` 或 `run_sync`（非流式，先出结果）
   - 建议**非流式**先行（对齐 chat 的做法），流式 regenerate 后续再补
4. 前端：`api/message.ts` 补 `regenerateAgentMessage`；pro/task 的消息操作栏接入
5. `tools` 参数需要 modu-agent 侧支持按request 裁剪工具集——`factory.ts` 支持 `create_agent({ configurable: { tools: [...] } })`，需验证

**涉及文件**：`apps/backend-ts/src/schemas/agent.ts`、`routes/agent.ts`、`core/agent-bridge.ts`、`packages/modu-agent/src/graph/factory.ts`（若需支持 tools configurable）、`apps/web/src/api/message.ts`、`apps/web/src/api/types.ts`

**验收标准**
- [ ] 编辑重发在 pro/task 可用
- [ ] 重新生成在 pro/task 可用
- [ ] `systemPrompt` per-request 生效
- [ ] **零 DB migration**
- [ ] chat 模式零回归

---

### T3.7 上下文预算管理

| 项 | 内容 |
|---|---|
| **目标** | 避免长会话爆 context |
| **依赖** | 无 |
| **估算** | 2.5 人日 |

**现状**：`routes/agent.ts:107-122` `loadSessionHistory` 固定 `take: 20`—— **按条数**而非 token 预算。

**步骤**
1. 改为 token 预算制：新增 `loadSessionHistoryByBudget(prisma, sessionId, { maxTokens, keepLastN })`
2. 复用 modu-agent 已有的上下文能力（**不重复造轮子**）：
   - `src/graph/context-strategies.ts`
   - `src/reasoning/complexity-assessor.ts`（tier_1/2/3 → 温度 0.7/0.5/0.2、reasoning_budget 1/4/8、confidence_threshold 0.6/0.75/0.9）
   - `src/graph/termination-engine.ts`
3. 超预算时的摘要压缩（对照 `chat.ts:525` 的 `length/4` 估算，先做保守实现）
4. 注意：`ComplexityAssessor` **未从 `reasoning/index.ts` 导出**，不在 modu-agent 公共 API 表面。若需使用，要么从 `factory.ts` 内部路径引用，要么**补导出**（推荐补导出，属极小改动）
5. 保留 `keepLastN`（默认 20）作为兜底，防止模型完全失忆
6. 补单测：构造 60 轮长会话，验证裁剪与压缩行为

**涉及文件**：`apps/backend-ts/src/routes/agent.ts`、`packages/modu-agent/src/reasoning/index.ts`（补导出）、`packages/modu-agent/src/graph/context-strategies.ts`

**验收标准**
- [ ] 长会话（>50 轮）不爆 context
- [ ] 压缩策略有单测
- [ ] 短会话（<10 轮）行为与现在一致（不误裁）
- [ ] `ComplexityAssessor` 补导出后仍在公共 API 表面

---

## 8. W4 — 工具与输入协议（10.5 人日）

**范围**：Pro + Task。**chat 模式不参与**（无工具、无「+」菜单）。
**Gate**：M4 —— 能真正干活。

> **安全前置**：`http_request` / `code_executor` / `sql_query` 在 `TOOL_CAPABILITY_MATRIX`（`packages/modu-agent/src/tools/tool-registry.ts:76`）全部标了 `requires_confirmation`。**T4.1 开工前必须完成安全评审。**

### T4.1 工具注册与审批策略（含安全评审）

| 项 | 内容 |
|---|---|
| **目标** | 让 Agent 能真正调用高价值工具 |
| **依赖** | W1 完成（HITL 卡已就位）、**安全评审通过** |
| **估算** | 2.0 人日 |

**现状**：`packages/modu-agent/src/graph/factory.ts:618-619` 注释明写「`HttpRequestTool` / `FileOpsTool` / `SqlQueryTool` / `CodeExecutionTool` 因需审批或需配置，**不默认注册**，由宿主按需注册」。当前只有 4 个默认工具：`datetime` / `search_engine` / `calculator` / `doc_writer`（`factory.ts:620-637`）。

**步骤**
1. **安全评审**（前置，0.25 人日包含在内）：
   - 逐个评估 `http_request`(21KB，含 SSRF 防护) / `file_ops` / `code_executor`(可执行任意代码) / `sql_query` 的风险面
   - 确认每类工具在图中的可达路径（是否可能被 ReAct 自主调用）
   - 确认护栏：`tools/tool-guardrails.ts` 的 `decideToolApprovals` / `checkGuardrailsForToolCalls`
2. 配置 `packages/modu-agent/config.yaml` 的 `tools.human_in_loop.sensitive_tools`，显式列出高危工具名
3. 在 `apps/backend-ts` 启动时（`app.ts` 或新 `core/tools.ts`）注册工具：
   - 必须**先注册，再 `create_agent()`**（`factory.ts` 的工具注册发生在建图时）
   - 注意与 T2.6 `get_runner()` 缓存的配合：工具注册后需触发图重建
4. 逐个确认 `requiresApproval()` / `requiresApprovalFor(params, context)` 的返回值覆盖高危参数（如 `sql_query` 的 `DROP`/`UPDATE`）
5. 补验收用例：**高危工具必定触发 HITL 卡，无绕过路径**

**涉及文件**：`packages/modu-agent/config.yaml`、`apps/backend-ts/src/core/agent-bridge.ts`（或新建 `core/tools.ts`）、`apps/backend-ts/src/app.ts`

**验收标准**
- [ ] 4 个工具可在图上被自主调用
- [ ] 高危工具**必定触发 HITL 卡，无绕过路径**（含改参、跳过、超时全部路径）
- [ ] 安全评审有书面结论
- [ ] 工具注册与 `get_runner()` 缓存不冲突（注册后图确实重建）
- [ ] **chat 模式仍不拥有任何工具**（G1 准则）

---

### T4.2 联网搜索收敛（不动 chat）

| 项 | 内容 |
|---|---|
| **目标** | 让 Agent 通道也产出结构化来源 |
| **依赖** | T4.1（工具注册机制） |
| **估算** | 1.5 人日 |

**现状双实现**
- chat 通道：`apps/backend-ts/src/core/web-search.ts`（Tavily → DuckDuckGo → Bing HTML 三级降级 + `refineSearchQuery` LLM 提炼关键词），产出结构化 `WEB_SEARCH_SOURCES`
- agent 通道：modu-agent 的 `search_engine` 工具（`tools/search.ts`），结果落在 `TOOL_CALL_RESULT` 里，前端当普通工具结果显示

**步骤**
1. 把 `core/web-search.ts` 的 `webSearch()` / `formatSearchContext()` 包装为 modu-agent 的 `BaseTool` 子类
   - 参考 `packages/modu-agent/src/core/interfaces/action.ts:25` 的方法式接口（`name()` / `description()` / `parametersSchema()` / `invoke()`）
   - 用 `tools/tool-adapter.ts:245` 的 `wrap_modu_tool()` 适配为 LangChain 工具
2. 工具 `invoke` 内部返回结构化来源，并额外发 `WEB_SEARCH_SOURCES` 事件
   - **难点**：工具内部无法直接发 AG-UI 事件。可行方案：结果中带 `sources` 字段，由 adapter 或 bridge 侧转换
3. `/chat/completions` 路径**一行不改**
4. `SourcesPanel` 组件在 pro/task 复用（**组件复用而非逻辑复用**）

**验收标准**
- [ ] Agent 通道产出 `WEB_SEARCH_SOURCES`
- [ ] pro/task 出现来源面板
- [ ] **chat 路径零改动，零回归**
- [ ] 三级降级链在 Agent 通道生效

---

### T4.3 `SourcesPanel` 复用到 Pro / Task

| 项 | 内容 |
|---|---|
| **目标** | 让 Agent 会话也能展示来源 |
| **依赖** | T4.2 |
| **估算** | 1.0 人日 |

**步骤**
1. `SourcesPanel` 当前在 `App.tsx:57` 以 `isChatRoute` 条件挂载。改为按模式配置化挂载（三模式都可开）
2. 扩展 `stores/sourcesPanelStore.ts` 支持多模式
3. 来源数据来源统一：流式 `WEB_SEARCH_SOURCES` 事件 + 历史 `contentBlocks.sources`
   - 注意 `converter.ts` 已能还原 chat 的 sources（`:54-63`），需补 Agent 通道的还原
4. 来源面板内的网页预览走 `GET /web/preview`（`routes/web.ts:148`，含 SSRF 校验），保持不变

**验收标准**
- [ ] pro/task 可打开来源面板
- [ ] 流式来源与历史来源都能展示
- [ ] chat 模式行为不变

---

### T4.4 结构化工具卡组件

| 项 | 内容 |
|---|---|
| **目标** | 替换当前不可用的工具展示 |
| **依赖** | T4.1 |
| **估算** | 1.5 人日 |

**现状**：`apps/web/src/modes/pro/components/ProcessPanel.tsx:92` 是 `JSON.stringify(step.content).slice(0, 200)` —— 工具参数被截断成 200 字符字符串，无参数表、无结果折叠、无耗时、无状态、无重试。

**步骤**
1. 建 `packages/agent-protocol/src/components/ToolCallCard.tsx`
   - 参考 desktop `chat/ToolCallCard.tsx` + `ToolResultRenderer.tsx` + `ObservationResult.tsx` 的设计
2. 组件 Props：
   ```
   toolName, toolCallId, arguments, result, status,
   durationMs?, errorMessage?, sensitive?
   ```
3. 渲染要素：
   - 工具名 + 状态图标（pending / running / success / error）
   - 参数表格（格式化 JSON，支持折叠）
   - 结果区（可折叠，长文本截断 + 展开）
   - 耗时
   - 敏感工具警示样式
4. 专用结果渲染器（对齐 desktop）：
   - `SearchResultsCard`（搜索结果）
   - `DatetimeChip`
   - `GenericJsonCard`
5. 建 `ThinkingBlock.tsx`（参考 desktop `chat/ThinkingBlock.tsx`）
6. 放 L2 层，Pro & Task 共用

**验收标准**
- [ ] 工具卡含参数表 / 结果折叠 / 耗时 / 状态 / 敏感标记
- [ ] 不再出现截断的 JSON 字符串
- [ ] 搜索结果有专用渲染
- [ ] 组件不 import web/desktop 私有模块

---

### T4.5 工具卡接入 ProcessPanel / Pipeline

| 项 | 内容 |
|---|---|
| **目标** | 用新组件替换现有展示 |
| **依赖** | T4.4 |
| **估算** | 1.0 人日 |

**步骤**
1. `ProcessPanel.tsx` 改用 `ToolCallCard` + `ThinkingBlock`
2. `useAgentChat` 的 `onToolCallArgs`（`:225-233`）改为**字符串累加后 JSON.parse**，而非覆盖式
   - 原因：`TOOL_CALL_ARGS` 是分片流式传输，当前 `content: delta` 会丢前面的分片
   - 对照 desktop `agui.ts` 的 `TOOL_CALL_ARGS` 处理（"字符串累加 → JSON.parse → 回填（分片安全）"）
3. `useAgentChat` 的 `onToolCallResult`（`:234-260`）改为更新对应 toolCall 而非新增一条
   - 当前实现是「再插一条 tool_result 记录」（`:248-258`），导致工具调用与结果分离显示
4. Task 模式的 `PlanPipelineTree` 内步骤结果也用同一组件
5. 接`GET /agent/executions/:id/result`（列表接口的 `outputResult` 恒为 null，`agent.ts:95`）

**涉及文件**：`apps/web/src/modes/pro/components/ProcessPanel.tsx`、`apps/web/src/modes/pro/hooks/useAgentChat.ts`、`apps/web/src/modes/task/components/PlanPipelineTree.tsx`、`apps/web/src/modes/task/hooks/usePlanExecuteChat.ts`

**验收标准**
- [ ] 工具调用与结果显示在**同一张卡**内
- [ ] 分片 `TOOL_CALL_ARGS` 参数完整（不丢前序分片）
- [ ] Pro 与 Task 视觉一致
- [ ] 工具结果详情可按需拉取

---

### T4.6 附件 / 引用 / 技能 / 知识库协议

| 项 | 内容 |
|---|---|
| **目标** | 让「+」菜单从UI 壳变成真实能力 |
| **依赖** | T3.6（请求体补齐）、T0.5（`ARTIFACT_CREATED`） |
| **估算** | 3.5 人日 |

**现状**：`ProInputMoreMenu.tsx:40-79` 定义了 5 大类 11 个子项（图片 / 文件 / 技能 / 引用 / 知识库），但：
- `ProMode.tsx:39-43` 渲染 `<AnalysisInput>` 时**未传 `onAction`**
- `AnalysisInput.tsx:63` 的 `<ProInputMoreMenu />` 无 props
- 请求体**无** `attachments` / `citations` / `skills` / `knowledgeBaseRefs` 任何字段
- `TaskInput.tsx:59` 的 `TaskInputMoreMenu` 同样未接线

**步骤**
1. 请求体协议设计（`AgentChatRequestSchema` 扩展）：
   - `attachments?: Array<{ fileId, mimeType, name, size, kind: 'image'|'file' }>`
   - `citations?: Array<{ type: 'web'|'note'|'conversation', refId, title, snippet? }>`
   - `skills?: string[]`
   - `knowledgeBaseRefs?: string[]`
2. 复用已有的 `/upload` 端点（`routes/upload.ts:28`）与 `files` 表
3. modu-agent 侧：`memory/base-store-strategy.ts` 已有 `DEFAULT_KNOWLEDGE_NAMESPACE` / `DEFAULT_HISTORY_NAMESPACE` / `DEFAULT_MEMORY_TOP_K`，接入写入
4. 前端接线：
   - `ProMode` / `TaskMode` 传 `onAction` 给输入组件
   - `ProInputMoreMenu` / `TaskInputMoreMenu` 的 11 个子项接真实动作
   - 图片走 `dataUrl`（对齐 desktop `lib/input/image-attachments.ts`）
5. `ARTIFACT_CREATED` 事件消费（T0.5 已解析）：写 `artifactStore`（`apps/web/src/store/artifactStore.ts`）
6. **chat 模式不出现这些入口**（G1 准则）

**涉及文件**：`apps/backend-ts/src/schemas/agent.ts`、`apps/web/src/modes/pro/components/ProInputMoreMenu.tsx`、`apps/web/src/modes/pro/components/AnalysisInput.tsx`、`apps/web/src/modes/task/components/TaskInput.tsx`、`apps/web/src/store/artifactStore.ts`、`packages/modu-agent/src/memory/base-store-strategy.ts`

**验收标准**
- [ ] 「+」菜单 5 大类 11 项全部产生真实请求字段
- [ ] `@文件引用` 可用
- [ ] 图片可上传并传给模型
- [ ] `ARTIFACT_CREATED` 能触发 `artifactStore` 更新
- [ ] **chat 输入框不含这些入口**

---

## 9. W5 — 生态与差异化（14.5 人日）

> ⚠️ T5.5 阻塞于 D6（schema 所有权）。

### T5.1 MCP 后端配置端点

| 项 | 内容 |
|---|---|
| **目标** | 打开 MCP 能力开关 |
| **估算** | 2.0 人日 |

**现状**：`packages/modu-agent/src/mcp/client.ts:180` `MCPClient` 完整可用（`start` / `stop` / `listAllTools` / `callTool`），`mcp/transport.ts` 支持 Stdio / SSE / WebSocket 三种，`mcp/discovery.ts` 有 `ToolDiscovery`。`factory.ts:425-449` 会自动把远程工具包装注册。**但 `mcp.enabled` 默认 false，且没有任何配置端点。**

**步骤**
1. 新增 `GET /agent/mcp/servers` — 列出已配置 MCP server 与其工具清单
2. 新增 `PUT /agent/mcp/servers` — 增删改 MCP server 配置
3. 存储：`config.yaml` 或 DB（若 D6 通过则可建表；否则先用配置文件）
4. 生命周期：`MCPClient.start(config)` 在合适时机启动（注意 `factory.ts` 的 `_discover_and_register_mcp_tools` 是异步的）
5. 工具动态变化时的图重建策略

**验收标准**
- [ ] MCP server 可增删改查
- [ ] 远程工具出现在图的可用工具集
- [ ] 连接失败有明确错误反馈与重试

---

### T5.2 MCP 前端面板

| 项 | 内容 |
|---|---|
| **目标** | 让用户看到并管理 Agent 挂了哪些 MCP |
| **估算** | 2.0 人日 |
| **依赖** | T5.1 |

**说明**：desktop **也没有**任何 MCP UI（全仓 grep `mcp` 在 `apps/desktop/src` 零命中），需从零建。`PluginsPage.tsx:119` 是硬编码假数据，`skills` / `partners` tab 是占位空页（`:348-349`）—— **不要参考它**。

**步骤**
1. 新建设置页 MCP section（web 用 shadcn/ui 体系，`apps/web/src/components/ui/`）
2. Server 列表 + 工具清单 + 连接状态 + 启停
3. 工具权限：按会话/按工具的授权开关（对接 HITL 审批策略）
4. 参考 desktop `SettingsDialog`（23.7KB）的 section 组织方式，但**重写**而非移植（desktop 版含`LocalRuntimeSection` 等 Electron 耦合）

**验收标准**
- [ ] 可查看/启停 MCP server
- [ ] 可看到每个 server 提供的工具清单
- [ ] 可配置工具的审批策略

---

### T5.3 Scenario Pack / Domain Adapter 挂载

| 项 | 内容 |
|---|---|
| **目标** | 让 Agent 具备领域能力，而非「裸 ReAct」 |
| **估算** | 3.0 人日 |

**现状**：`packages/modu-agent/src/kernel/scenario-host.ts:58` `ScenarioHost` 完整（含自动回滚）、`kernel/scenario-loader.ts` 支持从 `packs/<name>/pack.yaml` + `sop/roles.yaml` + `guardrails/rules.yaml` + `domains/*.md` 装配、`orchestration/sop-registry.ts` 有 `DEFAULT_SOP_ROLES = ['research','coding','review']`、`reasoning/domain-adapters.ts:110` 有 `registerDomainsFromMarkdown`。**全部未挂载任何 pack。**

**步骤**
1. 为 pro 配一个领域包（如 `research_writer`—— `packs/example-pack/domains/research_writer.md` 已有示例）
2. 为 task 配一个（如任务规划类）
3. `ScenarioHost.activate()` 接入 backend 启动流程
4. 验证 `filterToolsByTaskTypeAndIntent`（`tools/tool-registry.ts:338`）按 `task_type` 过滤工具生效
5. 验证 `guardrails/rules.yaml` 的护栏规则生效（`core/policy-engine.ts:38`）

**验收标准**
- [ ] pro / task 可加载不同领域包
- [ ] 领域包的工具过滤生效
- [ ] 护栏规则生效
- [ ] `deactivate()` 回滚可用

---

### T5.4 observability 接入

| 项 | 内容 |
|---|---|
| **目标** | 让 Agent 运行可观测 |
| **估算** | 3.0 人日 |

**现状**：`observability/boot.ts`、`tracing.ts`、`metrics.ts`、`exporters.ts`（含 `:221start_prometheus_server`）完整，但 `tracing.enabled` / `metrics.enabled` / `logging.structured` 三项**默认全 false**，`factory.ts:512-516` 的 `boot_observability` 走纯no-op。

**步骤**
1. 开启 `tracing.enabled`，接 OpenTelemetry（`optionalDependencies` 已有 `@opentelemetry/*`）
2. 开启 `metrics.enabled` + Prometheus exporter
3. `trace_id` 贯通：已有 `traceId = randomUUID()`（`agent-bridge.ts:109`），接入 trace 上下文（`observability/trace-context.ts`）
4. 基础看板：run 成功率、平均 tool 调用数、平均迭代轮数、token 消耗

**验收标准**
- [ ] trace 可在 Prometheus 中查询
- [ ] 关键指标有看板
- [ ] 观测开关可通过配置控制（不强制开启）

---

### T5.5 run 实体落库（阻塞于 D6）

| 项 | 内容 |
|---|---|
| **目标** | 支持执行回放 / 分享 / 分叉 |
| **估算** | 3.5 人日 |
| **阻塞** | **D6** — `prisma/schema.prisma:1-7` 声明「表结构由 Python 版 `init_db()` 创建维护，TS 侧绝不 migrate / db push」 |

**现状**：`run_id` 只存在于 SSE 帧（`routes/agent.ts:754` `run_${24hex}`），**不落库**，无法定位一次执行。

**步骤**
1. **先解 D6**：确认 Python 冻结并把 schema 所有权移交 TS 侧
2. 建 `agent_runs` 表：`id`(run_id) / `sessionId` / `userId` / `agentMode` / `status` / `startedAt` / `endedAt` / `traceId` / `usage` / `errorCode`
3. `/agent/completions` 开始时插入，结束时更新
4. 新增 `GET /agent/runs/:runId` 返回事件时间轴
5. 前端：历史消息可展开查看当时的完整执行轨迹

**验收标准**
- [ ] 每次 Agent 执行有可查询的 run 记录
- [ ] 可回放一次完整执行的事件序列
- [ ] schema 所有权问题已解决并留档

---

### T5.6 文档收尾与能力矩阵更新

| 项 | 内容 |
|---|---|
| **估算** | 0.5 人日 |

**步骤**
1. 更新 `apps/web/docs/模式能力矩阵.md` 到最终状态
2. 新增 `apps/web/docs/Agent接入指南.md`：如何为新模式接入 Agent 能力
3. 在 `packages/agent-protocol/README.md` 补协议约定与扩展指引
4. 归档 `apps/web/docs/Agent能力缺口清单.md`（把已完成的标记完成，剩余转 backlog）

**验收标准**
- [ ] 能力矩阵与实现一致
- [ ] 新人可依文档完成一次 HITL 卡扩展

---

## 10. 里程碑与停点

### 10.1 里程碑定义与 Gate

| 里程碑 | 达成标准 | 累计人日 | 日历周 | Gate 检查 |
|---|---|---|---|---|
| **M0 边界固化** | D1–D5 确认；`agent-protocol` 建成；`parseAguiStream` 覆盖 19 类事件；HITL 卡可摘性结论产出 | 5.0 | 第 1 周末 | 协议层可被两端 import；desktop 177 单测不回归 |
| **M1 Pro/Task 能批准** | 两模式 HITL 全链路 + 刷新可恢复 + **chat 确认未污染** + 单测 ≥120 | 15.0 | **第 3 周末** | 附录 A 边界表全部通过；`chat.ts` 零改动 |
| **M2 生产就绪** | 重启不丢暂停态 + abort 真取消 + Agent 配额生效 | 22.0 | **第 4–5 周末** | kill -9 验收脚本通过；token 写入 `token_usage` |
| **M3 会话一致（D5 停点）** | pro 有历史 + 推理过程可回看 + 三模式类型落库 | 32.5 | **第 6–7 周末** | 清 localStorage 后模式路由正确 |
| **M4 能真正干活** | 4 个高危工具 + 结构化工具卡 + 来源面板 + 附件协议 | 43.0 | 第 9 周末 | 安全评审通过；高危工具无绕过路径 |
| **M5 生态** | MCP 配置面 + packs + observability | 57.5 | **第 11 周末** | MCP 工具出现在图工具集 |

### 10.2 日历换算

```
57.5 人日 ÷ (1.5 FTE × 5 天 × 70% 有效利用率) ≈ 11 周
M3 停点：32.5 人日 ÷ 5.25 ≈ 6.2 周
M2 停点：22.0 人日 ÷ 5.25 ≈ 4.2 周
```

---

## 11. 风险登记册

### 11.1 高等级

| ID | 风险 | 证据 | 应对 | 责任任务 |
|---|---|---|---|---|
| **N1** | **HITL 卡片段摘取不确定** | desktop `InputArea.tsx` 1700+ 行；`HitlToolConfirmPanel` 是**文件内私有函数**（未 export），依赖 InputArea 的 autosize / scrolledAncestors 上下文 | **T0.6 spike 前置 0.5 天**；三个结论对应三档估算（2.5 / 3.5 / 4.0 人日）。结论为「需重写」时立即上报调整 W1 排期 | T0.6 |
| **N5** | **Python 后端冻结状态未书面确认** | `start.sh:29-32` 只启 `backend-ts`；`apps/backend/**/*.py` 9 月后仅 1 文件改动 | T0.1 书面确认。若否 → W2 / W4 后端工作量 ×2，**W4 优先级下调** | T0.1 |
| **N7** | **高危工具注册的安全敞口** | `http_request`(21KB) / `code_executor`（可执行任意代码）/ `sql_query` 全是 `requires_confirmation` | T4.1 开工前安全评审；逐个显式声明 `requiresApproval`；配 `tools.human_in_loop.sensitive_tools`；验收含「无绕过路径」用例（改参 / 跳过 / 超时全路径） | T4.1 |
| **N10** | **人力单点** | git 显示 web / desktop / modu-agent 基本由 1 人（`Developer`）维护 + 1 人（`xyb85315266`）支持；10/1–10/5 连续 5 天密集提交 | W1 优先排；`packages/agent-protocol` 让 web + desktop **双端受益摊薄成本**；T0.6 spike 早暴露风险 | 全局 |

### 11.2 中等级

| ID | 风险 | 证据 | 应对 | 责任任务 |
|---|---|---|---|---|
| **N2** | **三栈逻辑重复诱发过度抽象** | 三模式各有独立 hook，都会做「fetch + parseAguiStream + 消息累积」 | 明确**只在出现第二处真实重复时抽**，遵守 Rule of Three。chat 与 pro 差异（多轮累积 vs 单轮重置）过大，**不要合并这三个 hook** | T3.2 |
| **N3** | **模式边界被侵蚀** | T4.6 的「+」菜单若不加约束，容易顺手也给 chat 加上技能 / 知识库 | 能力矩阵作为**PR 审查清单**；T1.8 与 T4.6 各设一条验收项：「chat 输入框不含 agent 入口」，并写成自动化断言 | T1.8, T4.6 |
| **N4** | **Pro 过程展示可能不够** | D1 选 A（仅右侧面板），而 desktop 有 17KB 的 `AgentTimeline` 消息内时间线 | 明确 A 为一期方案并**预留组件位**；M4 后按实际使用数据决定是否立D1-B（+3~5 人日） | T1.3 |
| **N6** | **schema 所有权阻塞新表** | `prisma/schema.prisma:1-7` | W0–W4 **零 migration**（`agent_mode` / `plan_steps` 列已存在）；仅 T5.5 受阻 → D6 前置决策 | T5.5 |
| **N8** | **checkpointer 外置是行为变更非纯配置** | `@langchain/langgraph-checkpoint-sqlite` 未在 package.json；`BoundedMemorySaver`(LRU 100) 换 `SqliteSaver` 后 thread 语义 / 淘汰 / 超时全变 | dev 双跑对比；**保留 memory 回退开关**；T2.1 与 T2.2 分开 PR，不与 T2.3 合并 | T2.1, T2.2 |
| **N9** | **HITL 超时占满共享 checkpointer** | `config.yaml` `approval_timeout_seconds: 300` + LRU 上限 100 | T2.2 加 TTL 清理调度（`sweepExpiredInterrupts` 已有函数，缺调度器） | T2.2 |

### 11.3 已消除的风险

| 原ID | 原风险 | 消除原因 |
|---|---|---|
| ~~R2~~ | `chatStore.ts`(65KB) 摘取失控 | 三模式分层方案下**不移植 chatStore** |
| ~~R10~~ | 搜索收敛必动 chat 生产路径 | T4.2 让 `/chat` 一行不改，只复用 `SourcesPanel` 组件 |
| ~~R6~~ | SSE 解析器 0 测试 | 扩展 web 现有 `parseAguiStream`（**已有 8KB 测试**），比替换 desktop 的无测试 parser 风险低 |

### 11.4 低等级

| ID | 风险 | 证据 | 应对 |
|---|---|---|---|
| **R11** | 端口口径混乱 | `start.sh:30` 注释「port 6000」；`config/env.ts` `PORT=8088`；`vite.config.ts:28` proxy 8088 | W0 内统一到 8088 + 补 `.env.example` |
| **R12** | 两个 git 作者并行改同文件 | 均在改 modu-agent | W1 只动 web + `packages/`；modu-agent 侧改动单独 PR 提前知会 |

---

## 12. 验收标准

### 12.1 模式边界验收（G1 准则，最高优先）

| 检查项 | chat | pro | task |
|---|---|---|---|
| 是否请求 `/agent/*` | ❌ 必须否 | ✅ | ✅ |
| 是否挂 HITL 卡 | ❌ 必须否 | ✅ | ✅ |
| 是否挂工具 / 来源 / Artifact 入口 | ❌ 必须否 | ✅ | ✅ |
| 是否出现 plan 相关 UI | ❌ 必须否 | ❌ 必须否 | ✅ |
| 是否引 `@pioneering/*` 依赖 | ❌ 必须否 | ✅ | ✅ |
| 「深度思考」语义 | 原生 reasoning | **不加此开关**，明示「ReAct 推理过程」 | 同 pro |

### 12.2 能力验收总纲

| 维度 | 当前基线 | M2 | M3 | M5 |
|---|---|---|---|---|
| web 单测数 | 95 | ≥120 | ≥155 | ≥185 |
| desktop 单测数 | 177 | 177（不回归） | 177 | 177 |
| parser 覆盖事件类型 | 6 | 12 | 12 | 19 |
| **pro** HITL 接入点 | 0 | 1 | 1 | 1 |
| **task** HITL 接入点 | 0 | 1 | 1 | 1 |
| **chat** HITL 接入点 | 0 | **0（必须保持）** | 0 | 0 |
| 前端引用 agent 端点数 | 1 | 4 | 5 | 5 |
| 默认注册工具数 | 4 | 4 | 4 | 8 |
| 重启后 HITL 恢复 | ❌ | ✅ | ✅ | ✅ |
| 停止时上游真取消 | ❌ | ✅ | ✅ | ✅ |
| Agent 通道配额 | ❌ | ✅ | ✅ | ✅ |
| **pro** 历史恢复 | ❌ | ❌ | ✅ | ✅ |
| 历史消息推理过程可见 | ❌ | ❌ | ✅ | ✅ |
| 三模式会话类型可辨 | ❌ 仅 localStorage | ❌ | ✅ 后端权威 | ✅ |
| 来源面板覆盖模式 | chat | chat | chat+pro+task | chat+pro+task |
| 可注册工具的 UI 管理 | ❌ | ❌ | ❌ | ✅ |
| 可配 MCP 服务 | ❌ | ❌ | ❌ | ✅ |

---

## 13. 资源与假设

### 13.1 假设

| 项 | 假设 |
|---|---|
| 人力 | **1.5 FTE 有效**（1 人主攻 web，1 人 0.5 投入 backend / modu-agent / 评审） |
| 人日定义 | 1 人日 = 1 人 × 1 天专注开发（**不含**评审、联调等待、 CI 排队） |
| 有效利用率 | 70%（留 30% 给存量缺陷、线上问题、需求澄清） |
| 起点 | web 95 单测、desktop 177 单测、仓库可构建可运行 |
| 技术栈 | 不引入新框架级依赖；仅新增 1 个可选原生依赖（sqlite saver） |
| 范围 | 严格按第 0 节范围冻结执行 |
| **最大不确定性** | **T0.6 spike 结论**。若判定「需重写」，T1.1+T1.2 从 2.5 涨到 4.0 人日（**+60%**），W1 顺延 |

### 13.2 资源需求

| 项 | 需求 | 说明 |
|---|---|---|
| 新增依赖 | `@langchain/langgraph-checkpoint-sqlite`（optional） | **未在 package.json 声明**，T2.1 需新增；须验证 darwin(arm64) 可用 |
| 新增包 | `packages/agent-protocol` | `workspaces` 已含 `packages/*`，**无需改根配置**；需打通 tsconfig paths 与构建 |
| DB 迁移 | **W0–W4 零迁移** | `chat_sessions.agent_mode`、`chat_messages.parent_message_id`、`plan_steps` 列均已存在 |
| 配置改动 | `packages/modu-agent/config.yaml`：`memory.checkpointer_type`、`tools.human_in_loop.sensitive_tools`、`mcp.enabled`、`observability.*` | 该文件注释称「首次安装自动生成，可安全修改」 |
| 测试能力 | 需支持「kill -9 进程后断言 pending 恢复」的验收脚本 | 当前 web / desktop 均为纯单测，**无 e2e 框架**。T2.2 需引入轻量 Node 编排脚本 |
| 安全评审 | T4.1 前置，0.25 人日 | 4 个高危工具的逐个评估 |

### 13.3 分模式投入分布

| 模式 | 直接投入 | 构成 |
|---|---|---|
| **chat 对话** | **0.5 人日** | 仅口径澄清与文案区分（D2）；配额 / 停止 / 历史 / Sources 全部已有 |
| **pro 分析** | **13.5 人日** | HITL 接入 3.0 + 工具卡 1.3 + 历史 / 会话 3.5 + 输入协议 1.75 + 配额停止均摊 |
| **task 任务** | **9.0 人日** | HITL 接入 3.0 + 工具卡 1.3 + 会话 1.5 + 输入协议 1.75 + 配额停止均摊 |
| **共享层 / 后端 / 协议** | **34.5 人日** | W0 协议层 5.0 + W2 后端 7.0 + W3 部分 5.5 + W4 部分 2.5 + W5 14.5 |

---

## 附录 A — 能力矩阵（PR 审查基准）

> 本表是**硬约束**。任何 PR 若导致本表某项变化，必须在 PR 描述中显式说明并获得评审确认。

| 能力 | chat `/chat` | pro `/pro` | task `/task` |
|---|---|---|---|
| 后端通道 | `/chat/completions` | `/agent/completions` | `/agent/completions` |
| `agentMode` | 不传 | `react_agent` | `plan_execute` |
| modu-agent 图 | 不经过 | ReAct | Plan-and-Execute |
| 工具调用 | ❌ | ✅ | ✅ |
| HITL 中断卡 | ❌ | ✅ | ✅ |
| 需求澄清 | ❌ | ✅ | ✅ |
| Plan 计划 / 时间轴 | ❌ | ❌ | ✅ |
| Artifact 预览 | ❌ | ✅ | ✅ |
| 联网来源面板 | ✅ | ✅（W4 起） | ✅（W4 起） |
| 配额统计 | ✅ | ✅（W2 起） | ✅（W2 起） |
| 停止联动上游 | ✅ | ✅（W2 起） | ✅（W2 起） |
| 深度思考语义 | 原生 reasoning | ReAct 推理过程 | ReAct 推理过程 |

---

## 附录 B — 任务总表

| Wave | ID | 任务名 | 人日 | 依赖 | 阻塞于 |
|---|---|---|---|---|---|
| W0 | T0.1 | 决策固化与文档基线 | 0.5 | — | — |
| W0 | T0.2 | 删除 `rag_agent` 死枚举 | 0.5 | — | — |
| W0 | T0.3 | 建立 `packages/agent-protocol` 骨架与 HITL 类型 | 0.75 | T0.1 | — |
| W0 | T0.4 | 移植 `hitlStore` + `hitl-bridge` | 1.25 | T0.3 | — |
| W0 | T0.5 | 扩展 `parseAguiStream` 至 19 类事件 | 1.5 | — | — |
| W0 | T0.6 | Spike：HITL 卡片段可摘性判定 | 0.5 | T0.1 | — |
| W1 | T1.1 | `HitlInlineCard` 骨架 + clarifying/choice | 1.0 | T0.3, T0.5, T0.6 | — |
| W1 | T1.2 | `tool_confirm` 分支（含改参） | 1.5 | T1.1, T0.6 | — |
| W1 | T1.3 | Pro 模式接入 HITL | 2.0 | T0.4, T0.5, T1.1, T1.2 | — |
| W1 | T1.4 | Task 模式接入 HITL | 2.0 | T1.3, T1.1, T1.2 | — |
| W1 | T1.5 | 暂停期部分消息暂存与续写 | 1.5 | T1.3, T1.4 | — |
| W1 | T1.6 | 刷新恢复（recover）接线 | 1.0 | T1.3, T1.4, T1.5 | — |
| W1 | T1.7 | 契约与回归测试 | 0.5 | T1.1–T1.6 | — |
| W1 | T1.8 | 模式边界验收 | 0.5 | T1.1–T1.7 | — |
| W2 | T2.1 | 引入 sqlite checkpointer 依赖与配置开关 | 1.0 | — | — |
| W2 | T2.2 | 外置验证 + TTL 清理调度 | 1.0 | T2.1 | — |
| W2 | T2.3 | AbortSignal 全链贯通 | 1.5 | — | — |
| W2 | T2.4 | 中止语义与不落库 | 1.0 | T2.3 | — |
| W2 | T2.5 | Agent 通道配额与用量 | 1.5 | — | — |
| W2 | T2.6 | 图缓存切换 | 1.0 | — | — |
| W3 | T3.1 | Pro 补历史恢复 | 1.0 | W1 | — |
| W3 | T3.2 | Task / Chat 历史统一核对 | 0.5 | T3.1 | — |
| W3 | T3.3 | `contentBlocks` 反序列化 | 2.0 | T0.5, T1.2 | — |
| W3 | T3.4 | 三模式会话创建端点分离 | 1.0 | — | — |
| W3 | T3.5 | 列表响应补 `agentMode` + 前端改读后端 | 1.0 | T3.4 | — |
| W3 | T3.6 | Agent 通道请求体补齐 + regenerate | 2.5 | T3.4 | — |
| W3 | T3.7 | 上下文预算管理 | 2.5 | — | — |
| W4 | T4.1 | 工具注册与审批策略（含安全评审） | 2.0 | W1, T4.1 前置评审 | 安全评审 |
| W4 | T4.2 | 联网搜索收敛（不动 chat） | 1.5 | T4.1 | — |
| W4 | T4.3 | `SourcesPanel` 复用到 Pro / Task | 1.0 | T4.2 | — |
| W4 | T4.4 | 结构化工具卡组件 | 1.5 | T4.1 | — |
| W4 | T4.5 | 工具卡接入 ProcessPanel / Pipeline | 1.0 | T4.4 | — |
| W4 | T4.6 | 附件 / 引用 / 技能 / 知识库协议 | 3.5 | T3.6, T0.5 | — |
| W5 | T5.1 | MCP 后端配置端点 | 2.0 | — | — |
| W5 | T5.2 | MCP 前端面板 | 2.0 | T5.1 | — |
| W5 | T5.3 | Scenario Pack / Domain Adapter 挂载 | 3.0 | — | — |
| W5 | T5.4 | observability 接入 | 3.0 | — | — |
| W5 | T5.5 | run 实体落库 | 3.5 | — | **D6** |
| W5 | T5.6 | 文档收尾与能力矩阵更新 | 0.5 | — | — |
| | | **合计 39 个任务** | **57.5** | | |

---

## 附录 C — 关键文件清单

### C.1 前端新增

| 文件 | 用途 | 任务 |
|---|---|---|
| `packages/agent-protocol/src/hitlStore.ts` | HITL 状态机（移植） | T0.4 |
| `packages/agent-protocol/src/hitl-bridge.ts` | 循环依赖切断（移植） | T0.4 |
| `packages/agent-protocol/src/components/HitlInlineCard.tsx` | HITL 内嵌卡 | T1.1, T1.2 |
| `packages/agent-protocol/src/components/ToolCallCard.tsx` | 结构化工具卡 | T4.4 |
| `packages/agent-protocol/src/components/ThinkingBlock.tsx` | 思考块 | T4.4 |
| `apps/web/src/api/agent.ts` | Agent 通道 API | T1.4 |

### C.2 前端关键改动

| 文件 | 改动 | 任务 |
|---|---|---|
| `apps/web/src/lib/parseAguiStream.ts` | 6 → 19 类事件 | T0.5 |
| `apps/web/src/modes/pro/hooks/useAgentChat.ts` | HITL / 历史 / 工具卡 | T1.3, T3.1, T4.5 |
| `apps/web/src/modes/pro/components/AnalysisInput.tsx` | 接入 HITL 卡 + 工具卡 | T1.3, T4.6 |
| `apps/web/src/modes/pro/components/ProcessPanel.tsx` | 换用工具卡 | T4.5 |
| `apps/web/src/modes/pro/components/ProInputMoreMenu.tsx` | 接线 `onAction` | T4.6 |
| `apps/web/src/modes/pro/ProMode.tsx` | recover effect | T1.6 |
| `apps/web/src/modes/task/hooks/usePlanExecuteChat.ts` | HITL / 工具卡 | T1.4, T4.5 |
| `apps/web/src/modes/task/components/TaskInput.tsx` | 接入 HITL 卡 + 工具卡 | T1.4, T4.6 |
| `apps/web/src/modes/task/TaskMode.tsx` | recover effect | T1.6 |
| `apps/web/src/store/conversationStore.ts` | 三模式端点分离 + mode 来源 | T3.4, T3.5 |
| `apps/web/src/api/converter.ts` | contentBlocks 反序列化 | T3.3 |
| `apps/web/src/api/session.ts` | `createAgentSession` | T3.4 |
| `apps/web/src/api/message.ts` | `regenerateAgentMessage` | T3.6 |

### C.3 后端关键改动

| 文件 | 改动 | 任务 |
|---|---|---|
| `apps/backend-ts/src/schemas/agent.ts` | 删 `rag_agent`；请求体补齐 | T0.2, T3.6 |
| `apps/backend-ts/src/core/agent-bridge.ts` | signal / `abortReason` / `get_runner` | T2.3, T2.4, T2.6 |
| `apps/backend-ts/src/routes/agent.ts` | 持久化条件 / regenerate / 配额 / tools | T2.3–T2.6, T3.6, T4.1 |
| `apps/backend-ts/src/routes/chat.ts` | 列表响应补 `agentMode` | T3.5 |
| `apps/backend-ts/src/core/quota.ts` | **新建**，抽 `checkQuota` / `recordUsage` | T2.5 |
| `apps/backend-ts/src/core/tools.ts` | **新建**，工具注册 | T4.1 |
| `apps/backend-ts/src/core/agent-scheduler.ts` | **新建**，TTL 清理调度 | T2.2 |
| `apps/backend-ts/src/core/agent-mcp.ts` | **新建**，MCP 配置端点 | T5.1 |
| `apps/backend-ts/test/` | **新增** kill -9 验收脚本 | T2.2 |

### C.4 modu-agent 关键改动

| 文件 | 改动 | 任务 |
|---|---|---|
| `packages/modu-agent/package.json` | 加 sqlite saver optional dep | T2.1 |
| `packages/modu-agent/config.yaml` | checkpointer / sensitive_tools / mcp / observability | T2.1, T4.1, T5.1, T5.4 |
| `packages/modu-agent/src/graph/runner.ts` | `signal` 支持 | T2.3 |
| `packages/modu-agent/src/reasoning/index.ts` | 补导出 `ComplexityAssessor` | T3.7 |
| `packages/modu-agent/src/memory/base-store-strategy.ts` | 知识库 / 附件写入 | T4.6 |
| `packages/modu-agent/src/graph/factory.ts` | 按 request 裁剪工具集（若需） | T3.6 |

---

## 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-10-06 | v1.0 | 初版。决策 D1–D5 拍板；任务拆分为 6 Wave / 39 任务 / 57.5 人日；停点 M3 |