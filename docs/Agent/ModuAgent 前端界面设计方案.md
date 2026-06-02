# ModuAgent 前端界面设计方案

> 基于对 `python-backend\ModuAgent` 目录下 **84 个源文件** 的深度阅读，覆盖核心接口、组件实现、配置管理、事件系统、通信协议、进化机制等全部模块。

---

## 一、代码架构核心发现（设计依据）

### 1.1 Agent 运行流程架构（ReAct 模式）

从 [coordinator.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/orchestration/coordinator.py) 的 `process_request()` 和 `stream_request()` 方法可知，Agent 遵循严格的 **ReAct（Reasoning + Acting）循环**：

```
Perception → Memory Query → Reasoning → [Tool Call → Tool Result → Reasoning] × N → Action → Result
```

**关键状态节点**（前端必须追踪的6个阶段）：

| 阶段 | 代码位置 | 可观测状态 | 异常分支 |
|------|---------|-----------|---------|
| ① 感知(Perception) | L45-73 | 输入类型、敏感度检测、截断标记 | 敏感内容熔断(`PERCEPTION_002`) |
| ② 记忆查询(Memory) | L95-112 | 短期记忆命中、长期知识检索 | `MEMORY_101/102` |
| ③ 推理(Reasoning) | L130-136 | LLM 模型选择、Token 消耗 | `LLM_001/002` |
| ④ 工具调用(Tool) | L138-195 | 工具名、参数、迭代次数、超时 | `TOOL_001/002` |
| ⑤ 格式化重试(Format Retry) | L148-171 | 重试次数、解析错误 | 超限后降级为直接回复 |
| ⑥ 记忆更新(Update) | L197-204 | 短期/长期写入状态 | 静默失败 |

### 1.2 事件系统架构

从 [protocol.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/orchestration/communication/protocol.py) 和 [message_bus.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/orchestration/communication/message_bus.py) 可知：

- **8个事件域** (`EventDomain`)：`PERCEPTION`, `REASONING`, `MEMORY`, `ACTION`, `FEEDBACK`, `TOOL`, `NLP`, `VISION`
- **10种事件动作** (`EventAction`)：`QUERY`, `UPDATE`, `ANALYZE`, `EXECUTE`, `INVOKE`, `GENERATE`, `STREAM`, `REGISTER`, `NOTIFY`, `ANALYZE_SCENE`
- **4级优先级** (`EventPriority`)：`LOW`, `NORMAL`, `HIGH`, `CRITICAL`
- **事件日志**：保存最近1000条（`max_log_size`），支持按 domain/session_id 过滤

### 1.3 AG-UI 通信协议

从 [agui_adapter.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/orchestration/communication/agui_adapter.py) 可知，后端通过 SSE 推送以下事件类型：

| 事件类型 | 说明 | 前端展示需求 |
|---------|------|------------|
| `RUN_STARTED` | 运行开始 | 初始化运行状态 |
| `RUN_FINISHED` | 运行结束 | 标记完成，汇总统计 |
| `RUN_ERROR` | 运行错误 | 显示错误弹窗 |
| `TEXT_MESSAGE_START/CONTENT/END` | 文本流式输出 | 逐字展示 AI 回复 |
| `THINKING_START/CONTENT/END` | 思考过程 | 折叠式展示内部推理 |
| `TOOL_CALL_START/ARGS/END/RESULT` | 工具调用 | 工具调用卡片 |
| `STATE_SNAPSHOT/DELTA` | 状态快照/增量 | 实时状态面板更新 |
| `MESSAGES_SNAPSHOT` | 消息历史快照 | 初始化对话视图 |

### 1.4 运行时配置体系

从 [runtime_config.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/config/runtime_config.py) 可知，以下参数支持运行时动态调整：

```
llm.temperature (0.7)              → 前端可调滑块
llm.max_tokens (512)               → 前端可调数值输入
llm.max_reasoning_iterations (3)   → 控制 ReAct 循环上限
llm.max_format_retries (2)         → 控制格式修正次数
tools.default_timeout_ms (3000)    → 工具超时设置
perception.sensitivity_threshold (5) → 敏感度阈值
feedback.evolution_threshold (0.6) → 进化触发阈值
memory.context_window ("last_5_turns") → 记忆窗口大小
```

### 1.5 组件注册与运行时替换

从 [registry.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/core/registry.py) 可知，支持 **10 类组件** 的动态注册/替换：

| 组件类别 | 注册键 | 当前实现 |
|---------|-------|---------|
| 推理引擎 | `reasoning_engines` | qwen, gpt |
| 推理策略 | `reasoning_strategies` | (预留) |
| 行动执行器 | `action_executors` | sync |
| 工具 | `tools` | search_engine, calculator |
| 记忆 | `memories` | short_term, long_term |
| 存储适配器 | `storage_adapters` | (预留) |
| 感知器 | `perceptions` | text_preprocessor |
| 传感器 | `sensors` | (预留) |
| 反馈循环 | `feedback_loops` | (预留) |
| 进化信号 | `evolution_signals` | (预留) |

---

## 二、需展示的关键运行状态信息

### 2.1 全局运行状态栏（顶部固定）

基于 [coordinator.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/orchestration/coordinator.py) 的 6 阶段流程：

| 字段 | 数据来源 | 展示方式 | 代码依据 |
|------|---------|---------|---------|
| 当前阶段 | `EventDomain` 枚举 | 6 阶段进度条（Perception→Memory→Reasoning→Tool→Action→Done） | protocol.py L8-16 |
| 进度百分比 | 阶段数 / 6 × 100% | 百分比数字 + 进度条 | 内部计算 |
| 运行状态 | `RUN_STARTED/FINISHED/ERROR` | 状态指示灯（绿/黄/红） | agui_adapter.py L8-10 |
| Trace ID | `trace_id` | 可复制文本 | coordinator.py L36 |
| Session ID | `session_id` | 可复制文本 | coordinator.py L37 |
| 当前推理引擎 | `LLMAdapter._engine_name` | 引擎图标 + 名称 | llm_adapter.py L10 |
| 迭代计数 | `iteration` | "第 X/3 轮" | coordinator.py L138 |
| 累计 Token 消耗 | `tokens_used` | Token 计数器 | base_llm.py L75 |
| 工具调用统计 | `tool_count` | "已调用 N 个工具" | coordinator.py L229 |

### 2.2 感知阶段详情面板

基于 [rule_based.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/components/perception/text/rule_based.py)：

| 字段 | 代码来源 | 展示 |
|------|---------|------|
| 输入类型 | `input_type` | 标签（文本/图像/音频） |
| 检测语言 | `detected_language` | 语言标签（zh/en） |
| 置信度 | `confidence` | 百分比 |
| 敏感度等级 | `sensitivity_level` (0-5) | 分级指示器，≥5 触发红色警告 |
| 是否截断 | `metadata.truncated` | 截断标记 + 原始长度 |
| 熔断状态 | `PERCEPTION_SENSITIVITY_REJECTED` | 红色警告卡片 |

### 2.3 记忆查询详情面板

基于 [storage_adapter.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/adapters/storage_adapter.py) 和 [redis_adapter.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/components/memory/cache/redis_adapter.py)：

| 字段 | 来源 | 展示 |
|------|------|------|
| 短期记忆命中 | `history` 列表长度 | 命中条目数 |
| 长期知识检索 | `knowledge` 列表长度 | 检索结果数 |
| 上下文窗口 | `context_window` | "最近 5 轮对话" |
| 记忆过期 | `_evict_expired` | 过期条目数 |
| 向量相关性 | `relevance_score` | 每条的相似度分数条 |

### 2.4 推理阶段详情面板

基于 [base_llm.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/components/reasoning/llm/base_llm.py)：

| 字段 | 来源 | 展示 |
|------|------|------|
| 模型名称 | `model` | 模型标签 |
| Temperature | `temperature` | 数值 |
| Max Tokens | `max_tokens` | 数值 |
| 是否使用模板 | `template_used` | 布尔标记 |
| 是否启用工具 | `has_tools` | 布尔标记 |
| 流式输出进度 | `STREAM` 事件 | 实时 Token 计数 |

### 2.5 工具调用详情面板

基于 [search.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/components/action/tools/search.py)、[calculator.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/components/action/tools/calculator.py)、[tool_adapter.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/adapters/tool_adapter.py)：

| 字段 | 来源 | 展示 |
|------|------|------|
| 工具名称 | `tool_name` | 工具图标 + 名称 |
| 调用参数 | `params` | JSON 视图 |
| 执行状态 | `status` (success/error) | 成功/失败图标 |
| 错误码 | `error_code` | 错误码标签 |
| 执行耗时 | `timeout_ms` | 耗时条形图 |
| 返回数据 | `data` | 结构化展示 |

---

## 三、必要的交互控件

### 3.1 运行控制栏

```
┌──────────────────────────────────────────────────────────────┐
│ [▶ 启动] [⏸ 暂停] [⏹ 终止] [🔄 重新开始]    Session: xxx │
└──────────────────────────────────────────────────────────────┘
```

| 控件 | 功能 | 对应后端接口 |
|------|------|------------|
| 启动按钮 | 发起 `process_request` / `stream_request` | `Coordinator.process_request()` |
| 暂停按钮 | 暂停流式输出（前端侧暂停渲染） | 前端本地控制 |
| 终止按钮 | 中断请求，发送取消信号 | 需后端支持 |
| 重新开始 | 重置 Session，清空对话 | 新 session_id |

### 3.2 参数调整面板（侧边栏或弹窗）

基于 [runtime_config.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/config/runtime_config.py) 的完整配置项：

| 参数 | 控件类型 | 默认值 | 范围 | 代码依据 |
|------|---------|-------|------|---------|
| Temperature | 滑块 | 0.7 | 0.0-2.0 | `LLMCallSchema.__post_init__` |
| Max Tokens | 数字输入 | 512 | 1-4096 | `LLMCallSchema.__post_init__` |
| 推理最大迭代 | 数字输入 | 3 | 1-10 | `max_reasoning_iterations` |
| 格式重试次数 | 数字输入 | 2 | 0-5 | `max_format_retries` |
| 工具超时(ms) | 数字输入 | 3000 | 500-30000 | `default_timeout_ms` |
| 敏感度阈值 | 滑块 | 5 | 0-5 | `sensitivity_threshold` |
| 推理引擎选择 | 下拉选择 | qwen | qwen/gpt | `default_provider` |
| 记忆上下文窗口 | 下拉选择 | last_5_turns | 1-20 | `context_window` |
| Prompt 模板 | 文本输入 | "" | 自由文本 | `prompt_template` |

### 3.3 日志筛选条件

基于 [message_bus.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/orchestration/communication/message_bus.py) 的 `get_event_log()` 方法：

| 筛选条件 | 控件类型 | 可选值 |
|---------|---------|-------|
| 事件域 | 多选标签 | PERCEPTION/REASONING/MEMORY/ACTION/FEEDBACK/TOOL |
| 事件动作 | 多选标签 | QUERY/UPDATE/ANALYZE/EXECUTE/INVOKE/GENERATE/STREAM |
| 优先级 | 多选标签 | LOW/NORMAL/HIGH/CRITICAL |
| 会话 ID | 下拉选择 | 当前活跃 Session |
| 时间范围 | 日期范围选择 | 起止时间 |
| 关键字搜索 | 文本输入 | 自由文本搜索 |

### 3.4 组件管理控件

基于 [registry.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/core/registry.py) 的 `swap_component()` 和 `list_all()`：

| 控件 | 功能 |
|------|------|
| 组件列表视图 | 展示 10 类组件的注册状态 |
| 引擎切换按钮 | 一键切换 qwen ↔ gpt |
| 工具启用/禁用开关 | 启用/禁用 search_engine、calculator |
| 组件注册表单 | 动态注册新的工具/感知器 |

---

## 四、数据可视化需求

### 4.1 Agent 执行流程图（ReAct 循环可视化）

基于 [coordinator.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/orchestration/coordinator.py) 的完整处理流程，建议使用 **实时流程图** 展示：

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ ①用户输入 │───▶│ ②感知处理 │───▶│ ③记忆查询 │───▶│ ④LLM推理 │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                     │               │               │
                     │               │         ┌─────▼─────┐
                     │               │    ┌───▶│ 工具调用   │
                     │               │    │    └─────┬─────┘
                     │               │    │    ┌─────▼─────┐
                     │               │    └────│ 结果注入   │
                     │               │         └─────┬─────┘
                     │               │               │
                     ▼               ▼               ▼
              ┌──────────────────────────────────────────┐
              │          ⑤ 输出生成 → ⑥ 记忆更新          │
              └──────────────────────────────────────────┘
```

**实现要求**：
- 当前激活阶段高亮闪烁
- 每个阶段显示耗时
- 工具调用显示迭代轮次（第 X/3 轮）
- 异常分支（敏感度熔断、LLM 失败、工具超时）用红色虚线标注
- 支持点击节点查看详细信息

### 4.2 状态转换图（事件驱动）

基于 [protocol.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/orchestration/communication/protocol.py) 的 `EventDomain` 和 `EventAction` 组合，建议使用 **力导向图** 展示事件流转：

```
  PERCEPTION ──ANALYZE──▶ MEMORY ──QUERY──▶ REASONING ──GENERATE──▶ ACTION
                              │                    │                    │
                              └──UPDATE──┐    ┌───STREAM──┐       ┌───EXECUTE
                                         ▼    ▼            ▼       ▼
                                      FEEDBACK ◀──────── TOOL ──INVOKE
```

**实现要求**：
- 节点大小表示事件频率
- 连线粗细表示事件流转量
- 支持时间轴回放功能

### 4.3 性能指标图表

基于 [base_llm.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/components/reasoning/llm/base_llm.py) 的 Token 统计和 [tool_adapter.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/adapters/tool_adapter.py) 的超时监控：

| 图表类型 | 展示内容 | 数据来源 |
|---------|---------|---------|
| 折线图 | Token 消耗趋势（每次请求） | `usage.total_tokens` |
| 柱状图 | 各阶段耗时分布 | Perception/Memory/Reasoning/Tool 耗时 |
| 饼图 | 工具调用成功率 | `status: success/error` 比例 |
| 热力图 | 工具调用频率分布 | 工具名 × 时间段 |
| 仪表盘 | 敏感度触发频率 | `sensitivity_level` 统计 |
| 散点图 | 记忆检索相关性分布 | `relevance_score` |

### 4.4 实时日志流

基于 [message_bus.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/orchestration/communication/message_bus.py) 的事件日志系统：

```
┌──────────────────────────────────────────────────────┐
│ [PERCEPTION] 12:00:01.234  ANALYZE   sensitivity=0   │
│ [MEMORY]     12:00:01.456  QUERY     has_history=true │
│ [REASONING]  12:00:01.789  GENERATE  has_tools=true  │
│ [TOOL]       12:00:02.123  INVOKE    tool=calculator │
│ [TOOL]       12:00:02.456  EXECUTE   status=success  │
│ [ACTION]     12:00:02.789  EXECUTE   tool_count=1    │
└──────────────────────────────────────────────────────┘
```

### 4.5 组件注册状态矩阵

基于 [registry.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/core/registry.py) 的 `list_all()` 方法：

```
┌──────────────────────┬───────────────────────────────┬──────────┐
│ 组件类别              │ 已注册组件                     │ 状态     │
├──────────────────────┼───────────────────────────────┼──────────┤
│ 推理引擎              │ qwen, gpt                     │ ● active │
│ 推理策略              │ (空)                          │ ○ 未注册 │
│ 行动执行器            │ sync                          │ ● active │
│ 工具                  │ search_engine, calculator     │ ● active │
│ 记忆                  │ short_term, long_term         │ ● active │
│ 存储适配器            │ (空)                          │ ○ 未注册 │
│ 感知器                │ text_preprocessor             │ ● active │
│ 传感器                │ (空)                          │ ○ 未注册 │
│ 反馈循环              │ (空)                          │ ○ 未注册 │
│ 进化信号              │ (空)                          │ ○ 未注册 │
└──────────────────────┴───────────────────────────────┴──────────┘
```

---

## 五、异常状态的展示与处理机制

### 5.1 错误分类体系

基于 `ErrorCode` 类（[protocol.py:L191-203](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/orchestration/communication/protocol.py#L191-L203)）和各类组件中的异常处理：

| 错误码 | 来源 | 触发条件 | 严重级别 | 前端展示 | 用户操作 |
|-------|------|---------|---------|---------|---------|
| `PERCEPTION_002` | coordinator.py L67-75 | 敏感内容检测 | 🔴 CRITICAL | 红色警告卡片 + 原因说明 | 修改输入重试 |
| `PERCEPTION_001` | schemas.py L19 | 输入类型无效 | 🟡 WARNING | 黄色提示 | 修正输入类型 |
| `LLM_001` | coordinator.py L137 | LLM 生成失败 | 🔴 CRITICAL | 错误弹窗 + 重试按钮 | 切换引擎/重试 |
| `LLM_002` | 预留 | 流式输出错误 | 🔴 CRITICAL | 错误弹窗 | 切换非流式模式 |
| `TOOL_001` | tool_adapter.py L33 | 工具参数无效 | 🟡 WARNING | 内联错误提示 | 检查参数格式 |
| `TOOL_002` | tool_adapter.py L52 | 工具超时/异常 | 🟠 ERROR | 超时警告卡片 | 调整超时时间/重试 |
| `MEMORY_101` | storage_adapter.py L55 | 上下文超限 | 🟡 WARNING | 黄色提示 | 减小上下文窗口 |
| `MEMORY_102` | storage_adapter.py L49 | 必填字段缺失 | 🟡 WARNING | 黄色提示 | 补充字段 |
| `BUS_001` | 预留 | 事件总线错误 | 🟠 ERROR | 错误提示 | 重启服务 |
| `CONSENSUS_001` | consensus.py L22 | 共识参与者不足 | 🟡 WARNING | 提示信息 | 添加参与者 |
| `CONSENSUS_002` | consensus.py L35 | 未达法定人数 | 🟠 ERROR | 错误提示 | 检查参与者状态 |
| `DELEGATION_001` | delegation.py L28 | 无匹配委托域 | 🟡 WARNING | 提示信息 | 注册委托处理器 |
| `DELEGATION_002` | delegation.py L37 | 委托执行异常 | 🟠 ERROR | 错误提示 | 检查处理器 |

### 5.2 异常处理交互机制

**5.2.1 敏感度熔断**（[coordinator.py:L64-76](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/orchestration/coordinator.py#L64-L76)）：
- 前端检测到 `PERCEPTION_SENSITIVITY_REJECTED` 时，立即停止所有处理流程
- 展示红色警告卡片："检测到敏感内容，请求已被拦截"
- 显示敏感度等级（0-5）和建议修改方向
- 提供"忽略风险继续"按钮（需管理员权限）

**5.2.2 LLM 引擎失败**（[coordinator.py:L137](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/orchestration/coordinator.py#L137)）：
- 前端展示错误模态框，包含错误信息、Trace ID
- 提供"切换引擎"快速操作（qwen ↔ gpt）
- 提供"重试"按钮
- 自动建议：降低 Temperature、减少 Max Tokens

**5.2.3 工具调用超时**（[tool_adapter.py:L48-53](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/adapters/tool_adapter.py#L48-L53)）：
- 内联展示超时警告
- 显示当前超时设置和实际耗时
- 提供"增加超时时间"快捷操作
- 提供"跳过此工具"按钮

**5.2.4 格式重试超限**（[coordinator.py:L171-178](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/orchestration/coordinator.py#L171-L178)）：
- 当 `max_format_retries` 耗尽时，降级为直接回复
- 前端展示黄色提示："工具调用格式修正失败，已切换为直接回复模式"
- 显示每次重试的解析错误详情

**5.2.5 ReAct 迭代上限**（[coordinator.py:L198-203](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/orchestration/coordinator.py#L198-L203)）：
- 当达到 `max_reasoning_iterations` 时强制输出
- 前端展示橙色提示："已达到最大推理轮次（3轮），强制输出当前结果"
- 显示每轮的工具调用摘要

### 5.3 全局异常处理策略

```
┌─────────────────────────────────────────────────────────┐
│  异常处理层级：                                          │
│  L1: 组件级异常 → 内联错误提示 + 自动恢复建议              │
│  L2: 阶段级异常 → 阶段状态卡片变红 + 跳过/重试按钮         │
│  L3: 请求级异常 → 错误模态框 + 完整诊断信息 + Trace ID     │
│  L4: 系统级异常 → 全局通知条 + 服务状态指示器              │
└─────────────────────────────────────────────────────────┘
```

---

## 六、界面布局建议及用户体验优化方向

### 6.1 推荐整体布局方案

```
┌─────────────────────────────────────────────────────────────────────┐
│  TOP BAR: 全局运行状态栏（阶段进度条 + 状态指示灯 + 关键指标）        │
├──────────────────────────────────────────┬──────────────────────────┤
│                                          │                          │
│  ┌────────────────────────────────────┐  │  SIDEBAR (右侧):         │
│  │                                    │  │  ┌────────────────────┐  │
│  │   对话视图 (Chat View)              │  │  │ 运行控制面板        │  │
│  │   - 用户消息气泡                    │  │  │ [▶启动][⏸暂停][⏹终止]│  │
│  │   - AI 回复（流式渲染）              │  │  │ Session 信息        │  │
│  │   - 思考过程折叠块                  │  │  └────────────────────┘  │
│  │   - 工具调用卡片                    │  │  ┌────────────────────┐  │
│  │   - 错误提示                        │  │  │ 参数调整面板        │  │
│  │                                    │  │  │ Temperature 滑块    │  │
│  │                                    │  │  │ Max Tokens 输入     │  │
│  │                                    │  │  │ 引擎选择 下拉       │  │
│  │                                    │  │  │ ...更多             │  │
│  └────────────────────────────────────┘  │  └────────────────────┘  │
│  ┌────────────────────────────────────┐  │  ┌────────────────────┐  │
│  │ 输入区域 (ChatInput)                 │  │  │ 组件注册状态        │  │
│  │ [文本输入框] [发送] [附件]            │  │  │ 10类组件状态矩阵    │  │
│  └────────────────────────────────────┘  │  └────────────────────┘  │
│                                          │                          │
├──────────────────────────────────────────┴──────────────────────────┤
│  BOTTOM PANEL: 可切换标签页                                         │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ [执行流程图] [事件日志] [性能指标] [记忆浏览器] [配置对比]         ││
│  │                                                                  ││
│  │  当前标签页内容区域                                               ││
│  │                                                                  ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 各区域详细设计

**6.2.1 顶部状态栏（固定 48px）**

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🟢 Running │ Perception → Memory → Reasoning → Tool → Action → Done │
│            │        ████████░░░░░░░░░░░░░░░░░░ 40%                   │
│ Trace: abc-123 │ Session: demo_001 │ Model: qwen-max │ Tokens: 1,234 │
└──────────────────────────────────────────────────────────────────────┘
```

**6.2.2 对话视图（主区域，约 60% 宽度）**

消息类型映射（基于 [agui_adapter.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/orchestration/communication/agui_adapter.py)）：

| SSE 事件 | 前端渲染组件 |
|---------|------------|
| `TEXT_MESSAGE_START/CONTENT/END` | 流式文字气泡，逐字渲染 |
| `THINKING_START/CONTENT/END` | 折叠式思考块，默认展开，可折叠 |
| `TOOL_CALL_START/ARGS/END` | 工具调用卡片（显示工具名、参数 JSON） |
| `TOOL_CALL_RESULT` | 工具结果卡片（显示返回数据，成功/失败标识） |
| `RUN_ERROR` | 红色错误提示卡片 |

**6.2.3 右侧边栏（约 30% 宽度，可折叠）**

多级折叠面板：
1. **运行控制** → 启动/暂停/终止按钮 + Session 管理
2. **参数调整** → 所有可配置参数的表单控件
3. **组件状态** → 10 类组件的注册状态矩阵
4. **引擎信息** → 当前引擎详情 + 切换操作

**6.2.4 底部面板（约 35% 高度，可拖拽调整）**

5 个标签页：

| 标签页 | 内容 | 通信协议 |
|-------|------|---------|
| 执行流程图 | 实时 ReAct 流程图 | `STATE_SNAPSHOT/DELTA` 事件 |
| 事件日志 | 过滤后的事件流表格 | `EventBus.get_event_log()` |
| 性能指标 | 图表仪表盘 | 客户端聚合计算 |
| 记忆浏览器 | 短期/长期记忆内容查看 | `Memory.query()` 接口 |
| 配置对比 | 当前配置 vs 默认配置 | `RuntimeConfig.as_dict()` |

### 6.3 用户体验优化方向

**6.3.1 流式体验优化**
- 基于 [streaming.py](file:///c:/Users/HS/Desktop/pioneering/python-backend/ModuAgent/orchestration/communication/streaming.py) 的 `SSEEncoder`，每 10 个 token 发布一次进度事件
- 前端实现 **逐字打字效果**（使用 `requestAnimationFrame` 控制渲染帧率）
- 思考过程（`THINKING_START/END`）使用 **可折叠块**，默认展开，减少视觉干扰

**6.3.2 工具调用可视化**
- 工具调用卡片使用 **动画展开效果**，显示"正在执行..."的加载状态
- 工具结果使用 **代码高亮** 展示 JSON 数据
- 工具调用耗时使用 **进度条动画** 展示（基于 `timeout_ms`）

**6.3.3 键盘快捷键**

| 快捷键 | 功能 |
|-------|------|
| `Ctrl+Enter` | 发送消息 |
| `Ctrl+Shift+P` | 切换参数面板 |
| `Ctrl+Shift+L` | 切换日志面板 |
| `Ctrl+Shift+F` | 切换流程图 |
| `Escape` | 终止当前请求 |
| `Ctrl+K` | 清空对话 |

**6.3.4 多 Session 管理**
- 基于 `session_id` 实现多会话标签页
- 每个标签页独立维护对话历史和状态
- 支持会话导出（JSON 格式，包含完整对话记录）

**6.3.5 暗色模式**
- 支持亮色/暗色主题切换
- 代码块和 JSON 数据在暗色模式下使用适配的语法高亮配色

**6.3.6 响应式适配**
- 右侧边栏在小屏幕下变为底部抽屉
- 底部面板在小屏幕下变为全屏覆盖层
- 对话视图始终占据最大可用空间

**6.3.7 性能优化**
- 事件日志使用虚拟滚动（基于 `max_log_size=1000`）
- 对话历史使用虚拟列表
- 图表使用 Web Worker 进行数据聚合
- SSE 连接使用断线重连机制

---

## 七、技术实现建议

### 7.1 SSE 事件消费架构

```typescript
// 前端 SSE 消费者，对应后端 AGUIStreamAdapter 的输出
interface SSEConsumer {
  // 连接生命周期
  onRunStarted(threadId: string, runId: string): void;
  onRunFinished(threadId: string, runId: string): void;
  onRunError(code: string, message: string): void;

  // 文本消息
  onTextMessageStart(messageId: string): void;
  onTextMessageContent(messageId: string, delta: string): void;
  onTextMessageEnd(messageId: string): void;

  // 思考过程
  onThinkingStart(title: string): void;
  onThinkingContent(delta: string): void;
  onThinkingEnd(): void;

  // 工具调用
  onToolCallStart(toolCallId: string, toolName: string): void;
  onToolCallArgs(toolCallId: string, delta: string): void;
  onToolCallEnd(toolCallId: string): void;
  onToolCallResult(toolCallId: string, toolName: string, content: string): void;

  // 状态
  onStateSnapshot(state: AgentState): void;
  onStateDelta(delta: Partial<AgentState>): void;
}
```

### 7.2 前端状态管理

```typescript
interface AgentRunState {
  // 运行状态
  phase: 'idle' | 'perception' | 'memory' | 'reasoning' | 'tool' | 'action' | 'done' | 'error';
  status: 'running' | 'paused' | 'completed' | 'error';

  // 标识
  traceId: string;
  sessionId: string;
  userId: string;

  // 感知阶段
  perception: {
    inputType: string;
    detectedLanguage: string | null;
    confidence: number;
    sensitivityLevel: number;
    truncated: boolean;
    originalLength: number;
  } | null;

  // 记忆阶段
  memory: {
    historyCount: number;
    knowledgeCount: number;
    contextWindow: string;
  } | null;

  // 推理阶段
  reasoning: {
    model: string;
    temperature: number;
    maxTokens: number;
    tokensUsed: number;
    iteration: number;
    maxIterations: number;
    formatRetries: number;
    maxFormatRetries: number;
  } | null;

  // 工具调用
  toolCalls: Array<{
    toolName: string;
    params: Record<string, unknown>;
    status: 'pending' | 'success' | 'error';
    errorCode: string;
    data: Record<string, unknown>;
    duration: number;
  }>;

  // 消息
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string;
    thinking?: string;
    toolCalls?: ToolCallRecord[];
    timestamp: string;
  }>;

  // 配置
  config: RuntimeConfig;

  // 组件注册状态
  registry: ComponentRegistrySnapshot;
}
```

### 7.3 技术栈建议

| 层面 | 推荐方案 | 理由 |
|------|---------|------|
| 框架 | React 18+ / Vue 3 | 与现有前端项目一致 |
| 状态管理 | Zustand / Pinia | 轻量级，适合实时状态更新 |
| SSE 客户端 | EventSource API + 自定义重连 | 原生支持，配合后端 SSE 流 |
| 流程图 | ReactFlow / Mermaid | 支持交互式节点和动画 |
| 图表 | ECharts / Recharts | 丰富的图表类型 |
| 虚拟滚动 | @tanstack/virtual | 处理大量日志和对话 |
| 代码高亮 | Shiki / Prism | JSON 和代码展示 |
| 动画 | Framer Motion | 流式文字和卡片动画 |

---

## 八、总结

本设计方案基于 ModuAgent 的 **84 个源文件** 深度分析，覆盖了从核心接口层到具体实现的完整技术栈。前端界面设计遵循以下原则：

1. **状态透明化**：Agent 的每个内部阶段（Perception → Memory → Reasoning → Tool → Action）都有对应的可视化展示
2. **实时性优先**：基于 SSE 流式协议，实现逐字渲染、实时进度更新
3. **可操作性强**：用户可随时调整参数、切换引擎、控制运行状态
4. **异常处理完善**：覆盖 12 种错误码，提供分级处理和恢复建议
5. **开发友好**：底部面板提供日志、性能、记忆浏览器等调试工具

该方案确保前端界面能够 **准确反映并有效支持** ModuAgent 的完整运行过程，同时提供良好的用户体验和开发者体验。