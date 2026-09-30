# modu-agent P0+P1 修复独立评审记录

- 评审对象：`.trae/specs/moduagent-p0-p1-remediation/`（spec.md / tasks.md）+ 全部代码改动
- 评审方法：AC 逐项映射、tsc/全量测试复跑、grep 门禁、变异测试抽验（临时回退修复→测试变红→恢复）
- 最终复跑：`tsc -p tsconfig.build.json` = 0 错误；`vitest run` = **1040 passed / 7 failed（88 files，87 绿）**；7 失败 = T0 基线同 7 项 better-sqlite3 环境失败。

## Review History

### R1（2026-09-30，实现完成后全量复核）
- 结果：**pass**（2 个变异抽验均被测试捕获；无阻塞发现；3 条 advisory 见末尾，不影响验收）

---

## AC 覆盖映射（逐项证据）

| AC | 覆盖任务 | 关键证据 | 结论 |
|---|---|---|---|
| AC-1 P0 闭环 | T1-T7 | registry.remove/PolicyEngine.remove 单测、guard 三连 PII 用例、15 个 IPv6 形态+URL 归一化端到端断言、逃逸链 PoC 被静态拒绝、4 用例幂等重放、5 用例合流/共存/window、7 用例 fail-closed | pass |
| AC-2 P1-A | T8-T13 | kernel rollback 3+边缘、host 边精确删除 3 用例、fail-closed 5 用例、loader 环 3 用例、path 越界 3 用例、config remove 5 用例 | pass |
| AC-3 结构闭环（6 安全） | T1/T2/T3/T4/T5/T7 | 同 AC-1；每修复点含"攻击负向+正常正向"双侧用例 | pass |
| AC-4 资源有界（8 项） | T14-T21 | LRU/versioned/signals/short-memory 边界断言、队列丢弃计数、SQL 下推纯函数、file-ops 256KB 字节级断言、preamble 平台守卫 | pass |
| AC-5 合流语义 | T7 + T18 | 单域/多域/全局合流矩阵 5 用例；批量落盘 23 事件不丢+domain/TTL 不回归 | pass |
| AC-6 基线不退化 | T34 | 失败集合 = 基线同 7 项同名同指纹；新增 142 个通过用例；tsc=0 | pass |
| AC-7 热路径最小改动 | T6,T31,T33 等 | diff 紧贴证据行；T31 纯日志+去重复 parse；T33 仅替换算法，输出契约不变 | pass |
| AC-8 无新增 any/ts-ignore | T34 grep | 新文件 as any=0；29 改动文件 @ts-ignore 仅 1 处既有的（factory.ts:181，非新增）；T17 还顺带消除 1 处 as any | pass |
| AC-9 边界压点 | T14-T18,T21 | 阈值+1/恰好阈值/空集合/超上限四态均有用例；POSIX rlimit 在 Windows 仅以生成内容断言（OQ-1 约定） | pass |
| AC-10 12 语义项 | T22-T33 | 12 项各有独立测试文件/用例；配置开关三态、哨兵、深拷贝、懒重连单飞均有断言 | pass |
| AC-11 tsc/vitest | T34 | TSC_EXIT=0；1040/1047 pass | pass |
| AC-12 变更最小 | T11,T13,T20 等 | file-ops 仅 read 分支 async；host/loader/config 复用既有工具；无无关文件改动 | pass |
| AC-13 测试对抗性 | 变异抽验 | 见下"变异测试"节：T6 回退→3 红；T3 回退→4 红 | pass |
| AC-14 变更留痕 | T34 tasks.md | 3 条 release note（指标 label、MCP 超时单位、安全默认值变更）已入 T34 证据 | pass |

---

## 规则/质量门禁复核

- **Rule 1（rule AC）**：AC-1..AC-14 均有可执行证据（本文件 + tasks.md 完成证据），无"仅文档声明"的修复。pass
- **Rule 2（rubric AC）**：
  - 安全向：负向用例均含攻击 payload（PoC 串、十六进制 IP、越界 `../../evil.js`、多手机号/身份证/银行卡）；正向用例覆盖公网 IP/普通代码/近期时间戳。pass
  - 最小改动：diff 限定在报告所列证据文件；未做夹带重构（graph/nodes.ts 仅蒸馏块移动，未夹带其他逻辑）。pass
  - 可维护性：新逻辑有中文 JSDoc、常量命名（_MAX_SIGNALS/_DEFAULT_WRITE_BATCH_SIZE 等）与既有风格一致。pass
  - 风格：缩进 2 空格、无阴影命名。pass
  - 注释：33 项修复点均带 P0-x/P1-xx 编号注释，便于追溯。pass
- **Rule 3（rubric 资源/性能）**：LRU/FIFO/环形/队列/限量读/限量下推均有"上限+1"压点与计数断言。pass
- **Rule 4（rubric 测试质量）**：攻击用例真实（报告 PoC 原样）、边界用例完整（0/1/阈值/阈值+1）、mock 聚焦（SQL/超时等无原生依赖的路径均抽纯函数测试）。pass
- **Rule 5（rubric 改动质量）**：逐文件抽查 6 个高风险文件（message-bus/nodes/runtime-config/client/transport/dispatcher），diff 语义与任务描述一致，无半成品。pass

## 关键技术点复核（代码抽查）

1. **P1-7 MemorySaver purge**：writes 复合键 `["tid",ns,cp]` 前缀匹配正确（reviewer 逐字符核对 JSON LAYOUT）；LRU 序在 getTuple 刷新——getTuple 读最新检查点时若被刷新会导致"刚读即被淘汰"？经核：getTuple 仅在 put/putWrites 之后被同 thread 调用，淘汰发生在后续 put 时不影响已取 tuple；冷启动语义正确。
2. **P1-18 env 分层**：yaml 分支 `deepMerge(default, yaml, env)` 顺序经测试验证；readEnvOverrides 稀疏性避免空值覆盖。
3. **P1-22/P1-23 传输层**：connectWithTimeout 的 cleanup 在超时与连接错误两条路径都执行；intentionalClose 标志防止主动关闭触发重连风暴；onclose 链接保留了 SDK 原回调（prevClose 透传），不会破坏 SDK Client 自身关闭流程。
4. **P1-26 二分单调性**：对象前缀 JSON 长度随后缀键数量单调不减（Object.entries 顺序稳定），二分前提成立；空容器 2 字节作为 count=0 兜底。
5. **P1-12 truncated 语义**：LIMIT maxRows+1 + `length > maxRows` 判定，修正了"恰好 maxRows 误报"；纯函数在无 better-sqlite3 环境完成核心验证。

## 变异测试（AC-13 抽验）

| 变异 | 操作 | 结果 | 结论 |
|---|---|---|---|
| T6 蒸馏守卫 | 守卫条件改恒真（每轮全量重蒸馏） | observation-distillation-guard.test.ts **3 failed/1 passed** | 测试能捕获回归 ✓（恢复后 4/4） |
| T3 白名单短路 | `maxLevel <= 1` 改 `<= 5` | rule-based.test.ts **4 failed/11 passed**（level5/4 绕过用例变红） | 测试能捕获回归 ✓（恢复后 15/15） |

变异均已恢复（grep `MUT-T` = 0），恢复后全量 1040 pass/7 环境失败。

## 测试统计

- 新增/修改测试文件：18 个新增测试文件 + 8 个既有测试文件更新（kernel/core/tools/memory/evolution/feedback/observability/perception/config）
- 新增用例约 110+；全量通过 898（基线）→ 1040（修复后），净增 142（含部分既有文件内新增）。

## Advisory（不阻塞验收，建议后续）

1. **POSIX rlimit 运行时效果未在 CI 验证**（OQ-1）：Windows 环境仅断言 preamble 内容；Linux/macOS 上内存炸弹/CPU 死循环的实际拦截建议在 Linux CI 补 1 个 e2e（或纳入后续 Job Object 方案）。
2. **supervisor 多轮重入边未实现**（OQ-2 选定范围外）：deps waiting 场景已显式 error 留痕但本轮不会再调度；完整 DAG 多轮闭环建议作为 P2 专项。
3. **sql-query 7 个环境失败**建议在 CI 安装/预编译 better-sqlite3，使 P1-12 的端到端截断与既有 7 个白名单用例恢复执行（核心逻辑已有纯函数测试兜底）。
