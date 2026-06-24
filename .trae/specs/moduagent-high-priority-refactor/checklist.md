# 检查清单：ModuAgent 高紧迫度重构

## 任务一：feedback 模块

### evolution_signal.py
- [x] `EvolutionSignal` dataclass 正确定义所有字段
- [x] `EvolutionSignalCollector.__init__()` 正确初始化计数器
- [x] `on_agent_event()` 正确解析 AgentEvent 并计数（None 输入也安全处理）
- [x] `get_signals()` 返回累积的进化信号列表

### quality_monitor.py
- [x] `QualityMonitor.evaluate()` 返回包含所有维度的评估结果
- [x] `_check_relevance()` 正确识别低相关性响应
- [x] `_check_completeness()` 正确识别不完整响应
- [x] 空响应返回 0 分

### metrics/accuracy.py
- [x] `AccuracyMetrics.calculate()` 正确计算工具成功率
- [x] 正确处理空 tool_results（返回 0）
- [x] 返回包含 success_rate/error_rate/avg_time 的字典

### metrics/efficiency.py
- [x] `EfficiencyMetrics.calculate()` 正确计算 token 效率
- [x] 正确处理空 usage 字典（返回 0）
- [x] 返回包含 token_efficiency/iteration_efficiency/tokens_per_second 的字典

### loop_controller.py
- [x] `FeedbackLoop.evaluate()` 集成 QualityMonitor 和 AccuracyMetrics
- [x] `should_evolve()` 正确判断是否触发进化（样本量 + 质量阈值）
- [x] 评估结果包含 relevance/completeness/accuracy/tool_effectiveness

---

## 任务二：evolution 模块

### registry/versioned_store.py
- [x] `save_version()` 正确保存版本快照到文件系统（支持 category/component 字段）
- [x] `get_version()` 正确读取指定版本
- [x] `list_versions()` 返回版本列表
- [x] `get_latest_version()` 返回最新版本号

### registry/rollback_mechanism.py
- [x] `record_and_check()` 正确记录质量得分
- [x] `rollback_to_version()` 正确恢复到指定版本（从 snapshot 获取 category/component）
- [x] 质量低于阈值时触发回滚

### strategy/parameter_tune.py
- [x] `analyze_and_adjust()` 正确分析进化信号（从 metrics/context 提取）
- [x] 低准确性时降低 temperature（< 0.6 → 降 0.1）
- [x] 高迭代次数时降低 max_iterations（> 10 → 降 2）
- [x] 返回参数调整建议字典

### strategy/component_swap.py
- [x] `should_swap()` 基于 A/B 测试结果判断
- [x] 正确记录性能历史
- [x] 候选版本得分 > 当前版本得分 + 阈值时返回 True（threshold 可配置）

---

## 任务三：langgraph 增强

### nodes.py - 低置信度模式
- [x] `make_agent_node()` 支持 `confidence_threshold` 参数（默认 0.5）
- [x] `conservative_temperature` 默认值为 0.3
- [x] 置信度低于阈值时使用保守温度（通过 bind(temperature=...) 动态调整）
- [x] 置信度正常时使用默认温度

### nodes.py - 记忆更新节点
- [x] `memory_update_node()` 正确提取对话历史
- [x] 调用 Store.put() 写入长期记忆（支持从 state["__store__"] 获取）
- [x] 处理 Store 为 None 的情况（返回 skipped_no_store）
- [x] 返回更新结果状态

### nodes.py - 响应节点
- [x] `response_node()` 返回完整响应结构
- [x] 包含 response/tool_results/usage/error_code
- [x] 正确处理熔断错误码

### adapters/event_bridge.py - SSE 细粒度事件
- [x] `_emit_sse_events()` 正确发射 thinking 事件
- [x] `_emit_sse_events()` 正确发射工具调用开始事件（tool_call_start）
- [x] `_emit_sse_events()` 正确发射工具结果事件（tool_result）
- [x] `EvolutionSignalCollector` 正确集成（constructor 参数 + consume 中调用）
- [x] 所有事件正确发布到 EventBus

---

## CI 测试验证
- [x] Python 语法检查全部通过（py_compile）
- [x] feedback 模块单元测试通过（13 tests）
- [x] evolution 模块单元测试通过（13 tests）
- [x] 现有系统测试全部通过（185 tests）
- [x] 总计：252 passed, 12 skipped（11个langchain依赖缺失跳过，1个原有skip）

---

## 任务四：收敛双轨（待验证后执行）
- [ ] langgraph 版本通过 `examples/single_agent.py` 功能验证（需安装 langchain 依赖）
- [ ] feedback/evolution 模块单元测试通过 ✅
- [ ] `create_agent()` 支持所有 legacy 配置
- [ ] 删除 `orchestration/coordinator.py`
- [ ] 简化 `langgraph/runner.py`
- [ ] 更新 `examples/single_agent.py`
