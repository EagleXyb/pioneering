# modu-agent 全面代码优化审查 Spec

## Why
P3-B/C/D 改造刚落地（场景包装配、权限全链路、evals 场景化），`packages/modu-agent` 现有 153 个 TS 源文件（约 1.45MB），尚无系统性优化审查。`graph/nodes.ts` 单文件达 119KB，存在明显结构热点。需要在下一轮迭代前完成一次全面审查，形成可执行的优化路线图。

## What Changes
- 产出一份完整的代码优化审查报告：`packages/docs/modu-agent代码优化审查报告.md`（与既有 `Agent架构分层解耦评估报告.md` 同目录、同风格）
- 审查范围覆盖全部 src 模块：core、config、graph（含 adapters、plan-execute、subgraph）、perception（含 security）、reasoning（含 llm、symbolic）、memory、tools、mcp、orchestration（含 communication、patterns）、feedback、evolution、observability、skills、kernel
- 本任务**不修改任何生产代码**，仅做只读分析 + 报告产出；报告中给出的实施步骤作为后续独立 spec 的输入

### 审查维度（用户指定）
1. **性能瓶颈**：同步阻塞调用、重复计算、N+1 式遍历、不必要的深拷贝/序列化、缓存缺失或失效
2. **内存使用效率**：无限增长的 Map/Array、未清理的定时器/监听器、大对象长期持有、闭包泄漏
3. **算法复杂度**：嵌套循环、O(n²) 及以上热点、低效查找（Array.includes 应为 Set/Map）
4. **安全性漏洞**：注入风险（SQL/命令/路径穿越）、密钥泄漏到日志、SSRF、不安全反序列化、权限绕过
5. **可读性**：变量命名、函数过长（>80 行）、圈复杂度过高、魔法数字、死代码
6. **可维护性**：重复代码、模块耦合、类型滥用（any/as any）、错误处理不一致
7. **可扩展性**：硬编码分支（应配置化/注册表化）、接口封闭、缺少扩展点

### 审查清单（用户指定，逐项检查）
- 变量命名规范
- 函数封装合理性（单一职责、参数个数、返回值语义）
- 异常处理机制（吞异常、catch 后无处理、Promise 未 catch、错误信息缺失上下文）
- 注释完整性（公共 API 缺 JSDoc、TODO/FIXME 遗留、误导性注释）
- 重复代码消除（跨文件复制粘贴、近似逻辑可抽取）
- 依赖管理优化（未使用依赖、重复依赖、peerDependency 合理性、可选依赖守卫）

## Impact
- Affected specs: 无既有 spec 受影响；报告结论将作为后续优化 spec 的输入
- Affected code: **只读审查，不改动任何 src/tests 代码**；唯一新增文件为 `packages/docs/modu-agent代码优化审查报告.md`
- 基线约束：审查全程不得破坏现有基线（tsc 零错误；vitest 898 passed / 7 failed，失败均为 better-sqlite3 环境问题）

## ADDED Requirements

### Requirement: 全模块覆盖审查
审查 SHALL 覆盖 `src/` 下全部 15 个模块目录及其子目录，每个文件至少被一个审查任务读取并评估；`graph/nodes.ts`、`graph/runner.ts`、`graph/factory.ts`、`core/registry.ts`、`orchestration/communication/agui-adapter.ts` 五个最大文件 SHALL 逐段深读。

#### Scenario: 覆盖完整性验证
- **WHEN** 报告完成后统计审查文件清单
- **THEN** 报告附录中列出全部已审查文件及各自至少一条"已检查"记录或"无问题"结论

### Requirement: 结构化问题记录
每一条发现 SHALL 包含五个字段：问题描述（含证据文件路径与行号）、严重程度、优化建议、实施步骤、预期效果。

#### Scenario: 单条问题可追溯
- **WHEN** 读者查看任一问题条目
- **THEN** 可通过 文件:行号 直接定位证据代码，且四个建议字段（建议/步骤/效果）齐备

### Requirement: 优先级排序
报告 SHALL 对全部关键优化点按 P0（立即修复：安全漏洞/正确性风险/严重性能问题）、P1（短期：明显收益且低风险）、P2（中期：结构改善/可维护性）三级排序，并给出建议实施顺序与依赖关系。

#### Scenario: 优先级可执行
- **WHEN** 团队按 P0→P1→P2 顺序领取任务
- **THEN** 每项均有明确实施步骤，无循环依赖

### Requirement: 基线不受影响
审查过程 SHALL 仅使用只读工具（Read/Grep/Glob）；报告产出后运行 `tsc` 与 `vitest` 验证基线未变。

#### Scenario: 回归基线一致
- **WHEN** 报告产出后执行 `pnpm -F @pioneering/modu-agent build` 与 `pnpm -F @pioneering/modu-agent test`
- **THEN** tsc 零错误；测试结果与审查前基线一致（898 通过 / 7 失败，失败项均为 better-sqlite3 环境问题）

## REMOVED Requirements
无。
