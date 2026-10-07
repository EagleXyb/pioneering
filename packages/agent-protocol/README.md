# @pioneering/agent-protocol

L2 Agent 协议层：HITL（Human-in-the-Loop）类型与状态机，供 `apps/web` 的 pro（`/pro`）与 task（`/task`）两模式消费。chat（`/chat`）栈不引本包。

## 命名约定（硬约束）

| 通道 | 大小写 | 示例 |
|---|---|---|
| AG-UI 事件载荷（SSE） | **snake_case** | `session_id` / `run_id` / `tool_calls` / `pending_tool_calls` |
| REST 请求体 | **camelCase** | `sessionId` / `modifiedArgs` / `answerId` |

## 内容

- `HitlKind` / `HitlItem` / `HitlResolveInput` / `UserQuestionRequestPayload` / `ResumeRequest` / `AbortRequest` / `HitlStateResponse` 等协议类型
- `useHitlStore`：暂停项队列（串行 + 去重）、resolving 保护、recover 三态恢复
- `hitl-bridge`：单向桥接，切断 store 间 ESM 循环依赖
- `components/HitlInlineCard`：pro / task 共用的内联应答卡（clarifying / choice）
- `components/HitlToolConfirmBody`：工具审批卡主体（工具列表折叠 + JSON 改参）

## 扩展指引（如何新增一类 HITL 交互）

按以下顺序改动，可完成一次 HITL 卡扩展（新人上手口径）：

1. **协议类型（`src/types.ts`）**
   - 若引入新的暂停类别，在 `HitlKind` 联合类型追加（如新增 `'review_confirm'`）。
   - 载荷字段遵循 AG-UI **snake_case**；前端内部模型 `HitlItem` 用 **camelCase**，在转换函数里做映射。
2. **状态机（`src/hitlStore.ts`）**
   - 复用 `pendingQueue` 串行队列与 `itemKey()` 去重；新类别若允许跳过，在 `skip()` 中放行，否则同 `tool_confirm` 一样返回 `false`。
   - `recover()` 的「仍暂停 / 已超时 / 未就绪」三态无需为新类别特判，除非后端 `GET /agent/state` 结构变化。
3. **卡片渲染（`src/components/HitlInlineCard.tsx`）**
   - 新增 `kind` 分支组件，保持与现有分支一致的 props 契约（`busy` 禁用全部交互、`index/total` 队列提示）。
   - 样式写入同目录 `.css`，只使用 CSS 变量以适配宿主主题，不引用 web / desktop 私有模块。
4. **接线（宿主侧，不在本包内）**
   - 在目标模式的流式 hook 中，于 `parseAguiStream` 回调把 AG-UI 载荷转成 `HitlItem` 并入队；暂停态保留 `streamingMessageId`，resume 时**续写同一条** assistant 消息。
5. **测试**
   - 状态机新行为在 `src/__tests__/hitl.test.ts` 补用例；卡片新分支用 React Testing Library 覆盖「渲染 → 交互 → busy 禁用」。

## 边界约束

- chat（`/chat`）栈**不引本包**；HITL 只接 pro（`/pro`）与 task（`/task`）两处。
- 场景包不得绕过协议层直接 import 宿主内核源码。
