# ModuAgent 现状分析（2026-06-23）

基于对 `apps\backend\Python-backend\ModuAgent` 代码的深度阅读，以下是当前 Agent 的完整业务流程分析，以及感知层实现与问题的详细说明。

***

## 一、当前 Agent 完整业务流程

整体流程由 `orchestration/coordinator.py` 的 `Coordinator.process_request` 串接，遵循 **感知 → 记忆 → 推理/规划/决策 → 执行 → 记忆更新/事件反馈** 的循环。

### 1. 感知（Perception）

- 入口：`coordinator.py` L38-L80
- 从配置读取 `perception.default_processor`（默认 `text_preprocessor`），从 `core/registry.py` 获取感知组件。
- 将 `input_data.prompt` 编码为 `bytes` 后调用 `perceive(input_type, raw_content, sensitivity_level)`。
- 对检测到的敏感度 `sensitivity_level` 与阈值比较，触发熔断则直接返回错误。
- 最终提取 `parsed_content.text` 作为后续 LLM 的 `prompt`；若感知失败或未注册，则回退到原始 `prompt`。

### 2. 记忆（Memory）

- 入口：`coordinator.py` L82-L104
- 通过 `adapters/storage_adapter.py` 的 `query_all` 同时查询：
  - **短期记忆**：默认 `components/memory/cache/redis_adapter.py` 的 `InMemoryShortTermMemory`（实际为进程内 Dict，非 Redis），按 `last_N_turns` 返回最近对话。
  - **长期记忆**：默认 `components/memory/vector/chroma.py` 的 `ChromaLongTermMemory`，基于向量相似度检索历史知识。
- 结果注入 `context["history"]` 和 `context["knowledge"]`，供推理使用。

### 3. 推理 / 规划 / 决策（Reasoning & Planning）

- 入口：`coordinator.py` L117-L161
- 通过 `adapters/llm_adapter.py` 调用注册的推理引擎（如 `components/reasoning/llm/glm.py`）。
- `components/reasoning/llm/base_llm.py` 构建 messages：
  - system prompt
  - memory\_context
  - tool\_descriptions（或 native `tools`）
  - history
  - 当前 user prompt
- 支持两种工具调用方式：
  1. **原生 Function Calling**：LLM 返回 `tool_calls`，由 `BaseLLMReasoner` 解析。
  2. **文本 Tool Call**：通过正则 `tool_call\n{...}\n` 解析，`coordinator.py` L745-L764。
- 如果产生工具调用，进入 **ReAct 循环**（最多 `max_reasoning_iterations`，默认 3 次）：
  - 解析 tool\_calls
  - 调用工具
  - 将 observation 拼入 history
  - 再次请求 LLM 继续推理
  - 格式错误时支持 `max_format_retries` 次自纠正。

### 4. 执行（Action）

- 入口：`coordinator.py` L163-L219
- 由 `adapters/tool_adapter.py` 执行：
  - 按名称从 registry 查找工具
  - 校验 JSON Schema 参数类型
  - 通过 `ThreadPoolExecutor` 在线程池中调用 `tool.invoke`，支持超时控制
- 当前内置工具：
  - `calculator.py`：安全数学表达式求值。
  - `search.py`：DuckDuckGo / Tavily 搜索。
  - `api_client.py`：当前为空。
- `components/action/executors/synchronous.py` 提供同步执行器，但主流程实际通过 `ToolAdapter` 直接调用，未经过 action executor。

### 5. 反馈 / 记忆更新 / 进化

- 记忆更新：流程结束后异步调用 `StorageAdapter.update_all`，将本轮 `prompt`、`tool_calls`、`response` 写入短期记忆，并向量化后写入 Chroma 长期记忆。`coordinator.py` L221-L245
- 事件总线：通过 `orchestration/communication/message_bus.py` 发布 PERCEPTION、MEMORY、REASONING、TOOL、ACTION 等事件，用于观测与后续扩展。
- 反馈与进化：`feedback/` 与 `evolution/` 目录下多个文件（如 `loop_controller.py`、`quality_monitor.py`、`component_swap.py`、`parameter_tune.py`）**当前为空**，反馈循环和自动进化机制尚未落地。

***

## 二、感知层是怎么感知的

当前唯一实际可用的感知组件是 `components/perception/text/rule_based.py` 的 `TextPreprocessor`，其 `perceive` 方法执行以下步骤：

1. **类型过滤**：仅接受 `input_type == "text"`，其他类型直接返回 `unsupported input type`。
2. **解码与截断**：`raw_content.decode("utf-8")`，失败则用 `errors="replace"`；按 `max_length`（默认 2048）截断。
3. **Unicode 归一化**：`unicodedata.normalize("NFKC", text)` 并 `strip()`。
4. **语言检测**：统计 CJK 与 Latin 字符数量，CJK 多则判为 `zh`，Latin 多则判为 `en`，否则 fallback 到构造参数 `_language`。
5. **敏感词检测**：用 `_DEFAULT_SENSITIVITY_PATTERNS` 中的正则匹配文本，命中任意一个即返回敏感度 `5`，否则 `0`。
6. **返回结构化结果**：

```python
{
    "parsed_content": {"input_type": "text", "text": text},
    "detected_language": "...",
    "confidence": 1.0,
    "metadata": {"sensitivity_level": ..., "truncated": ..., "original_length": ...}
}
```

***

## 三、感知层存在的问题

### 1. 多模态感知基本未实现

- `components/perception/text/llm_parser.py`、`vision/camera.py`、`vision/image_processor.py` 均为空文件。
- 配置 `schemas.py` 虽然声明支持 `text/image/audio`，但实际 `TextPreprocessor` 对非 text 直接拒绝。

### 2. 感知深度不足，停留在"清洗"而非"理解"

当前只做解码、截断、简单语言判定、敏感词匹配，缺少：

- 意图识别（Intent Classification）
- 命名实体抽取（NER）
- 情感/情绪检测
- 输入质量评估（是否模糊、是否缺少必要参数）
- 语种混淆处理

`confidence` 恒为 `1.0`，没有真实置信度，无法让下游做不确定性处理。

### 3. 语言检测算法粗糙

- 仅通过 Unicode 区间统计字符数，遇到中英混合、日文、韩文、阿拉伯文、emoji 密集文本会误判或 fallback 失真。
- 没有语种模型或更鲁棒的启发式规则。

### 4. 敏感词检测简单粗暴，误伤率高

- 正则列表固定（`rule_based.py` L14-L21）：
  - `password` 会命中 `passwordless`
  - `银行卡` 会命中任何提及该词的句子（如"我忘记了银行卡密码"与"帮我查银行卡余额"都被判为敏感）
- 敏感度只有 `0` 和 `5` 两级，没有细粒度分级。
- 缺少上下文语义判断，容易被绕过（如拼音、同音字、拆分）。

### 5. 安全防护面窄

只有关键词级别的敏感检测，缺少：

- Prompt Injection / 越狱攻击检测
- 指令覆盖检测
- XSS、SQL、命令注入等安全清洗
- 个人隐私信息（PII）结构化识别（手机号、身份证号、银行卡号等模式匹配）

### 6. 截断策略生硬

- 超过 `max_length` 后直接按字符截断，可能导致语义断裂、JSON/HTML 结构破坏、实体被切开。

### 7. 感知结果未被下游充分利用

- `coordinator.py` L38-L80 只使用 `parsed_content.text`，`detected_language`、`confidence`、`metadata` 没有进入 LLM context 或 event metadata。
- 这意味着感知层即使检测出高风险或低置信度，也不会影响后续推理策略。

### 8. `BaseSensor` 接口闲置

- `core/interfaces/perception.py` L15-L26 定义了 `BaseSensor`，但 `Coordinator` 和 registry 都没有将其集成到主流程中，无法支持主动感知（如定时抓取、摄像头、麦克风）。

### 9. 缺乏输入路由与多感知融合

- 配置中 `default_processor = "text_preprocessor"` 是写死的，没有根据 `input_type` 动态选择感知器。
- 多路感知结果没有融合机制。

### 10. 编码与清洗细节问题

- `UnicodeDecodeError` 时使用 `errors="replace"` 会引入 \`\`，但没有标记或告警，可能把乱码送入 LLM。
- 缺少对控制字符、零宽字符、重复字符、过度大写等噪声的清洗。

### 11. 事件追踪信息不完整

- 感知事件只记录了 `input_type`、`sensitivity_level`、`truncated`，未记录 `detected_language`、`confidence`、`original_length` 等，不利于后续可观测性与进化信号生成。

***

## 总结

当前 `ModuAgent` 的感知层是一个**轻量级的文本预处理层**，主要完成字符解码、截断、简单语言判定和关键词级敏感检测。它在工程上完成了"把原始输入转成干净文本"的职责，但距离真正的 Agent 感知能力还有明显差距：**多模态缺失、语义理解不足、安全防护单薄、感知结果未驱动下游决策**。如果要在生产环境中使用，建议优先补齐多模态感知器、引入基于 LLM/分类器的意图与敏感内容识别，并将感知元信息（语言、置信度、风险等级）显式注入推理上下文。
