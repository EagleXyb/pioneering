# 任务清单：ModuAgent 高紧迫度重构

## 任务一：补齐 feedback 模块

### 1.1 实现 `feedback/evolution_signal.py` - 进化信号收集器
- [x] 定义 `EvolutionSignal` 数据类
- [x] 实现 `EvolutionSignalCollector` 类
- [x] 实现 `on_agent_event()` EventBus 订阅回调
- [x] 实现 `get_signals()` 信号查询方法

### 1.2 实现 `feedback/quality_monitor.py` - 质量监控器
- [x] 实现 `QualityMonitor` 类
- [x] 实现 `evaluate()` 规则评估方法
- [x] 实现 `_check_relevance()` 相关性检查
- [x] 实现 `_check_completeness()` 完整性检查

### 1.3 实现 `feedback/metrics/accuracy.py` - 准确性指标
- [x] 实现 `AccuracyMetrics` 类
- [x] 实现 `calculate()` 工具成功率计算
- [x] 计算平均执行时间和错误率

### 1.4 实现 `feedback/metrics/efficiency.py` - 效率指标
- [x] 实现 `EfficiencyMetrics` 类
- [x] 实现 `calculate()` token 效率计算
- [x] 实现迭代效率计算
- [x] 实现吞吐量计算

### 1.5 实现 `feedback/loop_controller.py` - 反馈循环控制器
- [x] 实现 `FeedbackLoop` 类继承 `BaseFeedbackLoop`
- [x] 实现 `evaluate()` 评估方法
- [x] 实现 `should_evolve()` 进化判断方法
- [x] 集成 `QualityMonitor` 和 `AccuracyMetrics`

---

## 任务二：补齐 evolution 模块

### 2.1 实现 `evolution/registry/versioned_store.py` - 版本化存储
- [x] 实现 `VersionedComponentStore` 类
- [x] 实现 `save_version()` 版本保存
- [x] 实现 `get_version()` 版本获取
- [x] 实现 `list_versions()` 版本列表
- [x] 实现 `get_latest_version()` 最新版本查询

### 2.2 实现 `evolution/registry/rollback_mechanism.py` - 回滚机制
- [x] 实现 `RollbackMechanism` 类
- [x] 实现 `record_and_check()` 质量记录与检查
- [x] 实现 `rollback_to_version()` 回滚方法
- [x] 集成 `VersionedComponentStore` 和 `ComponentRegistry`

### 2.3 实现 `evolution/strategy/parameter_tune.py` - 参数调优策略
- [x] 实现 `ParameterTuneStrategy` 类
- [x] 实现 `analyze_and_adjust()` 参数调整
- [x] 定义温度和迭代次数调整规则
- [x] 集成 `EvolutionSignalCollector`

### 2.4 实现 `evolution/strategy/component_swap.py` - 组件热替换策略
- [x] 实现 `ComponentSwapStrategy` 类
- [x] 实现 `should_swap()` 切换判断
- [x] 实现 A/B 性能对比逻辑
- [x] 集成 `ComponentRegistry` 和 `EvolutionSignalCollector`

---

## 任务三：补齐 langgraph 缺失能力

### 3.1 增强 `langgraph/nodes.py` - 低置信度保守模式
- [x] 修改 `make_agent_node()` 支持动态 temperature
- [x] 添加 `confidence_threshold` 参数
- [x] 添加 `conservative_temperature` 参数
- [x] 实现置信度检测与温度切换逻辑

### 3.2 新增 `langgraph/nodes.py` - 记忆更新节点
- [x] 实现 `memory_update_node()` 函数
- [x] 从 messages 提取对话历史
- [x] 调用 Store.put() 写入长期记忆
- [x] 返回更新结果状态

### 3.3 增强 `langgraph/nodes.py` - 响应节点
- [x] 修改 `response_node()` 返回完整结构
- [x] 包含 response/tool_results/usage
- [x] 处理熔断错误码

### 3.4 增强 `langgraph/adapters/event_bridge.py` - SSE 细粒度事件
- [x] 添加 `thinking` 事件映射
- [x] 添加 `tool_call_start` 事件映射
- [x] 添加 `tool_result` 事件映射
- [x] 集成 `EvolutionSignalCollector`
- [x] 实现 `_emit_sse_events()` SSE 事件发送

---

## 任务四：收敛双轨（删除 Coordinator）

### 4.1 验证前置条件
- [ ] langgraph 版本通过 `examples/single_agent.py` 功能验证
- [ ] feedback/evolution 模块通过单元测试
- [ ] `create_agent()` 支持所有 legacy 配置

### 4.2 删除 coordinator.py
- [ ] 删除 `orchestration/coordinator.py`
- [ ] 更新 `orchestration/__init__.py` 移除 Coordinator 导出

### 4.3 简化 `langgraph/runner.py`
- [ ] 移除 `get_runner()` 的 legacy 分支
- [ ] 移除 `process_request_compat()` 兼容函数
- [ ] 移除 `stream_request_compat()` 兼容函数

### 4.4 更新 `examples/single_agent.py`
- [ ] 移除 legacy Coordinator 使用
- [ ] 仅保留 langgraph 版本示例

---

## 任务依赖关系

```
任务一 → 任务二（evolution 依赖 evolution_signal）
任务一+二 → 任务三（langgraph 增强依赖 feedback/evolution）
任务一+二+三 → 任务四（收敛双轨依赖全部完成）
```

## 备注

任务一、二、三已完成代码实现。任务四（删除 coordinator.py）需要实际运行测试验证后才能执行，当前为待验证状态。
