# 文档设计 vs 代码实现：逐 Step 对比分析

> 基于 `Agent交互时序.md` 中定义的七步闭环流程，逐 Step 对比代码实际实现状态。

## 结论

**当前代码无法跑通文档设计的完整业务流程。**

文档定义了 7 步闭环流程，但代码只实现了一个简化的线性管道，缺失了多个核心环节。当前代码只能跑通一个**最简化的 LLM 问答流程**（输入→LLM→输出），文档设计的 Agent 七步闭环流程**无法跑通**。

```
文档设计的完整流程：  Step1 → Step2 → Step3 ↔ Step4/5 → Step6 → Step7
                         ↓        ↓        ↓           ↓         ↓        ↓
代码实际执行流程：    [跳过]  [查询但丢弃] [LLM生成]  [工具执行但无闭环] [返回]  [仅短期写入]

实际可跑通的简化路径：  用户输入 → LLM生成回答 → 返回
                       （工具调用是外部硬编码的附加操作，与LLM回答无关）
```

---

## Step 1：感知层拦截与标准化 — ❌ 不可用

### 文档要求

> 文本清洗、敏感词过滤、生成 TraceID → 发布 PerceptionEvent

### 代码现状

`coordinator.py` 第 42-49 行：

```python
perception_event = AgentEvent(...)
await self._event_bus.publish(perception_event)
```

### 逐项对比

| 文档要求 | 代码实现 | 状态 |
|---------|---------|------|
| 调用感知组件处理输入 | 只发布了事件，**从未调用 TextPreprocessor** | ❌ |
| 文本清洗/截断/敏感词过滤 | 完全未执行 | ❌ |
| 敏感词熔断（sensitivity_level=5 时拒绝） | 无此逻辑 | ❌ |
| 生成 TraceID | ✅ 已实现 | ✅ |

### 影响

敏感信息（密码、身份证）不会被拦截，超长输入不会被截断，整个安全防线形同虚设。

---

## Step 2：记忆层上下文注入 — ❌ 结果未传递

### 文档要求

> 检索短期(Redis)与长期(ChromaDB)记忆 → 发布 ContextEvent → 传递给推理层

### 代码现状

`coordinator.py` 第 51-60 行：

```python
memory_result = self._storage_adapter.query(...)
# memory_result 之后从未被使用！
```

### 逐项对比

| 文档要求 | 代码实现 | 状态 |
|---------|---------|------|
| 查询短期记忆 | ✅ 调用了 StorageAdapter.query | ✅ |
| 查询长期记忆 | ❌ StorageAdapter 只绑定一个 memory 实例 | ❌ |
| 将记忆结果注入 LLM context | ❌ **memory_result 从未传递给 LLM** | ❌ |
| 发布 ContextEvent | ❌ 无此事件 | ❌ |

### 关键断裂

`memory_result` 查询后就被丢弃了。LLM 的 `context` 参数只包含 `trace_id`、`session_id`、`user_id`，**不包含任何历史对话或检索到的知识**。即使记忆层有数据，LLM 也完全看不到。

另外，`StorageAdapter` 默认只绑定第一个注册的 memory（即 `short_term`），**长期记忆永远不会被查询**。

---

## Step 3：推理层思考与决策 — ⚠️ 部分可用

### 文档要求

> 动态加载 prompt_template → 注入工具 schema → LLM 分析意图并规划 → 决定是否调用工具

### 代码现状

`coordinator.py` 第 72-80 行：

```python
response = self._llm_adapter.generate(
    prompt=prompt,
    context=context,
    temperature=...,
    max_tokens=...,
)
```

### 逐项对比

| 文档要求 | 代码实现 | 状态 |
|---------|---------|------|
| 调用 LLM 生成 | ✅ 调用了 LLMAdapter.generate | ✅ |
| 注入工具 schema 到 prompt | ❌ context 中无 `tool_descriptions` | ❌ |
| LLM 自主决定是否调用工具 | ❌ 工具由调用方硬编码指定 | ❌ |
| 动态 prompt_template | ❌ 无模板机制 | ❌ |

### 关键断裂

文档设计的是 LLM **自主决策**是否调用工具（ReAct 模式），但代码中工具调用是外部 `input_data["tools"]` 硬编码指定的。LLM 没有工具描述信息，无法做出"需要调用工具"的判断。

---

## Step 4 & 5：行动执行 + 观察迭代 — ❌ 核心闭环缺失

### 文档要求

> LLM 输出工具调用指令 → 执行工具 → 结果反馈给 LLM → 循环回到 Step 3（ReAct 闭环）

### 代码现状

`coordinator.py` 第 82-93 行：

```python
response = self._llm_adapter.generate(...)     # LLM 先生成
tools_to_call = input_data.get("tools", [])     # 外部指定工具
for tool_spec in tools_to_call:                 # 顺序执行工具
    tool_result = self._tool_adapter.invoke_tool(...)
    tool_results.append(tool_result)
# 工具结果从未反馈给 LLM！
```

### 逐项对比

| 文档要求 | 代码实现 | 状态 |
|---------|---------|------|
| LLM 决定调用哪个工具 | ❌ 外部硬编码 | ❌ |
| 工具结果反馈给 LLM | ❌ **完全缺失** | ❌ |
| ReAct 循环（Step 3↔5） | ❌ 无循环机制 | ❌ |
| 最大迭代次数限制 | ❌ 无此保护 | ❌ |
| 工具执行超时保护 | ❌ timeout_ms 未生效 | ❌ |

### 关键断裂

这是最核心的断裂。当前流程是 `LLM生成 → 工具执行 → 结束`，而文档要求的是 `LLM思考 → 工具执行 → 结果观察 → LLM再思考 → ... → 最终回答` 的闭环。工具结果和 LLM 回答是两条平行线，LLM 的回答完全基于原始 prompt，不包含任何工具执行结果。

---

## Step 6：响应输出与流式推送 — ⚠️ 部分可用

### 文档要求

> 调用 stream_response() → SSE/WebSocket 实时推送

### 逐项对比

| 文档要求 | 代码实现 | 状态 |
|---------|---------|------|
| 流式输出 | LLMAdapter 有 stream 方法，但 Coordinator 未调用 | ⚠️ |
| SSE/WebSocket 推送 | ❌ 无此层 | ❌ |
| 非流式输出 | ✅ 可用 | ✅ |

---

## Step 7：记忆异步更新 — ⚠️ 部分可用

### 文档要求

> 异步触发 → 更新 Redis 会话日志 + 向量化入库 ChromaDB

### 代码现状

`coordinator.py` 第 95-99 行：

```python
self._storage_adapter.update(
    user_id=user_id,
    new_data={"prompt": prompt, "response": response},
    metadata={"session_id": session_id, "trace_id": trace_id},
)
```

### 逐项对比

| 文档要求 | 代码实现 | 状态 |
|---------|---------|------|
| 更新短期记忆 | ✅ 调用了 StorageAdapter.update | ✅ |
| 更新长期记忆（向量化入库） | ❌ StorageAdapter 只写一个 memory | ❌ |
| 异步执行 | ❌ 同步阻塞调用 | ❌ |
| 保存完整交互链路 | ⚠️ 只保存了 prompt+response，无工具调用记录 | ⚠️ |

---

## 异常与降级分支 — ❌ 全部缺失

| 文档要求的异常分支 | 代码实现 |
|------------------|---------|
| 感知层敏感词熔断（Step 1 直接拒绝） | ❌ |
| 记忆层超限 → 摘要压缩重试 | ❌ |
| LLM 格式错误 → Self-Correction 重试 2 次 | ❌ |
| 工具超时 → TOOL_002 → LLM 自主决策重试 | ❌ |

---

## 修复优先级排序

### P0 — 阻塞级（不修则整个 Agent 流程无法按文档跑通）

| # | 问题 | 影响 | 修复位置 |
|---|------|------|---------|
| **P0-1** | **ReAct 闭环完全缺失** | 工具结果不反馈 LLM，LLM 不自主决策调用工具，Agent 退化为普通 Chatbot | `Coordinator.process_request` |
| **P0-2** | **记忆查询结果未注入 LLM context** | LLM 看不到任何历史对话和知识，每次都是"失忆"状态 | `Coordinator.process_request` |
| **P0-3** | **感知组件未被调用** | 敏感词不拦截、输入不清洗，安全防线失效 | `Coordinator.process_request` |

### P1 — 严重级（核心功能缺陷，影响正确性）

| # | 问题 | 影响 | 修复位置 |
|---|------|------|---------|
| **P1-1** | **短期/长期记忆未分层查询** | StorageAdapter 只绑一个 memory，长期知识永远查不到 | `StorageAdapter` |
| **P1-2** | **工具 schema 未注入 LLM prompt** | LLM 不知道有哪些工具可用，无法自主决策 | `Coordinator` → `LLMAdapter` |
| **P1-3** | **工具执行无超时保护** | timeout_ms 参数未生效，工具卡死则整个请求阻塞 | `ToolAdapter.invoke_tool` |
| **P1-4** | **ChromaLongTermMemory 默认配置返回空** | 默认 context_window="last_5_turns" 导致长期记忆查询永远空 | `ChromaLongTermMemory.query` |

### P2 — 重要级（异常处理与降级）

| # | 问题 | 影响 | 修复位置 |
|---|------|------|---------|
| **P2-1** | **无 ReAct 循环终止条件** | 缺少 max_iterations 限制，理论上可能死循环 | `Coordinator` |
| **P2-2** | **无 LLM 输出解析器** | 无法解析 LLM 返回的工具调用 JSON，无 Self-Correction | 新增 OutputParser |
| **P2-3** | **无敏感词熔断机制** | sensitivity_level=5 时应在 Step 1 直接拒绝 | `Coordinator` |
| **P2-4** | **记忆更新只写短期不写长期** | 高价值信息不会向量化入库 | `StorageAdapter.update` |

### P3 — 改善级（健壮性与一致性）

| # | 问题 | 影响 | 修复位置 |
|---|------|------|---------|
| **P3-1** | EventBus 域索引逻辑导致通用订阅者丢失事件 | 监听全部事件的订阅者收不到有专用订阅者的域事件 | `EventBus.publish` |
| **P3-2** | ConsensusPattern 不是真正的共识 | 只检查可用性不检查一致性 | `ConsensusPattern` |
| **P3-3** | CalculatorTool eval DoS 风险 | `2**999999999` 可通过验证 | `CalculatorTool._safe_eval` |
| **P3-4** | swap_component 无类型校验 | 可注入任意对象 | `ComponentRegistry.swap_component` |
| **P3-5** | 全局单例无线程安全保护 | 多线程竞态条件 | `get_registry`/`get_event_bus`/`get_config` |

---

## 修复路径建议

按优先级从高到低，建议按以下顺序修复：

1. **P0-3** → 在 Coordinator 中调用感知组件，实现敏感词熔断
2. **P0-2** → 将记忆查询结果注入 LLM context（history + memory_context）
3. **P1-1** → StorageAdapter 支持分层查询短期+长期记忆
4. **P1-2** → 将工具 schema 注入 LLM prompt（tool_descriptions）
5. **P0-1** → 实现 ReAct 闭环：LLM 输出解析 → 工具调用 → 结果反馈 → 循环
6. **P2-1** → 添加 max_iterations 循环终止条件
7. **P1-3** → ToolAdapter 工具执行超时保护
8. **P1-4** → 修复 ChromaLongTermMemory 默认配置兼容性
9. **P2-2 ~ P2-4** → 异常降级分支
10. **P3-1 ~ P3-5** → 健壮性改善
