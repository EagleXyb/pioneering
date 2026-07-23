# 时间轴步骤持久化 —— 后端与 DB 补丁

> 本文档配套「任务模式时间轴步骤持久化方案」实施。前端改动已在 `apps/web` 内完成（详见提交记录），但因 TRAE 工作目录限制为 `apps/web`，下列后端与 DB 改动需在工作目录外手动应用。
>
> 应用顺序：① DB DDL → ② Prisma schema → ③ 重新 `prisma generate` → ④ 后端 agent-bridge.ts → ⑤ 后端 agent.ts → ⑥ 后端 schemas/agent.ts（可选）。

---

## ① DB DDL —— `docs/接口/数据库表.sql`

在文件末尾（第 8 节 `user_quotas` 之后）追加第 9 节：

```sql
-- 9. Plan-and-Execute 任务步骤表
CREATE TABLE plan_steps (
    id VARCHAR(64) PRIMARY KEY,
    message_id VARCHAR(64) NOT NULL,          -- 关联的 assistant 消息 ID
    session_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,

    -- 步骤规划信息（来自 planner 节点输出）
    step_id VARCHAR(100) NOT NULL,             -- 逻辑 step_id（planner 输出，如 step_1）
    step_index INT NOT NULL,                  -- 展示顺序（0-based，保序）

    -- 步骤文案
    title VARCHAR(500) NOT NULL,
    description TEXT,
    depends_on JSONB,                          -- 依赖步骤 ID 数组

    -- 步骤执行状态与结果（step_finalize 合并后的终态）
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending','running','done','failed','skipped')),
    result TEXT,                               -- 步骤结果摘要（≤500 字符）
    error TEXT,                                -- 失败原因

    -- 时间戳（来自 step_update）
    started_at TIMESTAMPTZ,                    -- step_update.started_at
    finished_at TIMESTAMPTZ,                   -- step_update.finished_at
    duration_ms INT GENERATED ALWAYS AS (
        CASE
            WHEN started_at IS NOT NULL AND finished_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000
            ELSE NULL
        END
    ) STORED,

    -- 扩展元数据（replan 代际、tool_refs 等）
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_plan_steps_message FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
    CONSTRAINT fk_plan_steps_session FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);
COMMENT ON TABLE plan_steps IS 'Plan-and-Execute 任务步骤表（时间轴步骤终态持久化）';
COMMENT ON COLUMN plan_steps.step_id IS '逻辑步骤 ID（planner 输出，如 step_1）';
COMMENT ON COLUMN plan_steps.step_index IS '展示顺序（保序，0-based）';
COMMENT ON COLUMN plan_steps.status IS '步骤终态：pending/running/done/failed/skipped';
COMMENT ON COLUMN plan_steps.result IS '步骤结果摘要（step_finalize 输出，≤500 字符）';
COMMENT ON COLUMN plan_steps.duration_ms IS '步骤执行耗时（毫秒），自动计算';
CREATE INDEX idx_plan_steps_message ON plan_steps(message_id, step_index);
CREATE INDEX idx_plan_steps_session ON plan_steps(session_id);
```

---

## ② Prisma schema —— `apps/backend-ts/prisma/schema.prisma`

### 2.1 在 `ChatMessage` model 内增加反向关系

定位到 `model ChatMessage { ... }`（约 103-128 行），在 `childMessages  ChatMessage[]  @relation("MessageParent")` 之后追加：

```prisma
  planSteps       PlanStep[]
```

### 2.2 在文件末尾（`AgentToolExecution` model 之后）新增 `PlanStep` model

```prisma
// ===== 10. plan_steps =====
// Plan-and-Execute 任务步骤终态持久化（时间轴恢复数据源）
model PlanStep {
  id          String    @id @db.VarChar(64)
  messageId   String    @map("message_id") @db.VarChar(64)
  sessionId   String    @map("session_id") @db.VarChar(64)
  userId      String    @map("user_id") @db.VarChar(64)
  stepId      String    @map("step_id") @db.VarChar(100)
  stepIndex   Int       @map("step_index")
  title       String    @db.VarChar(500)
  description String?   @db.Text
  dependsOn   Json?     @map("depends_on")
  status      String    @db.VarChar(20)
  result      String?   @db.Text
  error       String?   @db.Text
  startedAt   DateTime? @map("started_at") @db.Timestamptz
  finishedAt  DateTime? @map("finished_at") @db.Timestamptz
  durationMs  Int?      @map("duration_ms")
  metadata    Json?
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  message ChatMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@index([messageId, stepIndex], map: "idx_plan_steps_message")
  @@index([sessionId], map: "idx_plan_steps_session")
  @@map("plan_steps")
}
```

### 2.3 重新生成 Prisma Client

```bash
cd apps/backend-ts
npx prisma generate
```

> 注意：根据项目约定，**只执行 `prisma generate`，绝不执行 `prisma migrate` 或 `db push`**，表结构由 Python `init_db()` 维护。

---

## ③ 后端核心 —— `apps/backend-ts/src/core/agent-bridge.ts`

### 3.1 `StreamContext` 扩展两个字段

定位到 `export class StreamContext {`（约 27 行），在 `stepUpdates` 字段之后追加：

```typescript
  // P4: Plan 终态元数据（供 persistAssistantMessage 写入 chat_messages.metadata）
  planPhase: 'done' | 'error' | null = null;
  planError: string | null = null;
```

### 3.2 新增 `mergePlanSteps` 工具函数与类型导出

在文件末尾追加：

```typescript
// ============================================================
// mergePlanSteps: 将 planData + stepUpdates 合并为步骤终态
// ============================================================

export interface MergedPlanStep {
  step_id: string;
  title: string;
  description: string;
  depends_on?: string[];
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  result?: string;
  error?: string;
  started_at?: number;   // ms 时间戳
  finished_at?: number;  // ms 时间戳
}

/**
 * 将 StreamContext 收集的 planData（最后一次 plan 快照）与
 * stepUpdates（全量步骤更新日志，跨 replan 累积）合并为步骤终态。
 *
 * 合并规则：
 *   1. 以最新 plan 快照为骨架（status 初始 pending）
 *   2. 按顺序应用 step_update（同 id 后写覆盖前写）
 *   3. 跳过不在最新 plan 中的 step_id（replan 前已失效的步骤不持久化）
 *   4. 保序输出（planData 顺序即为 rootIds 顺序）
 */
export function mergePlanSteps(
  planData: Record<string, any>[],
  stepUpdates: Record<string, any>[],
): MergedPlanStep[] {
  const map = new Map<string, MergedPlanStep>();
  for (const s of planData) {
    const id = s.step_id ?? s.id ?? '';
    if (!id) continue;
    map.set(id, {
      step_id: id,
      title: s.title ?? '',
      description: s.description ?? '',
      depends_on: s.depends_on,
      status: s.status ?? 'pending',
    });
  }
  for (const u of stepUpdates) {
    const id = u.id ?? '';
    const step = map.get(id);
    if (!step) continue;  // 跳过 replan 前已失效的 step_id
    if (u.status) step.status = u.status;
    if (u.result !== undefined) step.result = u.result;
    if (u.error !== undefined) step.error = u.error;
    if (u.started_at !== undefined) step.started_at = u.started_at;
    if (u.finished_at !== undefined) step.finished_at = u.finished_at;
  }
  return Array.from(map.values());
}
```

### 3.3 `collectMetadataFromEvent` 内 STATE_DELTA 分支补充 phase 终态收集

定位到 `} else if (eventType === 'STATE_DELTA') {`（约 251 行），将整个分支替换为：

```typescript
  } else if (eventType === 'STATE_DELTA') {
    // P4: 收集 Plan-Execute 元数据，供持久化与前端状态恢复
    const phase = data.phase ?? '';
    if (phase === 'plan' && Array.isArray(data.plan)) {
      ctx.planData = data.plan;
    } else if (phase === 'execute' && data.step_update) {
      ctx.stepUpdates.push(data.step_update);
    }
  } else if (eventType === 'RUN_FINISHED') {
    ctx.planPhase = 'done';
  } else if (eventType === 'RUN_ERROR') {
    ctx.planPhase = 'error';
    ctx.planError = data.message ?? null;
  }
```

> 注意：原 `RUN_ERROR` 分支已存在（行 248-250），需合并为单一分支，避免重复赋值。最终 `collectMetadataFromEvent` 内 `RUN_ERROR` 仅保留 `ctx.planPhase = 'error'; ctx.planError = data.message ?? null;`，原 `ctx.hasError` / `ctx.errorInfo` 赋值保留。

---

## ④ 后端路由 —— `apps/backend-ts/src/routes/agent.ts`

### 4.1 顶部导入扩展

定位到 `import { StreamContext, streamAgentCompletion } from '../core/agent-bridge.js'`（约 16 行），改为：

```typescript
import { StreamContext, streamAgentCompletion, mergePlanSteps } from '../core/agent-bridge.js'
import { Prisma as Prisma_ } from '@prisma/client'
```

（若 `Prisma` 已导入则复用，无需重复导入；下方示例使用已有的 `Prisma` 即可）

### 4.2 `messageToResponse` 补 `metadata` 字段

定位到 `function messageToResponse(m: ChatMessage) {`（约 52 行），在返回对象内追加：

```typescript
function messageToResponse(m: ChatMessage) {
  return {
    id: m.id,
    sessionId: m.sessionId,
    role: m.role,
    content: m.content ?? '',
    contentBlocks: m.contentBlocks,
    metadata: m.metadata,                    // 新增：供前端判断是否含 plan 数据
    promptTokens: m.promptTokens,
    completionTokens: m.completionTokens,
    latencyMs: m.latencyMs,
    userRating: m.userRating,
    userFeedback: m.userFeedback,
    createdAt: m.createdAt,
  }
}
```

### 4.3 `persistAssistantMessage` 写入 plan_steps + metadata

定位到 `async function persistAssistantMessage(`（约 109 行），整体替换为：

```typescript
async function persistAssistantMessage(
  prisma: PrismaClient,
  opts: { sessionId: string; userId: string; ctx: StreamContext },
): Promise<ChatMessage> {
  const { sessionId, userId, ctx } = opts
  const assistantMsgId = genId('msg_')

  // 仅当本次产生过 plan 数据时才写入 metadata（避免污染非 plan_execute 消息）
  const hasPlanData = ctx.planData.length > 0
  const extraMetadata = hasPlanData
    ? { plan_phase: ctx.planPhase ?? 'done', plan_error: ctx.planError }
    : undefined

  const assistantMsg = await prisma.chatMessage.create({
    data: {
      id: assistantMsgId,
      sessionId,
      userId,
      role: 'assistant',
      content: ctx.answerContent,
      contentBlocks: ctx.contentBlocks.length > 0 ? ctx.contentBlocks : Prisma.JsonNull,
      promptTokens: ctx.promptTokens || null,
      completionTokens: ctx.completionTokens || null,
      latencyMs: ctx.latencyMs || null,
      metadata: extraMetadata ?? undefined,   // 新增：plan 终态元数据
    },
  })

  // ===== 新增：持久化 plan 步骤终态 =====
  if (hasPlanData) {
    const merged = mergePlanSteps(ctx.planData, ctx.stepUpdates)
    for (let i = 0; i < merged.length; i++) {
      const s = merged[i]
      await prisma.planStep.create({
        data: {
          id: genId('pstep_'),
          messageId: assistantMsgId,
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
    fastify.log.info(
      { sessionId, messageId: assistantMsgId, planSteps: merged.length },
      '[agent.completions] persist.plan_steps',
    )
  }

  // 持久化工具执行记录（原逻辑保持不变）
  for (const te of ctx.toolExecutions) {
    await prisma.agentToolExecution.create({
      data: {
        id: genId('exec_'),
        messageId: assistantMsgId,
        sessionId,
        userId,
        toolName: te.toolName ?? '',
        toolCallId: te.executionId ?? null,
        inputParams: te.inputParams ?? Prisma.JsonNull,
        outputResult: te.outputResult ?? null,
        outputSummary: te.outputSummary ?? null,
        status: te.status ?? 'pending',
        errorMessage: te.errorMessage ?? null,
      },
    })
  }

  // 更新会话计数（原逻辑保持不变）
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: {
      messageCount: { increment: 1 },
      lastMessageId: assistantMsgId,
    },
  })

  return assistantMsg
}
```

> 注意：`persistAssistantMessage` 是模块级函数，无法访问 `fastify`。若需保留 log，将 log 移至调用处（`agent.completions` 路由内 `await persistAssistantMessage(...)` 之后），或删除该 log。

### 4.4 新增 `GET /messages/:messageId/plan` 端点

在 `// ========== 工具执行轨迹查询 ==========` 注释之前（约 381 行）插入：

```typescript
  // ========== Plan 步骤时间轴恢复 ==========

  // GET /agent/messages/:messageId/plan
  // 返回该 assistant 消息关联的 plan 步骤快照（按 step_index 升序）
  app.get('/messages/:messageId/plan', buildSchema({
    params: z.object({ messageId: z.string() }),
    tags: ['agent'],
    summary: '获取消息的任务步骤时间轴（持久化恢复用）',
    security: [{ BearerAuth: [] }],
  }), async (req) => {
    const { messageId } = req.params as { messageId: string }
    const msg = await fastify.prisma.chatMessage.findFirst({
      where: { id: messageId, userId: req.user.id },
    })
    if (!msg) throw new NotFoundError('消息不存在')

    const steps = await fastify.prisma.planStep.findMany({
      where: { messageId },
      orderBy: { stepIndex: 'asc' },
    })
    const meta = (msg.metadata as any) ?? {}
    return {
      messageId,
      phase: meta.plan_phase ?? null,
      error: meta.plan_error ?? null,
      collapsedSteps: meta.collapsed_steps ?? {},
      steps: steps.map((s) => ({
        step_id: s.stepId,
        step_index: s.stepIndex,
        title: s.title,
        description: s.description ?? '',
        depends_on: s.dependsOn ?? [],
        status: s.status,
        result: s.result ?? undefined,
        error: s.error ?? undefined,
        started_at: s.startedAt ? new Date(s.startedAt).getTime() : undefined,
        finished_at: s.finishedAt ? new Date(s.finishedAt).getTime() : undefined,
        duration_ms: s.durationMs ?? undefined,
      })),
    }
  })

  // POST /agent/messages/:messageId/plan/collapsed
  // 回传用户手动折叠状态快照（流结束后由前端调用，保视觉细节）
  app.post('/messages/:messageId/plan/collapsed', buildSchema({
    params: z.object({ messageId: z.string() }),
    body: z.object({ collapsedSteps: z.record(z.boolean()) }),
    tags: ['agent'],
    summary: '回传时间轴折叠状态快照',
    security: [{ BearerAuth: [] }],
  }), async (req) => {
    const { messageId } = req.params as { messageId: string }
    const dto = req.body as { collapsedSteps: Record<string, boolean> }
    const msg = await fastify.prisma.chatMessage.findFirst({
      where: { id: messageId, userId: req.user.id },
    })
    if (!msg) throw new NotFoundError('消息不存在')

    // 合并现有 metadata（保留 plan_phase/plan_error），追加 collapsed_steps
    const existingMeta = (msg.metadata as any) ?? {}
    const newMeta = { ...existingMeta, collapsed_steps: dto.collapsedSteps }
    await fastify.prisma.chatMessage.update({
      where: { id: messageId },
      data: { metadata: newMeta },
    })
    return { message: '折叠状态已保存' }
  })
```

---

## ⑤ 后端 schemas —— `apps/backend-ts/src/schemas/agent.ts`（可选，用于 OpenAPI 文档）

在文件末尾追加：

```typescript
// Plan-and-Execute 时间轴快照响应（GET /agent/messages/:id/plan）
export const PlanStepSnapshotSchema = z.object({
  step_id: z.string(),
  step_index: z.number(),
  title: z.string(),
  description: z.string(),
  depends_on: z.array(z.string()).optional(),
  status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']),
  result: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  started_at: z.number().nullable().optional(),
  finished_at: z.number().nullable().optional(),
  duration_ms: z.number().nullable().optional(),
})

export const PlanSnapshotResponseSchema = z.object({
  messageId: z.string(),
  phase: z.enum(['done', 'error']).nullable(),
  error: z.string().nullable(),
  collapsedSteps: z.record(z.boolean()),
  steps: z.array(PlanStepSnapshotSchema),
})
```

---

## 验证清单

应用上述补丁后，按以下步骤验证：

1. **DB 表创建**：执行 `数据库表.sql` 中的第 9 节，确认 `plan_steps` 表与索引创建成功
2. **Prisma Client**：`cd apps/backend-ts && npx prisma generate`，确认无错误
3. **后端编译**：`cd apps/backend-ts && npx tsc --noEmit`，确认无错误
4. **端到端流程**：
   - 前端任务模式发送一条任务
   - 流结束后检查 DB：`SELECT * FROM plan_steps WHERE message_id = '<assistant_msg_id>'`
   - 确认 steps 数量、step_index 顺序、status 终态正确
   - 检查 `chat_messages.metadata` 含 `plan_phase` / `plan_error`
   - 刷新页面或切换会话再切回，确认右侧时间轴恢复与初次生成一致
5. **折叠回传**：手动折叠某个步骤 → 流结束后 → 刷新页面 → 确认折叠态保持

---

## 前端已完成改动清单（参考）

以下文件已在 `apps/web` 内完成实施，无需再次应用：

| 文件 | 改动 |
|------|------|
| `src/api/plan.ts` | 新建：getMessagePlan / patchCollapsedSteps / PlanSnapshot 类型 |
| `src/store/planExecuteStore.ts` | 新增 source/snapshotMessageId/hydrateFromHistory |
| `src/store/planExecuteStore.test.ts` | 新增 6 个 hydrateFromHistory 单元测试 |
| `src/modes/task/hooks/usePlanExecuteChat.ts` | 新增 loadHistory + persistCollapsedSnapshot + RUN_FINISHED 回传 |
| `src/modes/task/TaskMode.tsx` | useEffect 改调 loadHistory 替代 reset |
| `src/api/converter.ts` | ChatMessageData 增加 metadata 字段，convertMessages 填充 |
| `src/modes/task/components/PlanPipelineTree.tsx` | 根 div 传递 data-source 属性 |
| `src/modes/task/task.css` | data-source="history" 禁用 running 脉冲/spinner 动画 |

验证结果：planExecuteStore 测试 10 个全部通过；本次改动文件无 TypeScript 错误。
