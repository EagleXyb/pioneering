# modu-agent P0+P1 问题修复 - 需求规格（Spec）

## Overview
- **Summary**：依据 2026-09-29《modu-agent代码优化审查报告》（`packages/docs/modu-agent代码优化审查报告.md`），修复其中全部 **P0 × 7** 与 **P1 × 26** 共 33 项已确认问题，每项修复配套回归测试，保持现有构建/测试基线不退化。
- **Purpose**：封堵 4 项真实安全绕过面、闭合权限回滚链路、消除热路径正确性缺陷与 4 处长周期内存无界增长、修正 12 项语义/正确性偏差，使代码达到"可生产长跑"的质量水位。
- **Target Users**：modu-agent 维护者、场景包开发者、下游宿主（desktop/web/backend-ts）。

## Goals
- **G1（P0 清零）**：P0-1 权限规则反注册生效；P0-2 多 PII 全量脱敏；P0-3 白名单不可整体短路；P0-4 IPv6 十六进制映射 SSRF 绕过封堵；P0-5 `__getattribute__` 沙箱逃逸链短期封堵；P0-6 Observation 蒸馏移入去重守卫；P0-7 事件总线全局订阅者不被跳过。
- **G2（P1-A 安全与权限闭环，6 项）**：P1-1 审批 fail-open 改 fail-closed；P1-2 场景包激活失败回滚；P1-3 extends 环检测；P1-4 entry/target 路径越界校验；P1-5 卸边 undo 补 to；P1-6 配置覆盖回滚用 remove 原语。
- **G3（P1-B 资源边界，8 项）**：P1-7 MemorySaver LRU 淘汰；P1-8 版本存储 FIFO 有界；P1-9 信号数组环形上限；P1-10 短时记忆 sweep + 时间戳量纲钳制；P1-11 事件持久化去同步 IO/队列有界/攒批；P1-12 sql-query 结果集有界；P1-13 file-ops 限量异步读；P1-14 code-executor POSIX rlimit（Windows 见 OQ-1）。
- **G4（P1-C 正确性与语义，12 项）**：P1-15 delegation Send 挂载校验；P1-16 supervisor 依赖任务/死字段清理；P1-17 子图 recursionLimit 生效；P1-18 env>yaml>default 优先级；P1-19 无会话成本事件不丢；P1-20 fusion 深拷贝无污染；P1-21 并行管线显式开关默认串行；P1-22 MCP 握手超时；P1-23 MCP onclose 死连接检测与懒重连；P1-24 AGUI 热路径去双重解析/降日志；P1-25 metrics 去高基数 label + 回环监听；P1-26 `_truncateJson` O(k²)→O(n)。
- **G5（基线与质量）**：tsc 零错误；全量 vitest 不新增失败（既有 7 项 better-sqlite3 环境失败原因不变）；改动最小化、风格与现有代码一致。

## Non-Goals
- 不做报告第四章 **P2 × 43** 的任何一项（留给后续独立 spec，含 logger 统一、nodes.ts 拆分、依赖治理三大专题）。
- 不做 P0-5 的中期 AST 白名单与长期容器化/nsjail 方案（本次仅交付短期禁用清单加固，文档定位"弱沙箱+强审批"）。
- 不修改 `packages/modu-agent` 之外的代码（apps/*、packages/docs 报告原文不改；对外行为变更说明以 tasks.md 完成证据形式留存，不新增文档文件）。
- 不重构与本次 33 项发现无关的代码、不重命名无关符号、不调整无关格式。
- 不变更任何包的公开导出形状（P1-25 仅移除 prometheus 指标的一个 label 维度、P1-21 新增可选配置键，均属报告内明确许可的范围）。

## Background & Context
- 审查报告已于 2026-09-29 经只读深审产出，33 项发现均带 `文件:行号` 证据与建议/步骤/效果。
- 2026-09-30 立项前已抽查复核 8 处证据点（P0-1/2/3/4/5/6/7 与 P1-1），代码与报告基线一致、行号无漂移、问题全部仍存在。
- 既有基线：`tsc -p tsconfig.build.json` 零错误；`vitest run` 905 测试 = 898 通过 / 7 失败，7 项失败全部位于 `tests/tools/sql-query.test.ts`，原因为本机 better-sqlite3 原生模块环境问题（与 P3-D 落地时一致）。
- 运行环境为 Windows；沙箱内 `pnpm -F` 不可用，历史经验为直接调用 `node_modules/.bin/tsc`、`node_modules/.bin/vitest`。
- 项目行为准则（`packages/modu-agent/AGENTS.md`）：优先复用已有模块、简体中文注释、修改前先理解上下文、不破坏既有业务逻辑。

## Functional Requirements

### FR-1：P0 安全与正确性修复（逐项）
1. **P0-1**（`src/core/registry.ts`、`src/core/policy-engine.ts`、`src/core/interfaces/policy.ts`）：`PolicyEngine` 契约新增 `remove(id): boolean`，`DefaultPolicyEngine` 以 `this._rules.delete(id)` 实现；registry 的 `unregisterPolicyRule` 直接调用引擎 `remove`，删除 `as any` 探测。
2. **P0-2**（`src/perception/security/guard.ts`）：`_PII_PATTERNS` 的 `phone_cn`/`id_card_cn`/`bank_card` 三个正则追加 `g` 标志，保证同段文本中全部匹配被脱敏。
3. **P0-3**（`src/perception/text/rule-based.ts`）：白名单不再全文 includes 整体短路；level-5 级别命中优先于白名单判定；白名单仅对其命中词条邻域生效，不豁免无关的高级别命中。
4. **P0-4**（`src/tools/http-request.ts`）：`_isPrivateIp` 对含 `:` 的 IPv6 字面量先展开为完整八组十六进制，识别 v4-mapped（`::ffff:0:0/96`）、`::a.b.c.d` 内嵌、NAT64（`64:ff9b::`）等形式并提取内嵌 IPv4 复用 `_isIpv4Private`。
5. **P0-5**（`src/tools/code-executor.ts`）：将 `__getattribute__`/`__getattr__`/`__reduce__`/`__init_subclass__` 加入 `_FORBIDDEN_ATTRS` 与字符串片段检测，使以字符串传参的属性逃逸链在校验阶段被拒；维持 requiresApproval=true 与 `-I` 子进程隔离。
6. **P0-6**（`src/graph/nodes.ts`）：Observation 蒸馏块移入 `if (!processedIds.has(toolCallId))` 守卫内，仅对新 ToolMessage 蒸馏一次；resume/重执行路径幂等。
7. **P0-7**（`src/orchestration/communication/message-bus.ts`）：domain=null 的全局订阅者单独索引；`publish` 时合并"域级订阅者 + 全局订阅者"去重后分发。

### FR-2：P1-A 安全与权限闭环（逐项）
- **P1-1**（`src/tools/tool-guardrails.ts`）：`requiresApprovalFor` 抛异常时返回 true（fail-closed），记 warning 并保证审计方向正确。
- **P1-2**（`src/kernel/scenario-loader.ts`）：装配段（配置覆盖/能力注册/entry 激活）整体 try/catch，失败时 `host.deactivate()` 回滚已注册资产后 rethrow。
- **P1-3**（`src/kernel/scenario-loader.ts`）：激活链增加 `_activating` 集合做环检测，环依赖抛明确 circular dependency 错误（finally 清理标记）。
- **P1-4**（`src/kernel/scenario-loader.ts`）：新增 `assertInside(base, candidate)` 前缀校验，entry 必须位于 packDir 内、target 必须位于 packsDir 内，拒绝 `../../` 越界。
- **P1-5**（`src/kernel/scenario-host.ts`）：registerEdge 的 undo 调用 `removeEdgeSpec(from, to)`（条件边按 registry 命名约定），保证只删本包注册的单条边。
- **P1-6**（`src/config/runtime-config.ts` + `src/kernel/scenario-host.ts`）：RuntimeConfig 新增 `remove(keyPath)` 原语（逐级清理空对象/空键残留），场景包配置回滚改用 remove 而非 `update(key, undefined)`。

### FR-3：P1-B 资源边界（逐项）
- **P1-7**（`src/graph/factory.ts`）：共享 MemorySaver 外包装有界管理：记录 thread 访问序，超阈值 LRU `deleteThread`，阈值由配置提供且有默认值。
- **P1-8**（`src/evolution/versioned-store.ts`）：`maxVersionsPerComponent`（默认 20）FIFO 淘汰索引、缓存与版本文件（保留最近版本）。
- **P1-9**（`src/feedback/evolution-signal.ts`）：`_signals` 环形上限 500（对齐 loop-controller 的 `_MAX_CUMULATIVE_SAMPLES` 模式），`getSignals(sampleCount)` 的 `slice(-n)` 语义不变。
- **P1-10**（`src/memory/short-term-memory.ts`）：空 entry 即时删 userId 键 + 低频全量 sweep 过期项；写入时间戳统一秒并对毫秒入参（>1e12）钳制，TTL 恒生效。
- **P1-11**（`src/orchestration/communication/message-bus.ts`）：去掉每事件 `existsSync`（改 stat/ENOENT 判定）；写队列加硬上限与丢弃计数；N 条或 100ms 攒批单次 appendFile；失败不再静默（计数 + 可观测告警）。
- **P1-12**（`src/tools/sql-query.ts`）：查询限量下推（外层 `LIMIT maxRows+1` 或等价的 iterate 提前终止），`truncated` 以"实际取到 maxRows+1 行"判定，结果集内存有界。
- **P1-13**（`src/tools/file-ops.ts`）：读取前用已取得的 `stat.size` 预检，改 `fs.promises.open` + 指定长度 `read`（最大 262144 字节），消除整文件读入内存；read/write/list/delete 的同步 IO 改为不阻塞事件循环的异步实现（以不破坏接口契约为前提）。
- **P1-14**（`src/tools/code-executor.ts`）：注入平台守卫的预执行资源限制片段——POSIX 用 Python `resource.setrlimit`（RLIMIT_AS/RLIMIT_CPU，值配置化有默认）；Windows 路径见 OQ-1。

### FR-4：P1-C 正确性与语义（逐项）
- **P1-15**（`src/graph/plan-execute/dispatcher.ts`）：`task_type=delegation` 发 Send 前校验 supervisor 已挂载（从 config/state 读取），未挂载时降级走普通 agent，不抛 unknown node。
- **P1-16**（`src/graph/subgraph/supervisor.ts`、相关图/状态声明）：删除恒为 2 的 `?? 1 + 1` 死字段与未在 state Annotation 声明的 `supervisor_round` 写入；对 depends_on 未完成子任务给出确定的归属决策（补 supervisor 重入边或移除过滤），不静默丢任务；同步相关文档/SOP 提示词语义。
- **P1-17**（`src/graph/subgraph/builder.ts` + `src/graph/nodes.ts`）：`makeSubagentNode` 调 `subgraph.invoke(..., { recursionLimit })` 显式传 config，删除从未被消费的 `(compiled as any).recursionLimit = ...` 赋值。
- **P1-18**（`src/config/runtime-config.ts`）：加载顺序 default → yaml → env（env 最高优先级），yaml 存在时 `MODU_*` 环境变量仍参与覆盖合并，`_sources` 记录 env 来源键。
- **P1-19**（`src/reasoning/llm/cost-tracker.ts`）：无会话上下文时 session_id 用 `'unknown'` 哨兵（对齐 audit.ts），发布失败 catch 升 warning。
- **P1-20**（`src/perception/fusion.ts`）：两处 `{ ...best }` 后对 metadata（及 voting 的 sensitivity_level）改为写副本前的浅拷贝隔离（`bestCopy.metadata = { ...(best.metadata ?? {}) }`），fuse 不污染入参。
- **P1-21**（`src/perception/pipeline.ts` 及配置 schema）：routing 配置新增显式 `parallel: boolean` 开关，默认 false（保持串行链式语义）；仅显式开启时走当前并行行为；在代码注释中写明两种语义差异。
- **P1-22**（`src/mcp/transport.ts`）：抽 `connectWithTimeout` 基类方法，stdio/SSE/WS 三种传输统一握手超时与失败清理。
- **P1-23**（`src/mcp/transport.ts`、`src/mcp/client.ts`）：监听 transport `onclose` 置 `_connected=false` 并清 `_toolsCache`；callTool 前对死连接做一次带退避的懒重连，与文件头"自动重连"承诺一致。
- **P1-24**（`src/orchestration/communication/agui-adapter.ts`）：流式热路径的 per-event `console.info` 降 debug/删除；复用已解析事件对象、删除仅为打日志做的 `JSON.parse`；不得丢事件。
- **P1-25**（`src/observability/metrics.ts`、`src/observability/exporters.ts`）：`modu_agent_tool_calls_total` 的 labelNames 改为 `['tool_name','status']`（移除 session_id）；metrics server 显式 `listen(port, '127.0.0.1')`；属对外指标维度变更，需留存变更说明。
- **P1-26**（`src/perception/text/rule-based.ts`）：`_truncateJson` 改为按结构边界一次估算裁剪 + 补闭合 + 单次 stringify，复杂度由 O(k×n) 降为 O(n)，截断结果仍是合法 JSON（既有闭合修复逻辑被复用）。

### FR-5：回归测试
33 项修复每项 SHALL 至少有一个自动化回归测试（新增或加强既有测试文件），安全类 4 项（P0-2/P0-3/P0-4/P0-5）与 P1-1/P1-4 必须包含**攻击/绕过负向用例**；资源类（P1-7~P1-11）必须有"达到上限后被淘汰/拒绝"的边界用例。

## Non-Functional Requirements
- **NFR-1 构建**：`tsc -p tsconfig.build.json` 退出码 0、零错误；不新增 `@ts-ignore`；不允许以 `as any` 绕过类型（P1-17 必须顺带删除现存的 `(compiled as any).recursionLimit`）。
- **NFR-2 测试基线**：全量 `vitest run` 通过数 ≥ 898 + 新增测试数；失败集合必须仍是且仅是 `tests/tools/sql-query.test.ts` 中 7 项 better-sqlite3 环境失败，且失败原因（原生模块加载）与基线一致——P1-12 新增用例若受同一环境限制无法执行，须以"失败原因与基线同源、非断言失败"为证据。
- **NFR-3 最小改动**：每项修复的 diff 限定在报告所列证据文件与其测试文件；确需抽公共工具时放在最近的合理位置且只服务于本次修复（不与 P2 的重构专题抢道）。
- **NFR-4 风格一致**：新增注释/JSDoc 使用简体中文，公共面补充 JSDoc；命名沿用文件内既有约定（snake_case 转译层保持现状，不夹带命名整改）。
- **NFR-5 可观测兼容**：P1-11/P1-19/P1-24 的日志级别调整不得丢失原本承载的审计语义（丢弃计数、失败 warning 等替代信号必须存在）。

## Constraints
- **Technical**：Windows 开发环境；Node ESM；不得引入新的第三方依赖（POSIX rlimit 用 Python 标准库 `resource`，不装 psutil）；better-sqlite3 原生模块在本机不可用。
- **Business**：P1-25 指标维度、P1-21 配置默认值属外部可感知变更，须保留变更说明证据；其余修复对外表现只允许"更安全/更正确"方向的变化。
- **Dependencies**：任务间文件级冲突需串行——T7(P0-7) 先于 T18(P1-11，同 message-bus.ts)；T3(P0-3) 先于 T33(P1-26，同 rule-based.ts)；T29(P1-22) 先于 T30(P1-23，同 transport.ts)；T14(P1-7) 后于 T6(P0-6)；P1-A 组在 P0-1 后。
- **Scope**：只改 `packages/modu-agent/src` 与 `packages/modu-agent/tests`。

## Assumptions
- 报告 33 项发现中已抽查 8 项全部仍有效；其余 25 项以报告行号为准，实施时若发现行号小幅漂移，以"报告描述的代码结构特征"定位同一缺陷并在完成证据中记录实际行号。
- 若实施中发现某项发现与当前代码不符（缺陷已被间接修复/描述失实），该任务转为 `blocked` 并附证据，由用户确认后取消，不强行制造改动。
- 现有 vitest 配置与测试隔离（每文件独立环境）足以支撑新增用例，无需改 vitest.config。
- `toolResultProcessor` 中蒸馏块移动后，其依赖的局部变量（distiller/enableDistillation/parsedContent/toolName 等）在守卫内同样可见（实施时确认作用域）。

## Acceptance Criteria

### AC-1：P0-1 权限反注册闭环
- **Type**： `rule`
- **Given**：一条 policy rule 已注册且 `getPolicyEngine()` 已懒构造引擎实例
- **When**：调用 `unregisterPolicyRule(id)` 后再以原命中输入执行 `engine.decide()`
- **Then**：该规则不再生效（decide 结果等同未注册），且 `DefaultPolicyEngine.remove` 有单测验证返回值语义（删除存在/不存在的 id）
- **Pass Condition**：新增/加强测试通过；`registry.ts` 中不再出现对 `remove` 的 `as any` 探测
- **Evidence**：`vitest run tests/core` 输出；grep 证据

### AC-2：P0-2 多 PII 全量脱敏
- **Type**： `rule`
- **Given**：输出文本含两个及以上手机号（以及身份证/银行卡各二连的用例）
- **When**：经 `sanitizeOutput` 处理
- **Then**：全部匹配被掩码、无遗漏；`detectPii` 统计行为不变
- **Pass Condition**：新增负向回归用例通过
- **Evidence**：`vitest run tests/perception/security/guard.test.ts`

### AC-3：P0-3 白名单不可整体短路
- **Type**： `rule`
- **Given**：文本同时包含白名单短语（如"密码学"/"password policy"）与 level-5 敏感内容（如 `password=真实密码` 形态）
- **When**：执行 `_detectSensitivity`/分级检测
- **Then**：仍返回高级别命中（≥5），不会因子串 includes 白名单而返回 0；纯正常白名单文本仍判 0
- **Pass Condition**：绕过用例 + 正常回归用例同时通过
- **Evidence**：`vitest run tests/perception/text/rule-based.test.ts`

### AC-4：P0-4 IPv6 绕过封堵
- **Type**： `rule`
- **Given**：主机字面量为 `[::ffff:0a00:0001]`、`[::ffff:a00:1]`、`[::a00:1]`、`[64:ff9b::a00:1]` 等十六进制/映射形态的内网地址
- **When**：执行私网判定/请求校验
- **Then**：全部识别为私网并拒绝；公网 IPv6 正常地址与既有点分十进制路径行为不变
- **Pass Condition**：新增单测覆盖 ≥3 个报告指定绕过形态，且不破坏现有 http-request 用例
- **Evidence**：`vitest run` 定向输出（http-request 相关测试文件，不存在则新建）

### AC-5：P0-5 沙箱逃逸链拒绝
- **Type**： `rule`
- **Given**：payload 以字符串传参形式串联 `__getattribute__('__class__')` / `__getattr__` / `__reduce__` 等
- **When**：执行 code-executor 的静态校验
- **Then**：校验阶段拒绝且不启动子进程；既有正常代码用例不受影响
- **Pass Condition**：逃逸链负向用例通过；`_FORBIDDEN_ATTRS` 与片段检测均含新增符号
- **Evidence**：`vitest run tests/tools/code-executor.test.ts`

### AC-6：P0-6 蒸馏幂等
- **Type**： `rule`
- **Given**：同一批历史 ToolMessage 经 tool_processor 多轮 ReAct（含 resume 重执行）
- **When**：处理完成后检查 `observation_history`
- **Then**：每个 toolCallId 至多产生一条蒸馏记录，无 `[duplicate of previous...]` 式重复注入
- **Pass Condition**：新增"重执行幂等"用例通过
- **Evidence**：`vitest run tests/graph`（graph 相关套件）

### AC-7：P0-7 全局订阅者必达
- **Type**： `rule`
- **Given**：同一 domain 同时存在全局订阅者（domain=null）与域级订阅者
- **When**：该 domain 发布事件（含 request 响应窗口内场景）
- **Then**：两类订阅者均收到且仅收到一次；无订阅者的 domain 行为不变
- **Pass Condition**：共存场景用例通过
- **Evidence**：`vitest run tests/orchestration/communication/message-bus.test.ts`

### AC-8：P1-A 六项闭环
- **Type**： `rule`
- **Given/When/Then**：逐项对应 FR-2——① 审批判定抛异常→返回需审批；② 激活中途失败→已注册资产零残留且可同名重新激活；③ A extends B、B extends A→明确环错误；④ entry/target 含 `../../`→拒绝且不加载；⑤ 两包同 from 不同 to，先卸载者不删他包边；⑥ 覆盖→卸载→`config.get(key, default)` 恢复默认值而非 undefined
- **Pass Condition**：6 项各有 ≥1 回归用例且全部通过
- **Evidence**：`vitest run tests/kernel tests/config tests/tools/tool-guardrails.test.ts`

### AC-9：P1-B 资源有界
- **Type**： `rule`
- **Given**：分别持续制造 thread/版本/信号/记忆条目/事件/查询行/大文件/子进程资源压力
- **When**：超过各自上限
- **Then**：MemorySaver 最早 thread 被淘汰且总数 ≤ 阈值+1；版本索引 FIFO ≤20 且文件/缓存同步删除；信号 ≤500 且 slice 语义不变；短时记忆空键清除、过期 sweep、毫秒时间戳 TTL 生效；事件写队列超限丢弃计数增长且无 existsSync 同步调用；sql 限量下推且 truncated 以 maxRows+1 判定；file-ops 大文件读取内存有界（不整文件读入）；POSIX 下 rlimit 片段生效（片段存在性/平台守卫可在 Windows 上单测）
- **Pass Condition**：8 项边界用例全部通过（sql 用例受 better-sqlite3 环境限制时按 NFR-2 同源失败认定）
- **Evidence**：各相关测试文件定向输出 + grep 证据（无 existsSync/fsync Sync 热路径、含 LIMIT 下推）

### AC-10：P1-C 十二项语义正确
- **Type**： `rule`
- **Given/When/Then**：逐项对应 FR-4 的 12 项行为断言（delegation 降级、不死等任务/无死字段、recursionLimit 传入 config、env 覆盖 yaml、unknown 哨兵成本事件可发布、fusion 入参不变、parallel 默认串行、握手超时抛错清理、onclose 后懒重连、热路径无二次 parse、label 仅 tool_name+status 且绑定 127.0.0.1、截断 JSON 合法且线性）
- **Pass Condition**：12 项各有可自动化验证的断言并通过
- **Evidence**：对应 12 个测试目标的 vitest 定向输出

### AC-11：全量基线不退化
- **Type**： `rule`
- **Given**：全部修复完成
- **When**：在 `packages/modu-agent` 执行 `node_modules/.bin/tsc -p tsconfig.build.json` 与 `node_modules/.bin/vitest run`
- **Then**：tsc 退出码 0；vitest 失败项仍是 sql-query 的 7 项 better-sqlite3 环境失败（逐个核对失败原因同源），其余全部通过（含全部新增用例）
- **Pass Condition**：两条命令输出满足上述条件
- **Evidence**：实施前/后两次全量运行结果均记录于 tasks.md 完成证据

### AC-12：修复质量与最小化
- **Type**： `rubric`
- **Dimension**：改动质量（最小化 diff / 无新增 any 与 ts-ignore / 注释中文且充分 / 无夹带无关重构 / 复用既有工具）
- **Scale**：1-5
- **Anchors**：1 = 大面积无关改动或引入新的类型逃逸；3 = 核心修复正确但存在个别夹带或注释缺失；5 = 每项 diff 紧贴报告建议、零新增 any/ts-ignore、测试与实现风格模范
- **Pass Threshold**：≥ 4
- **Evidence**：独立评审逐文件 diff 审查（git diff 统计 + 抽查）

### AC-13：回归测试对抗质量
- **Type**： `rubric`
- **Dimension**：测试有效性（负向/绕过用例真实性、边界条件覆盖、断言能捕获原缺陷——评审时可临时回退实现验证测试变红）
- **Scale**：1-5
- **Anchors**：1 = 仅 happy path；3 = 每项有用例但安全项缺攻击视角或边界未压点；5 = 安全四项含真实绕过 payload、资源项必压上限、评审抽验变异测试能失败
- **Pass Threshold**：≥ 4
- **Evidence**：独立评审对至少 4 个安全/边界用例做变异抽验（mutate-then-red）

### AC-14：对外行为变更留痕
- **Type**： `rule`
- **Given**：P1-25（指标 label 维度）与 P1-21（parallel 默认语义）属可感知变更
- **When**：修复交付
- **Then**：tasks.md 完成证据中包含两条变更说明（变更前/后、下游影响、迁移方式），评审可据此撰写 release note
- **Pass Condition**：两条说明齐备且与代码实际行为一致
- **Evidence**：tasks.md T34 Completion Evidence

## Open Questions
- [ ] **OQ-1（P1-14 Windows 资源限制深度）**：Windows 无 `resource` 模块，真正的 Job Object 限制需要原生插件或额外进程包装（非平凡且引入新依赖，受本次"零新依赖"约束）。建议本次范围：**POSIX 注入 rlimit 片段（RLIMIT_AS/RLIMIT_CPU，配置化）+ Windows 保留现有 timeout/maxBuffer 并在代码注释中明确局限**，Job Object 列入 P2 后续。若用户要求 Windows 同步强限制，需放宽"零新依赖"约束或接受 PowerShell 包装方案（启动成本与杀软误报风险）。默认按建议执行，用户可在批准时否决。
- [ ] **OQ-2（P1-16 决策归属）**：depends_on 未完成子任务的处理有两个等价方向（补 supervisor 重入边 vs 移除 depends_on 过滤直接派单）。实施时以"最小改动 + 现有测试意图"为准选定并在完成证据中说明；若两者牵涉的行为差异影响 SOP 提示词，再提请用户确认。
