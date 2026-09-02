# 需求澄清 HITL 机制实施方案

> 基于 `packages/modu-agent` 源码深度分析。针对「用户需求不明确时 Agent 直接基于错误假设执行」的问题，设计一套**感知层检测 → 澄清决策 → interrupt 澄清 → 恢复继续**的 HITL（Human-in-the-Loop）需求澄清机制，完全复用现有工具审批 HITL 的 interrupt/resume/checkpointer/超时清理基础设施，低侵入、可灰度。

---

## 一、现状分析：当前没有「需求澄清」HITL 机制

### 1.1 现有 HITL 仅覆盖「工具调用审批」，非「需求澄清」

`packages/modu-agent/src/graph/nodes.ts:1819` 的 `makeHumanReviewNode`（P3-12.3.2）是当前唯一的 HITL 节点：

```
Agent 已决定调用敏感工具（code_executor / sql_query / file_ops_write）
    → human_review 节点 interrupt() 暂停
    → 用户批准/拒绝（支持参数级改参）
    → resume_sync / resume_stream 恢复
    → 超时自动拒绝（approval_timeout_seconds，默认 300s，TOOL_APPROVAL_TIMEOUT 错误码）
```

关键锚点：

| 文件 | 关键函数 | 作用 |
|------|----------|------|
| `src/graph/nodes.ts:1819` | `makeHumanReviewNode` | 敏感工具执行前 interrupt，审批后路由（`routeAfterHumanReview`，`:2039`） |
| `src/graph/runner.ts:919-1278` | `resume_sync` / `resume_stream` / `get_interrupt_state` / `checkInterruptTimeout` / `sweepExpiredInterrupts` | HITL 恢复入口 + 超时清理链路（完整） |

它发生在 **Agent 已明确要调用什么工具之后**。在用户需求不明确时，Agent 会直接进入 ReAct 循环，可能基于错误假设执行——**没有机制帮助用户澄清需求**。

### 1.2 感知层「需求不明确」检测缺失

| 检查点 | 现状 | 位置 |
|--------|------|------|
| 意图类别 | 仅 `question/request/command/complaint/greeting/farewell/other`，无 clarify/unknown/insufficient | `src/perception/text/llm-parser.ts:47` |
| 质量评估 | `quality_score`（含 `clarity/completeness/relevance`）存在但默认关闭（`enableQuality=false`），且无任何消费方触发澄清 | `llm-parser.ts:52-63,109` |
| 感知置信度 | 仅用于 agent 节点「保守温度」（低置信度→temperature 0.3），不触发澄清 | `nodes.ts:1097-1104` |
| 感知后路由 | `routeAfterPerception` 只做敏感度/注入/PII 熔断 → `memory_query`，无澄清分叉 | `nodes.ts:458-490` |

### 1.3 已预留的接口（落地成本低）

`src/orchestration/communication/agui-adapter.ts:54-68` 的 `UserQuestionRequestPayload.kind` 已定义 `'tool_confirm' | 'clarifying' | 'choice'`：

```ts
export interface UserQuestionRequestPayload {
  kind: 'tool_confirm' | 'clarifying' | 'choice'   // clarifying/choice 已预留
  question?: string        // kind='clarifying' 时携带澄清问题文本
  options?: Array<{ id: string; label: string }>   // kind='choice' 时携带多选选项
}
```

注释明确「一期仅使用 `kind='tool_confirm'`；`clarifying`/`choice` 为后续澄清追问/多选确认预留」。图层的 `interrupt()` + checkpointer + resume + `sweepExpiredInterrupts` 超时清理机制均可直接复用。

---

## 二、方案总体设计

```
┌──────────────────────────────────────────────────────────────────────┐
│  用户输入（需求可能不明确）                                             │
└──────────────────────────┬───────────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  感知层 perception_node                                              │
│  ├─ text_preprocessor   （基础清洗）                                  │
│  ├─ llm_parser          （intent/entities/sentiment/quality）        │
│  └─ clarity_detector ★  （新增：需求明确度检测）                       │
│     输出: needs_clarification / clarity_score / missing_slots        │
└──────────────────────────┬───────────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  routeAfterPerception（改造）                                         │
│  ├─ 敏感度/注入/PII 熔断（原逻辑不变）                                 │
│  ├─ needs_clarification && round < max_clarify_rounds ──→ clarify ★ │
│  └─ 否则 ──→ memory_query（原路径）                                   │
└──────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  clarify 节点 ★（新增）                                               │
│  ├─ LLM 生成澄清问题（带 choice 选项 + 允许自由文本）                   │
│  └─ interrupt({ kind: 'clarifying', question, options }) 暂停        │
└──────────────────────────────────────────────────────────────────────┘
                           │ 用户回答（resume payload: answer / answer_id）
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  恢复路径（复用 runner.ts resume 链路）                                │
│  ├─ 用户回答写入 clarification_answers                                 │
│  ├─ 合并进 messages（AIMessage 汇总澄清上下文）                        │
│  └─ 清理 needs_clarification 标志 ──→ agent / supervisor 继续         │
└──────────────────────────────────────────────────────────────────────┘
```

### 核心原则

1. **纯增强、零侵入**：`clarification.enabled` 默认关闭，关闭时行为与现状完全一致（沿用现有 gated 设计约束）。
2. **复用优先**：interrupt/resume/checkpointer/超时清理全部复用现有工具审批 HITL 链路，不改图拓扑主干。
3. **防打扰**：仅对「高模糊 + 高影响」的需求澄清（阈值可配置），澄清问题提供选项 + 自由文本，减少用户负担。
4. **防死循环**：`max_clarify_rounds` 上限 + 超时后按默认假设继续或放弃（可配置）。

---

## 三、分模块实施方案

### 3.1 感知层：新增「需求明确度检测器」

**新增文件**：`src/perception/clarity-detector.ts`

```ts
export interface ClaritySignal {
  needs_clarification: boolean
  clarity_score: number            // 0-1，复用 quality prompt 的 clarity/completeness
  missing_slots: Array<{ slot: string; question: string }>  // 缺失关键信息槽位
  reason: string
}
```

**检测信号**（可配置开关）：

| 信号 | 说明 |
|------|------|
| `clarity_score` | 复用现有 `_QUALITY_PROMPT`（`llm-parser.ts:52`），开启 `enableQuality` 后取 `overall` |
| 槽位缺失 | 基于意图类型声明必填槽位（如「生成文档」需目标/格式/长度，「查数据」需范围/时间），LLM 判断缺失项并生成针对性问题 |
| 短输入 + 低置信度 | `min_input_chars`（默认 10 字）+ intent 置信度低，视为表达不充分 |

**接入方式**：注册为感知器（`registry.registerPerception('clarity_detector', ...)`），加入 `perception.routing.text.pipeline` 尾部；或作为 `llm_parser` 的并行增强（复用 `runPerceptionPipelineAsync` 的并行路径）。输出并入 `perception_result`，由 `makePerceptionNode`（`nodes.ts:254`）透传为 `state.needs_clarification`。

### 3.2 状态层：新增澄清字段

**修改文件**：`src/graph/state.ts`

```ts
needs_clarification?: boolean                        // 感知层检测结果
clarification_question?: string                     // 生成的澄清问题
clarification_options?: Array<{ id: string; label: string }>  // 多选选项
clarification_answers?: Record<string, any>          // resume 时写入的用户回答
clarification_round?: number                         // 澄清轮次（上限控制）
```

全部使用现有 `_lw`（last-write-wins）reducer，新增字段不改变既有 reducer 语义。

### 3.3 图层：新增 `clarify` 节点 + 路由分叉

**修改文件**：`src/graph/nodes.ts`

新增 `makeClarifyNode(clarifyLlm)`：

```ts
export function makeClarifyNode(clarifyLlm: any | null) {
  async function _clarifyNode(state) {
    // 1. 读取 ClaritySignal（needs_clarification / missing_slots）
    // 2. 用 LLM 生成澄清问题：优先基于 missing_slots 生成针对性问题 + 选项；
    //    LLM 不可用/失败时回退为通用问题 "请补充你的需求细节"
    // 3. interrupt({ kind: 'clarifying', question, options })
    // 4. resume payload 写入 clarification_answers + clarification_round + 1
    // 5. 返回 cleaned 状态（清除 needs_clarification，避免循环）
  }
}
```

**路由改造** `routeAfterPerception`（`nodes.ts:458`），在熔断检查后追加分叉：

```
needs_clarification && (clarification_round ?? 0) < max_clarify_rounds → 'clarify'
否则 → memory_query（原路径）
```

**图挂载**（`src/graph/graph.ts`）：`perception → (routeAfterPerception) ─ clarify → agent/supervisor`；`src/graph/factory.ts` 中 `create_agent()` 创建并传入 `clarifyLlm`。

### 3.4 runner 层：扩展 resume payload

**修改文件**：`src/graph/runner.ts`

- 复用 `resume_sync` / `resume_stream` 的 checkpoint 恢复链路，扩展 resume payload 语义：`{ answer: string, answer_id?: string }`（区别于工具审批的 `{ approved, feedback }`）。
- 扩展 `get_interrupt_state`（`runner.ts:1105`）返回值：增加 `kind: 'tool_confirm' | 'clarifying'`，供调用方区分恢复类型。
- 超时处理：复用 `checkInterruptTimeout`（`runner.ts:1171`），澄清超时按 `on_timeout` 配置处理（默认 `continue_with_defaults`）。

### 3.5 协议层：激活预留协议

**修改文件**：`src/orchestration/communication/agui-adapter.ts`

启用 `kind='clarifying'` / `kind='choice'` 事件编码（结构已预留，见 1.3），前端据此渲染澄清卡片（问题 + 选项按钮 + 自由输入框）。

### 3.6 配置：新增 `perception.clarification` 块

**修改文件**：`src/config/runtime-config.ts` 的 `DEFAULT_CONFIG`（并同步 `capability-registry.ts` 登记）

```yaml
perception:
  clarification:
    enabled: false                # 默认关，零侵入
    clarity_threshold: 0.4        # 低于此分触发澄清
    max_clarify_rounds: 2         # 避免无限追问
    min_input_chars: 10           # 短输入检查
    slot_requirements: {}         # 意图 → 必填槽位映射
    timeout_seconds: 120          # 复用 HITL 超时清理
    on_timeout: 'continue_with_defaults'   # 超时后按默认假设继续 | abort
```

---

## 四、降级与安全策略

| 场景 | 处理 |
|------|------|
| `clarification.enabled=false` | 感知层不产出信号、图不挂 clarify 节点，行为与现状逐字节等价 |
| LLM 生成澄清问题失败 | 回退通用问题 `"请补充你的需求细节"`，不抛异常 |
| 用户澄清超时 | 按 `on_timeout` 配置：默认「按默认假设继续」，可配置为「放弃并返回说明」 |
| 澄清轮次超上限 | 停止追问，按现有 best-effort 假设继续执行（写入日志/事件便于观测） |
| 感知管线异常 | 沿用现有 `runPerceptionPipeline` 的单感知器失败隔离（`pipeline.ts:107-110`） |

---

## 五、改动点清单与量级评估

| # | 文件 | 改动类型 | 量级 |
|---|------|----------|------|
| 1 | `src/perception/clarity-detector.ts` | 新增 | 小 |
| 2 | `src/config/runtime-config.ts`（+ `capability-registry.ts`） | 修改 | 小 |
| 3 | `src/graph/nodes.ts`（`makeClarifyNode` + `routeAfterPerception` 分叉） | 修改 | 中 |
| 4 | `src/graph/state.ts`（澄清字段） | 修改 | 小 |
| 5 | `src/graph/graph.ts` / `factory.ts`（节点挂载） | 修改 | 小 |
| 6 | `src/graph/runner.ts`（resume payload + interrupt state kind） | 修改 | 小 |
| 7 | `src/orchestration/communication/agui-adapter.ts`（激活 clarifying/choice） | 修改 | 小 |
| 8 | 测试：`tests/perception/clarity-detector.test.ts`、`tests/graph/clarify-node.test.ts`、澄清 e2e | 新增 | 中 |

**总体量级：小到中等。** 核心是「感知层加一个检测器 + 图层加一个 interrupt 节点」，完全复用现有 HITL 的 interrupt/resume/checkpointer/超时清理链路，不动图拓扑主干，向后兼容风险低。

---

## 六、测试计划

1. **单元测试（`clarity-detector.test.ts`）**：明确需求不触发 / 短输入触发 / 槽位缺失触发 / 阈值边界。
2. **节点测试（`clarify-node.test.ts`）**：LLM 生成问题成功与失败回退 / resume 后状态合并 / 轮次上限。
3. **路由测试**：`routeAfterPerception` 澄清分叉与原有熔断优先级（熔断优先）。
4. **集成/e2e**：`get_interrupt_state` 返回 `kind='clarifying'` / 超时按 `on_timeout` 恢复 / 关闭开关行为等价现状。
