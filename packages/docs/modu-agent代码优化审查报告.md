# modu-agent 代码优化审查报告

> 审查日期：2026-09-29
> 审查范围：`packages/modu-agent/src` 全部 15 个模块、153 个 TypeScript 源文件、36,598 行代码
> 审查方式：只读深度审查（6 个并行审查线：graph / core+config+kernel / perception+reasoning+memory / tools+mcp / orchestration+feedback+evolution+observability+skills / 横向交叉），全部发现均带真实 文件:行号 证据
> 审查基线：`tsc -p tsconfig.build.json` 零错误；`vitest run` 905 测试 = 898 通过 / 7 失败（失败全部位于 `tests/tools/sql-query.test.ts`，均为 better-sqlite3 环境问题，与 P3-D 落地时基线一致）
> 关联文档：`packages/docs/Agent架构分层解耦评估报告.md`（本报告是其后续质量深化）

---

## 一、总体评价

**工程纪律整体良好**：无 `@ts-ignore`；可选依赖（@opentelemetry/*、better-sqlite3、chromadb、prom-client）全部采用动态 import + try/catch 守卫；公共 API JSDoc 覆盖率高且含迁移对照说明；P3-B/C/D 新落地代码（kernel/scenario-host、scenario-loader、policy-consumers）结构清晰、注释模范。

**但存在 7 项 P0 级问题**，集中在三条主线上：

1. **安全防线存在真实绕过面**（4 项）：PII 脱敏只替换首个匹配、敏感检测白名单可整体短路、IPv6 十六进制映射绕过 SSRF 校验、code-executor 词法黑名单沙箱可逃逸；
2. **权限回滚链路断裂**（1 项）：`unregisterPolicyRule` 因引擎缺 `remove` 方法而静默失效，P3-C 权限规则的卸载回滚不闭环；
3. **热路径正确性/性能缺陷**（2 项）：ReAct 每轮对全部历史 ToolMessage 重复蒸馏（state 二次膨胀）、事件总线域索引路由跳过全局订阅者（审计事件间歇性丢失）。

**三大系统性债务**：① 81 个文件各自手写 console logger 对象（`console.*` 共 351 处）；② 业务代码 `: any` 约 450 处（剔除 logger 签名后）、`as any` 114 处；③ 巨型文件（graph/nodes.ts 2685 行，为第二名 1.9 倍）与超 80 行函数约 20 个。

**问题统计**：P0 × 7、P1 × 28、P2 × 43（详见第二～四章）。

---

## 二、P0 关键发现（立即修复：安全漏洞 / 正确性风险）

### P0-1 权限规则反注册永不生效，权限回滚链路断裂
- **位置**：`src/core/registry.ts:629-633`
- **问题描述**：`unregisterPolicyRule` 通过 `const engineAny = this._policyEngine as any; if (typeof engineAny.remove === 'function') engineAny.remove(id)` 同步摘除引擎内规则，但 `DefaultPolicyEngine`（`src/core/policy-engine.ts:38-95`）只有 `use/listRules/decide`，**没有 `remove` 方法**——类型检查恒 false，静默跳过。后果：引擎一旦懒构造（`getPolicyEngine()` 被调用过），场景包卸载 / 规则反注册后规则**仍在引擎内生效**，P3-B/C 的卸载回滚闭环断裂，构成权限绕过风险。
- **优化建议**：给 `PolicyEngine` 契约补充 `remove(id): boolean`，registry 直接调用，删除 `as any` 探测。
- **实施步骤**：① `src/core/interfaces/policy.ts` 的 `PolicyEngine` 接口加 `remove`；② `DefaultPolicyEngine` 实现为 `this._rules.delete(id)`；③ `registry.ts:632` 改为 `this._policyEngine?.remove(id)`；④ 补回归测试"注册 → 取引擎 → 反注册 → decide 放行"。
- **预期效果**：P3-B/C 卸载回滚真正闭环，消除权限规则残留。

### P0-2 输出 PII 脱敏只替换首个匹配，多个手机号/身份证/银行卡泄漏
- **位置**：`src/perception/security/guard.ts:385-392`（模式定义 `:40-46`）
- **问题描述**：`_PII_PATTERNS` 的 `phone_cn`/`id_card_cn`/`bank_card` 三个正则**均无 `g` 标志**，`sanitizeOutput` 用 `sanitized.replace(pattern, ...)` 非全局替换——同段输出含第 2 个起的 PII 全部原样泄漏。对比 `_SECRET_PATTERNS`/`_INTERNAL_IP_PATTERNS`（`:63-87`）都带 `/g`，属遗漏而非设计。
- **优化建议**：三个 PII 模式追加 `g` 标志（`detectPii` 用 `match` 统计不受影响）。
- **实施步骤**：① 三个正则加 `g`；② 补测试"同段输出含两个手机号全部被脱敏"；③ 给 `detectOutputSensitive` 复用路径加回归。
- **预期效果**：输出脱敏全覆盖，堵住 PII 泄漏通道。

### P0-3 敏感检测白名单可整体短路，单短语秒杀全部分级
- **位置**：`src/perception/text/rule-based.ts:716-721`（分级模式 `:41-44`）
- **问题描述**：`_detectSensitivity` 的白名单是**全文 includes 整体短路**：`if (textLower.includes(phrase)) return 0`。攻击者追加任意白名单词（如"密码学"、"password policy"）即可让 `password=真实密码`（level-5 拒绝级）等全部分级失效，且不触发审计。
- **优化建议**：白名单只降级其命中的具体词条，不做全文豁免；level≥5 命中时跳过白名单。
- **实施步骤**：① level-5 模式判定先于白名单；② 白名单匹配改为"该短语邻域内无高级别命中"；③ 增加绕过用例测试。
- **预期效果**：消除单短语绕过全部敏感检测的旁路。

### P0-4 IPv6 十六进制映射形式绕过 SSRF 防护
- **位置**：`src/tools/http-request.ts:241,320-333`
- **问题描述**：WHATWG URL 将 `http://[::ffff:10.0.0.1]/` 规范化为 hostname `[::ffff:a00:1]`，而内嵌 IPv4 还原正则 `/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/`（`:241`）只匹配点分十进制；`_isIpv4Private('::ffff:a00:1')` 返回 false，`fc/fd/fe80/2002:` 前缀判断也不命中 → `:333` 放行，实际连向 10.0.0.1（内网）。
- **优化建议**：对含 `:` 的字面量先展开为完整 8 组十六进制，检测 v4-mapped 段 `::ffff:0:0/96` 与 `::x:x` 形式，提取 IPv4 后复用 `_isIpv4Private`。
- **实施步骤**：① `_isPrivateIp` 增加 IPv6 展开逻辑；② 补单测 `[::ffff:0a00:0001]`、`[::a00:1]`、`[64:ff9b::a00:1]`。
- **预期效果**：封死 IPv6 侧 SSRF 绕过面（现有防护整体是本模块最完善的，修复后可称闭环）。

### P0-5 code-executor 词法黑名单沙箱可系统性逃逸（RCE）
- **位置**：`src/tools/code-executor.ts:61-65,109-126,138-160`
- **问题描述**：沙箱校验为正则+词法启发式：`__getattribute__` 不在 `_FORBIDDEN_ATTRS`（`:61-65`），字符串拼接检测不含 `__class__`/`__subclasses__`。payload 形如 `().__getattribute__('__class__').__getattribute__('__base__').__getattribute__('__subclasses__')()` 可取到真实 import 链完成逃逸（属性以字符串传参、不经 `.attr` 形式检查）。缓解项：`requiresApproval()=true`（HITL 审批）+ `-I` 子进程隔离。
- **优化建议**：不依赖黑名单词法。短期补禁用清单；中期接 AST 白名单；长期容器化执行。
- **实施步骤**：① 短期把 `__getattribute__`/`__getattr__`/`__reduce__`/`__init_subclass__` 加入 `_FORBIDDEN_ATTRS` 与 FRAGMENTS；② 中期按 Python AST 白名单节点解析；③ 长期 nsjail/容器/Job Object。
- **预期效果**：逃逸面从"可绕过"降为"需宿主级漏洞"；文档明确定位为"弱沙箱+强审批"。

### P0-6 Observation 蒸馏位于去重守卫之外，每轮重复蒸馏、state 二次膨胀
- **位置**：`src/graph/nodes.ts:1425`（守卫闭合 `:1419`；追加 reducer `src/graph/state.ts:340-343`；注入 `src/graph/context-strategies.ts:81`）
- **问题描述**：蒸馏块在 `if (!processedIds.has(toolCallId))` 守卫之外，tool_processor 每轮 ReAct 对**全部历史 ToolMessage** 重新蒸馏并 push；`observation_history` 是追加 reducer → 每轮重复追加，条目按轮数二次增长。`_compressIncremental` 虽去重 summary 但 `[duplicate of previous...]` 条目照样入列，"最近 5 条"注入可能全是重复项。
- **优化建议**：将蒸馏移入 processedIds 守卫内，仅对新 ToolMessage 蒸馏。
- **实施步骤**：① 把 `:1425-1451` 块移入 `:1385` 的 `if` 块；② 补"resume 重执行幂等"回归测试。
- **预期效果**：消除 state 二次膨胀与重复上下文注入，降低 token 与 checkpoint 序列化成本（叠加 P1-4 的 MemorySaver 无界问题，此项是内存治理的关键前置）。

### P0-7 事件总线域索引路由跳过全局订阅者，审计事件间歇性丢失
- **位置**：`src/orchestration/communication/message-bus.ts:98-114`（`PersistentEventLog.start` `:234`）
- **问题描述**：`publish` 中某 domain 存在域级订阅者时直接使用 `_domainIndex.get(domain)`，**所有无 domain 的全局订阅者被完全跳过**。`PersistentEventLog` 以无域 `subscribe(...)` 注册；`request()`（`:143-147`）在超时窗口内按 domain 注册响应处理器后，该 domain 的所有事件都不再送达审计日志。
- **优化建议**：publish 时合并域级订阅者与全局订阅者，域索引仅作加速。
- **实施步骤**：① `subscribe` 将 domain=null 的订阅存入 `_globalSubs`；② publish 时 `matched = [...(domainIndex.get(domain) ?? []), ..._globalSubs]`；③ 补"全局+域级订阅者共存"单测。
- **预期效果**：消除审计事件间歇性丢失；原全域场景行为不变。

---

## 三、P1 短期优化（明显收益且低风险）

### A 组：安全与权限闭环

#### P1-1 审批判定 fail-open：异常时静默跳过 HITL 审批
- **位置**：`src/tools/tool-guardrails.ts:332-337`
- **问题**：`try { return Boolean(moduTool.requiresApprovalFor(...)) } catch { return false }`——工具动态敏感性判定抛异常时被判为"不需要审批"，方向与安全目标相反。
- **建议/步骤/效果**：catch 改 `return true` + warning + "approval decision error" 审计事件；审批链路无静默旁路。

#### P1-2 场景包部分激活泄漏：失败不回滚已注册资产
- **位置**：`src/kernel/scenario-loader.ts:175`（`_active.set` 在 `:177`）
- **问题**：配置覆盖（`:163-164`）与能力注册（`:168-172`）先执行，`manifest.entry` 缺失或 `activate(host)` 抛错时异常上抛，但已注册的 domains/prompts/guardrails/sop **无法回滚且未被 `_active` 追踪**；再次 activate 同名包双重注册。
- **建议/步骤/效果**：装配段套 try/catch，失败时 `host.deactivate()` 再 rethrow；激活失败零残留。

#### P1-3 `extends` 循环依赖导致无限递归栈溢出
- **位置**：`src/kernel/scenario-loader.ts:150`
- **问题**：A extends B、B extends A 时，`_active.set` 在依赖激活之后才执行，环上包永远"未激活"，递归至栈溢出。
- **建议/步骤/效果**：加 `_activating: Set<string>` 检测环，入口查重抛 `circular dependency`，finally 移除；环依赖得到明确报错。

#### P1-4 场景包入口路径越界可执行任意代码
- **位置**：`src/kernel/scenario-loader.ts:302`（target 校验 `:137`）
- **问题**：`path.resolve(packDir, entrySpec)` 后直接 `import`，entrySpec 为 `../../evil.js` 即可执行 packsDir 外代码；pack.yaml 来自不可信分发源时等于任意代码加载。
- **建议/步骤/效果**：抽 `assertInside(base, candidate)`，entry 校验 `startsWith(packDir + path.sep)`、target 校验 `startsWith(packsDir)`；加载被沙箱化在约定目录内。

#### P1-5 `registerEdge` 的 undo 缺 to 参数，卸载误删他包同源边
- **位置**：`src/kernel/scenario-host.ts:216`
- **问题**：undo 为 `removeEdgeSpec(spec.from)`，缺第二参数时 registry（`registry.ts:673-684`）删除该 from 的**全部边**，可误删其他包注册的同 from 不同 to 边。
- **建议/步骤/效果**：undo 补 `to` 参数（条件边按 registry `:678` 命名约定）；补"两包同 from 边、先卸载者不误删"测试；逆序回滚精确到单条边。

#### P1-6 配置覆盖回滚写 `undefined`，键残留导致 get 返回 undefined 而非默认值
- **位置**：`src/kernel/scenario-host.ts:249`（配合 `runtime-config.ts:498,526`）
- **问题**：`update(key, undefined)` 后键残留（`key in current` 为 true），卸载后 `config.get('foo.bar', false)` 得 undefined 而非 false，行为漂移。
- **建议/步骤/效果**：RuntimeConfig 增加 `remove(keyPath)` 原语（逐级清理空对象），回滚改调用；补"覆盖→卸载→get 恢复默认"测试。

### B 组：资源边界（内存/IO 无界增长）

#### P1-7 MemorySaver 单例按 thread_id 永久保存全量 State，无淘汰
- **位置**：`src/graph/factory.ts:200`
- **问题**：`_sharedMemoryCheckpointer` 模块级单例无 TTL/LRU；叠加 P0-6 的 observation_history 膨胀，长周期多会话进程内存单调增长。
- **建议/步骤/效果**：包装 MemorySaver 记录 thread 访问序，超限 `deleteThread`，阈值配置化；内存有界，OOM 风险消除。

#### P1-8 版本存储与组件缓存无限增长
- **位置**：`src/evolution/versioned-store.ts:54,216-224`
- **问题**：`saveVersion` 向版本索引无上限追加；`_componentCache` 只增不减。
- **建议/步骤/效果**：加 `maxVersionsPerComponent`（如 20）FIFO 淘汰索引+文件+缓存（保留最近已验证稳定版本）；存储有界。

#### P1-9 信号数组无界增长
- **位置**：`src/feedback/evolution-signal.ts:35,67-70`
- **问题**：`_signals` 只 push 不清理（每个信号携带完整 metadata 快照）；`getSignals()` 每次全量拷贝 O(n)。
- **建议/步骤/效果**：参照 `loop-controller.ts` 的 `_MAX_CUMULATIVE_SAMPLES` 模式加环形上限（500）；下游 `slice(-sampleCount)` 语义兼容；消除慢性泄漏。

#### P1-10 短时记忆 userId 键永不删除 + timestamp 单位隐患
- **位置**：`src/memory/short-term-memory.ts:22,63-103`
- **问题**：`_store: Map<userId, entries>` 的空数组仍留 Map；`:69` 时间戳秒/毫秒靠约定，调用方传 `Date.now()`（毫秒）时 TTL 永不生效。
- **建议/步骤/效果**：低频全量 sweep + 空数组即时清理；时间戳统一存秒并做量纲钳制（>1e12 视为毫秒）；消除随用户数线性增长的泄漏。

#### P1-11 事件持久化：每事件同步 existsSync + 队列无上限 + 失败静默丢弃
- **位置**：`src/orchestration/communication/message-bus.ts:268-309`
- **问题**：`_writerLoop` 每条事件先 `fs.existsSync`（阻塞事件循环）；`_write_queue` 无上限；写失败仅 warning 且事件丢弃。
- **建议/步骤/效果**：去掉 existsSync（stat 的 ENOENT 判定）；队列加硬上限与丢弃计数；攒批（N 条或 100ms）单次 appendFile；消除每事件同步 IO，磁盘写入次数降一个量级。

#### P1-12 sql-query 全量物化结果集，同步阻塞
- **位置**：`src/tools/sql-query.ts:277-280`
- **问题**：`stmt.all(...)` 无 LIMIT 全量载入后 `slice`，百万行表会 OOM 且 better-sqlite3 同步执行阻塞事件循环；`truncated` 标志在恰好等于 maxRows 时误报。
- **建议/步骤/效果**：外层包 `SELECT * FROM (...) LIMIT maxRows+1` 或 `stmt.iterate()` 提前终止；truncated 以"取到 maxRows+1"判定；内存有界。

#### P1-13 file-ops 整文件读入再截断，全同步 IO
- **位置**：`src/tools/file-ops.ts:235`（`stat.size` 在 `:226` 已取得却未用）
- **问题**：`readFileSync(...).slice(0, 262144)` 先整读后截，10GB 文件内存尖峰；read/write/list/delete 均 `*Sync`，位于事件循环。
- **建议/步骤/效果**：size 预检 + `fs.promises.open` + `read(length)` 指定长度；长期 promises API；内存有界、IO 不阻塞。

#### P1-14 code-executor 无内存/CPU 资源限制
- **位置**：`src/tools/code-executor.ts:288-292`
- **问题**：子进程仅超时+maxBuffer 限制，`'x'*10**10` 类内存炸弹可 OOM 宿主（Windows 无 ulimit 兜底）。
- **建议/步骤/效果**：注入预执行 rlimit 片段（Linux）/Job Object（Windows）；消除主机级 DoS。

### C 组：正确性与语义

#### P1-15 delegation Send 不校验 supervisor 挂载，配置组合崩溃
- **位置**：`src/graph/plan-execute/dispatcher.ts:230,258`
- **问题**：`task_type=delegation` 无条件 `new SendClass('supervisor', ...)`；`plan_execute.enabled=true` 但 `multi_agent.enabled=false`（supervisor 未挂载，`graph.ts:612`）时运行时抛 unknown node。
- **建议/步骤/效果**：Send 前校验 supervisor 可用性（从 state/config 读取），否则降级走 agent；补组合配置单测；消除配置组合崩溃。

#### P1-16 supervisor 依赖任务被永久丢弃 + supervisor_round 恒为 2
- **位置**：`src/graph/subgraph/supervisor.ts:324,260`
- **问题**：`route_from_supervisor` 对依赖未完成的子任务 `continue`，但图中无边回指 supervisor（subagent_run → consensus，`graph.ts:742-746`），依赖任务永久丢弃；`:260` `?? 1 + 1` 恒为 2 且 `supervisor_round` 未在 state Annotation 声明（写入被丢弃）——多轮拆分实际未闭环。
- **建议/步骤/效果**：删死字段与 `1 + 1`；决策 DAG 归属（移除 depends_on 过滤或补 supervisor 重入边），同步文档与 SOP 提示词；消除"静默丢任务"。

#### P1-17 子图 recursionLimit 从未生效，子 Agent 循环无硬上限
- **位置**：`src/graph/subgraph/builder.ts:208`（消费点 `nodes.ts:2628`）
- **问题**：`(compiled as any).recursionLimit = recursionLimit` 从未被 LangGraph JS 消费（仅从调用 config 读取），而 `makeSubagentNode` 以 `subgraph.invoke({...})` 无 config 调用——子图实际无 10 轮上限。
- **建议/步骤/效果**：invoke 时传 `{ recursionLimit }`；子图循环真正受上限约束，防失控 token 消耗。

#### P1-18 环境变量与 config.yaml 优先级倒挂
- **位置**：`src/config/runtime-config.ts:657-670`
- **问题**：一旦找到 config.yaml，`MODU_LLM_PROVIDER` 等 env **完全不参与合并**——只有 yaml 缺失才走 fromEnv。"yaml 打进镜像 + env 注入覆盖"的容器化常规姿势静默失效。
- **建议/步骤/效果**：yaml 合并后追加 `fromEnv` 覆盖合并（env > file > default），`_sources` 记录 env 键；符合显式 env 优先预期。

#### P1-19 无会话上下文的 LLM 成本事件全部静默丢失
- **位置**：`src/reasoning/llm/cost-tracker.ts:76,98-101`
- **问题**：`session_id: ctx.sessionId || ''`——protocol（`protocol.ts:137-139`）对空 session_id 抛错，事件被 catch 吞成 debug 日志。这正是 audit.ts:92-96 已修复的同类缺陷，此处未同步。
- **建议/步骤/效果**：改 `|| 'unknown'` 哨兵 + catch 升级 warning；成本核算不再丢失，两处发布器行为一致。

#### P1-20 fusion 浅拷贝污染调用方输入
- **位置**：`src/perception/fusion.ts:152-156,184-187`
- **问题**：`{ ...best }` 后写 `bestCopy.metadata['fusion_strategy']`（voting 还覆写 `sensitivity_level`），metadata 与原 result 共享同一对象——污染调用方传入的 results，违反"纯函数"注释。
- **建议/步骤/效果**：`bestCopy.metadata = { ...(best.metadata ?? {}) }`（两处）；fuse 无副作用。

#### P1-21 并行感知管线与串行版语义分叉
- **位置**：`src/perception/pipeline.ts:193-203`（串行版 `:90-116`）
- **问题**：串行版前一感知器输出作为下一感知器输入；并行版第 2..n 个处理器**全部只接收第 1 个的输出**——3+ 链式依赖管线结果静默失真。
- **建议/步骤/效果**：routing 配置增加 `parallel: true` 显式开关，默认串行语义；文档标注差异；消除"同配置不同入口、结果不同"。

#### P1-22 SSE/WS 传输无握手超时，单 server 卡死启动
- **位置**：`src/mcp/transport.ts:243-252,325-334`（stdio 已有超时 `:147-164`）
- **问题**：stdio 已有超时+清理，但 SSE/WS 直接 `await this._client.connect(...)`——远端接受连接不完成握手时 `MCPClient.start` 永久挂起。
- **建议/步骤/效果**：提取基类 `connectWithTimeout`，三种传输复用；启动不受远端悬挂影响。

#### P1-23 未监听 transport onclose，死连接持续接单且无重连
- **位置**：`src/mcp/transport.ts:176-187,217-219`（配合 `client.ts:283`）
- **问题**：stdio server 崩溃后 `_connected` 仍 true，`callTool` 持续对死进程发请求；文件头声称"自动重连"（`client.ts:9`）实际无实现。
- **建议/步骤/效果**：注册 `onclose` 置 `_connected=false` + 清 `_toolsCache`；callTool 前带退避懒重连一次；故障自愈、错误语义正确。

#### P1-24 AGUI 流式热路径双重解析 + 同步 console IO
- **位置**：`src/orchestration/communication/agui-adapter.ts:1061-1140`
- **问题**：每个 LangGraph 事件触发 3-5 次 `console.info`；`:1088` `JSON.parse(evData).type` 仅为打日志对已序列化事件**再反序列化一次**。高 QPS 流式场景产生同步控制台 IO + 冗余 CPU。
- **建议/步骤/效果**：关键日志降为 `logger.debug`；复用已解析对象；删除循环内 per-event 日志；长流（数千 chunk）延迟明显下降。

#### P1-25 /metrics 高基数 label + 无鉴权全网卡监听
- **位置**：`src/observability/metrics.ts:97-110,212-227`（exporters.ts:218-235）
- **问题**：`modu_agent_tool_calls_total` 以 `session_id` 为 label——每个新会话生成新时间序列，prom-client 内存无界增长；`/metrics` 端点无鉴权且监听全部网卡，session_id 向外暴露。
- **建议/步骤/效果**：移除 `session_id` label（`labelNames: ['tool_name','status']`）；`server.listen(port, '127.0.0.1')`；指标内存从 O(会话×工具) 降为 O(工具×状态)，消除信息泄露面（release note 标注指标维度变更）。

#### P1-26 `_truncateJson` O(k×n) 试错式截断位于感知热路径
- **位置**：`src/perception/text/rule-based.ts:408-447`
- **问题**：逐个 pop key + 每次 `JSON.stringify` 整个剩余对象，10k keys 大 JSON 每轮全量序列化，主线程 CPU 尖刺（每轮超长输入即触发）。
- **建议/步骤/效果**：按逗号/引号边界估算裁剪 + 补闭合，仅一次 stringify（复用 `:452-479` 修复逻辑）；截断从 O(k²) 降 O(n)。

---

## 四、P2 中期改善（结构 / 可维护性 / 低频正确性）

> 共 43 项，按主题分组列表。每项含：位置 / 问题 / 建议 / 步骤 / 预期效果（紧凑格式）。

### 4.1 graph 模块（13 项）

| # | 位置 | 问题与证据 | 优化建议 → 实施步骤 → 预期效果 |
|---|---|---|---|
| P2-1 | `graph/runner.ts:695-703` | `get_runner` hash 检查与缓存赋值间有 await，冷缓存并发重复建图 | 缓存 in-flight Promise（single-flight），失败再清空 → 并发首请求只建一次图 |
| P2-2 | `graph/runner.ts:122` + `adapters/rate-limiter.ts:98` | 每请求对全量配置 JSON.stringify+SHA256；limiter 每次 tryAcquire 都读配置 | 利用 `registerChangeCallback` 置脏后才重算 hash / 刷新 enabled → 请求路径去掉 O(config) 开销 |
| P2-3 | `graph/runner.ts:1344` | 注释称"业务 error_code 也算已恢复"，下两行却 `status==='error'` 返回 resume_failed，注释与代码矛盾 | resume_sync 返回增加 `resumed: boolean` 维度，业务错误码单独透出 → 超时清理任务状态判定准确 |
| P2-4 | `graph/runner.ts:1113,957-974,1083-1101` | resume_stream 手写元组展开与 `stream_response` 归一化形状不一致；两处 resume payload 组装重复 | 复用 `_normalizeLangGraphStream`；抽取 `buildResumePayload` → 两条流式链路事件形状一致 |
| P2-5 | `graph/factory.ts:944` | info 级打印整个 configurable，宿主传入 token/凭据字段将泄漏进日志 | 仅打印白名单键或降 debug 并脱敏 → 消除敏感信息落日志 |
| P2-6 | `graph/graph.ts:579` + `runner.ts:86` | output 护栏在建图时求值门控，`policy.` 不在重建前缀——运行时开关对 output 阶段不生效，与 input 侧不对称 | makeOutputPolicyNode 内部每次判门控（或 `policy.` 纳入重建前缀）→ P3-C 开关全链路可热切 |
| P2-7 | `graph/factory.ts:893` | llmRouteResolver 每轮 route → 工厂新建 ChatOpenAI 后因缓存命中丢弃，未省模型构造 | 缓存 `provider:model → lc` unwrap 结果 → ReAct 每轮省一次模型构造 |
| P2-8 | `graph/nodes.ts:843-859` | doc_writer 识别依赖 JSON 字符串特征匹配（`'"format":"md"'` 等），魔法字符串与序列化格式强耦合 | 以 tool-adapter `_formatToolResult` 写入的 `tool` 字段为唯一识别源，契约测试锁定后删启发式 → 消除脆弱分支 |
| P2-9 | `graph/nodes.ts:122,65` 等 | 死代码：`ToolCallItem` 零使用、`formatDistilledAsContent` 未用、`_DEFAULT_TASK_TYPES`（supervisor.ts:44）零引用、`plan_execute._cached_plan`（spec.ts:467）全仓无写入方、`makeSubagentInitialState`（states.ts:72）无消费、`defaultTerminationEngine`（termination-engine.ts:503）仅测试用 | 逐项删除或落地（`_cached_plan` 补写入方否则删分支）→ 降低误读成本 |
| P2-10 | `graph/nodes.ts:2770` 等 | 超时后底层 LLM Promise 仍继续执行无法取消（有注释）；`spec.ts:202-220` 吞 when 谓词异常仅 warning（场景包配置错误静默丢节点）；`store-adapter` put/search 失败仅记日志 | 谓词异常至少上抛为配置错误；store 失败补重试或上抛策略 → 静默失败可诊断 |
| P2-11 | `graph/state.ts:194` 与 `subgraph/states.ts` | `_lw` reducer 工厂两份重复；`_lw` 命名晦涩 | 抽公共 reducer 工厂并更名 lastWrite → 单一事实源 |
| P2-12 | `graph/plan-execute/dispatcher.ts:330` 与 `context.ts:14` | `_truncate` 重复实现 | 抽共享 util → 消重 |
| P2-13 | `graph/graph.ts:807` 与 `subgraph/builder.ts:185` | `_noopToolsNode` 与 `_noopTools` 语义重复 | 合并为一处 → 消重 |

### 4.2 core / config / kernel（12 项）

| # | 位置 | 问题与证据 | 优化建议 → 实施步骤 → 预期效果 |
|---|---|---|---|
| P2-14 | `core/registry.ts:621,644` | 卸载默认 memory/context 策略后回退为"剩余首个"而非"原默认"；host 恢复 prior 不带 makeDefault | unregister 前记录旧默认 id 并恢复；host 保存 wasDefault → 默认策略确定性 |
| P2-15 | `core/policy-engine.ts:64` | `decide()` 每次调用 `[...values()].filter().sort()`，处于权限热路径 | use 时按 stage 维护已排序桶（二分插入），decide 直接取桶 → 省去每次 O(n log n) |
| P2-16 | `core/registry.ts:725` + `kernel/scenario-loader.ts:333` | 两处空 catch：包装失败静默退回原始工具；manifest 重读失败静默忽略 | 至少 warning 并保留原因 → 失败可诊断 |
| P2-17 | `config/runtime-config.ts:472,650` | `fromFile` 的 JSON.parse 无 try/catch（坏配置启动即崩且无文件上下文）；`:650` 双重深拷贝 | parse 包 try/catch 降级默认 + 告警；去掉二次 structuredClone → 可诊断、少一次全量克隆 |
| P2-18 | `config/yaml-loader.ts:72,163` | 行内任意 `#` 当注释起点（`endpoint: http://svc#frag` 被截断）；parseBlock 遇缩进异常行静默终止 | `#` 前置空白才视为注释；缩进异常抛错 → URL 片段不再丢失、畸形 YAML 快速失败 |
| P2-19 | `kernel/scenario-host.ts:156-197` | 5 处 `any` 参数（registerTool/registerLLMProvider/registerMemoryStrategy/registerContextStrategy/registerPolicyRule），场景包作者无编译期约束 | 替换为 BaseTool/LLMProviderFactory/MemoryStrategy/ContextStrategy/PolicyRule 类型（type-only import 无环）→ 错误前移编译期 |
| P2-20 | `config/schemas.ts:39` | `toDict()` 用 `Array.from(rawContent).map(padStart).join('')` 做 hex 编码，5MB 输入峰值 30MB+ | Node 环境改 `Buffer.from(...).toString('hex')`（保持 Uint8Array 兼容）→ 内存峰值降约 2/3 |
| P2-21 | `kernel/scenario-loader.ts:331-333` | `_findDependents` 每次卸载重新从磁盘读 manifest（同步 IO），激活后 manifest 被改判定不一致 | activate 时缓存 manifest，deactivate 读缓存 → 卸载零磁盘 IO、语义一致 |
| P2-22 | `config/runtime-config.ts:583` | `_emitter` 无 setMaxListeners；resetConfig 旧实例无显式关闭 | 构造时 `setMaxListeners(50)`；resetConfig 前 dispose → 监听泄漏有硬上限 |
| P2-23 | `config/env.ts:153` + `capability-registry.ts:483` | `auditEnvVars` 循环内 `find` O(n·m)；`staleBaselineKeys` 用 `includes` O(n·m) | find 改 Map；includes 前 new Set → 审计路径线性化 |
| P2-24 | `config/snapshot.ts:19` + `env.ts:99` | `SENSITIVE_KEY_RE` 两份完全相同定义，脱敏口径漂移风险；`buildDebugConfigHandler` 无鉴权钩子 | snapshot 改 import env 的导出；handler 加 `opts.authorize?` 挂点 → 单一事实源 + 可选鉴权 |
| P2-25 | `config/markdown-prompt-aggregator.ts:16-21` | logger 定义未使用（死代码） | 删除 → 消重 |

### 4.3 perception / reasoning / memory（9 项）

| # | 位置 | 问题与证据 | 优化建议 → 实施步骤 → 预期效果 |
|---|---|---|---|
| P2-26 | `perception/security/policy-consumers.ts:92-149` + `output-guard-node.ts:39-45` | 输出脱敏双机制并存（`sanitize_output.enabled` 与 `policy.engine.enabled` 两开关同开时全量正则双扫、告警双发）；`makeOutputGuardNode` 同步包装，inner 改 async 将静默跳过全部清洗 | 合并为单一执行方；包装器改 async + await inner + 回归测试 → 单一事实源、正则开销减半 |
| P2-27 | `memory/chroma.ts:280` | `newData.text ?? String(newData)` 存入 `"[object Object]"` 文档污染向量库 | fallback 改 `JSON.stringify`；拒绝空文本 upsert → 内容可检索 |
| P2-28 | `memory/chroma.ts:24-47` | `_simpleHashEmbedding` 每条文本 384 次 SHA-256（循环内 allocUnsafe） | 一次 hash 派生 seed + xorshift PRNG 生成 384 维（保持确定性契约）→ 嵌入开销降一个量级 |
| P2-29 | `perception/security/guard.ts:369-395` | `sanitizeOutput` 先 detect（全量扫描）再 replace（二次扫描），检测结果与替换脱节 | 一轮 replace 完成判定（前后不等即 detected）→ 正则开销减半 |
| P2-30 | `perception/audio/asr-processor.ts:177,155` | `writeFileSync`/`unlinkSync` 同步写大音频临时文件，Electron 卡 UI | 改 `fs/promises`（perceive 已 async）→ 不阻塞主线程（预防性） |
| P2-31 | `perception/text/rule-based.ts:369-391` | 句界截断硬切可能切断 UTF-16 代理对/emoji，孤立代理项进下游 | bestPos 回退到最近完整码点边界 → 截断输出恒合法 Unicode |
| P2-32 | `perception/text/rule-based.ts:161,676-679` 等 | `_LANGDETECT_AVAILABLE` 等假常量产生永不执行的死分支；`symbolic/rule-engine.ts` 为无导出空壳文件 | 删除死常量与死分支；空壳文件删除或补实现 → 消除维护陷阱 |
| P2-33 | `perception/text/llm-parser.ts:340-373` | 连续"继续"式 catch 链（解析失败静默降级多层次） | 至少 debug 级记录每层失败原因 → 失败路径可观测 |
| P2-34 | `memory/base-store-strategy.ts` | persist 串行 await 可并行化 | `Promise.all` 并发持久化 → 延迟降低（低优先） |

### 4.4 tools / mcp（9 项）

| # | 位置 | 问题与证据 | 优化建议 → 实施步骤 → 预期效果 |
|---|---|---|---|
| P2-35 | `tools/file-ops.ts:171-177` | symlink 检查只 lstat 末段，中间目录 symlink 逃逸不被发现（需外部预置，TOCTOU 窗口小） | 逐级 realpath 前缀校验 + 中间 symlink 单测 → 消除残余风险 |
| P2-36 | `tools/http-request.ts:570,578,589` | 超时/连接错误日志与返回消息内插原始 url，含 userinfo 时凭据入日志与 LLM 上下文 | 统一 `redactUrl()`（new URL 后剥离 username/password）→ 消除凭据泄漏通道 |
| P2-37 | `tools/doc-writer.ts:173-202,152-157,272-279` | `_validatePath` 与 file-ops.ts:140-180 近乎逐行重复；`requiresApprovalFor` 的 read/list 分支为复制死分支（schema 仅 create/append）；路径穿越被拦时未发审计事件（file-ops:204 有） | 抽 `path-guard.ts` 共享；删死分支；补审计发布 → 安全逻辑单一事实源 |
| P2-38 | `mcp/transport.ts:190-215,269-293,351-374` | request/notify 三份重复实现（各约 25 行）；`undefined as any` 顶掉请求级 options（SDK 60s 与会话 30s 超时不一致） | 基类实现 request/notify；传显式 `{ timeout: sessionTimeout }` → 减约 80 行重复、超时统一 |
| P2-39 | `mcp/client.ts:123-146` | callTool 超时用 Promise.race 但底层请求不取消，悬挂至 SDK 60s | AbortController + `options.signal` → 超时语义干净 |
| P2-40 | `tools/search.ts:100-151` | 降级链无全局 deadline，最坏约 50s+ 才返回 | invoke 入口设总预算（30s）Promise.race，各 provider 按剩余预算收缩 → 最坏延迟可预期 |
| P2-41 | `tools/datetime-tool.ts:313-316,335-367` | 解析走宿主本地时区构造 Date 再当"源时区挂钟"用，非 UTC 宿主机偏差=宿主偏移；固定偏移表不处理夏令时 | 用 `Date.UTC(y,m,d,...)` 按字段构造再减 srcOffset；长期引入 IANA → 转换与宿主时区解耦 |
| P2-42 | `tools/tool-guardrails.ts:86,104` | 参数条件子串匹配误报（`INSERT\|UPDATE\|...` 命中 `SELECT * FROM updated_users`），训练绕审批习惯 | SQL 规则改词边界正则（复用 sql-query.ts:28）；文本条件支持 `regex:` 前缀 → 误报下降 |
| P2-43 | `tools/tool-registry.ts:272,3` | 函数名 `TOOL_CAPABILITY_MATRIX_KEYS_INCLUDE` 用常量命名约定；文件头注释 "TOoL" 拼写错误 | 改名 `matrixHasTaskType` + 修 typo → 命名规范一致 |

### 4.5 orchestration / feedback / evolution / observability / skills（9 项）

| # | 位置 | 问题与证据 | 优化建议 → 实施步骤 → 预期效果 |
|---|---|---|---|
| P2-44 | `orchestration/communication/message-bus.ts:127-165,234` | request 超时 setTimeout 不清理（阻碍退出）；`:234` bind 新引用致 stop 无法退订，反复 start/stop 累积死处理器 | 保存 timer 引用 finally clearTimeout；保存退订函数供 stop 调用 → 无定时器/订阅泄漏 |
| P2-45 | `orchestration/communication/agui-adapter.ts:1302-1359,1397-1447` | doc_writer 识别与 ARTIFACT_CREATED 两分支整段重复约 45 行；`_process_langgraph_event` 262 行 if-chain | 抽 `_detectToolName`/`_maybeEmitArtifact`；事件分发改 Map<eventType, handler> 注册表 → 减约 90 行重复，新事件类型=注册一个 handler |
| P2-46 | `orchestration/communication/agui-adapter.ts:445-457,1535-1548` | thinking 默认 chunk_size=30，SSE 事件数放大约 30 倍；30 魔法数字两处 | 提为常量并调大（如 200）或单事件发送 → SSE 帧数减约 85% |
| P2-47 | `evolution/rollback-mechanism.ts:47-84,131-141` | 单次低分即触发回滚（无滞回）；`_findStableVersion` 可能回滚到自身；`_qualityRecords` 无界 | 连续 N 次低分阈值；查找排除当前版本；records 超 200 截断 → 消除误回滚 |
| P2-48 | `observability/logging-config.ts:263-279` | 全仓 printf 风格日志但 `_argsToEntry` 不做 `%s` 插值，结构化日志变字面量 | 实现最小 format 插值，与 console 语义对齐 → 日志可被 ELK 直接检索 |
| P2-49 | `orchestration/communication/protocol.ts:232-244` | "纯 hex 且偶数长度"启发式把 `"beef"`/`"123456"` 误判为二进制且不可逆；`priority as EventPriority` 无校验 | 仅 schema_version<1 启用启发式或要求显式标记；priority 白名单校验 → 消除载荷被静默篡改 |
| P2-50 | `orchestration/patterns/consensus.ts:437-445` | `session_id ?? ''` 对空 session_id 抛错被吞，无会话共识失败审计事件必然丢失（同 P1-19 模式） | 缺省生成 `consensus_${randomUUID()}`（对齐 trace_id 兜底）→ 失败事件 100% 可发布 |
| P2-51 | `feedback/quality-monitor.ts:507-545,599-613` | 空白分词致中文整句单 token，`_checkRelevance` 对中文失效（停用词表却是中文）；LOW_CONFIDENCE_PATTERNS 遍历两遍；`'等'`/`'以下'` 高误报 | 中文改 2-gram；合并双循环；截断标记改 endsWith → 中文质量分有区分度 |
| P2-52 | `observability/tracing.ts:232-260,104,121-124` | span attributes 无脱敏通道，凭据类字段入 trace 后端与日志（结构性风险） | 提供 SENSITIVE_ATTR_KEYS 黑名单，setAttribute 前打码 → "密钥不进 trace"机制化保证 |
| P2-53 | `evolution/evolution-orchestrator.ts:173-185` | 直接改写 collector 返回信号对象的 context，跨模块共享状态被原地污染 | `analyzeAndAdjust` 增第三参显式传 evaluation，删回写循环 → 信号对象不可变 |
| P2-54 | `observability/exporters.ts:79-80,47-52` | 同一模块重复 import 两次（死代码）；`_otlp_lock` 布尔锁并发时直接返回可能过期的 false | 删重复 import；锁改保存进行中 Promise → 并发 boot 结果确定 |
| P2-55 | `orchestration/sensor-manager.ts:110-121` | 采集间隔硬编码 1000ms；外层 catch 把所有真实异常记为 "cancelled" | 间隔读配置 `perception.sensor_interval_ms`；catch 区分 AbortError 与真实异常 → 故障不被误报 |
| P2-56 | `feedback/metrics/accuracy.ts:15-18` | `expectedResults` 参数全函数未使用（死参数，误导调用方） | 删除参数并修正调用点（loop-controller.ts:74 仅传单参）→ API 语义诚实 |

---

## 五、审查清单六项结论（用户指定清单逐项）

### 5.1 变量命名规范 —— **总体良好，存在局部反例**
- Python 转译痕迹：snake_case 方法名与 `_` 前缀私有字段全局统一（有意保留，与 Python 对齐），但新代码建议统一 camelCase。
- 反例清单：`_lw`（state.ts:194，缩写晦涩）、`engineAny`（registry.ts:632，命名自暴 as any 逃逸）、`findConfigYamlForLogging`（runtime-config.ts:623，名不副实的纯转发别名）、`TOOL_CAPABILITY_MATRIX_KEYS_INCLUDE`（tool-registry.ts:272，函数用常量命名）、自造 `ValueError` 类（client.ts:379，Python 习语）、`deps_extensionEnabled`（spec.ts:247，前缀语义错位）、`ConsensusPattern._safe_call`（consensus.ts:470-472，名不符实不做安全包裹）、`collect_text`（metrics.ts:252，同步版名实不符）。

### 5.2 函数封装合理性 —— **约 20 个超 80 行函数，集中在 graph 与 agui**
完整清单（函数名 / 位置 / 约行数）：
| 函数 | 位置 | 行数 |
|---|---|---|
| create_agent | graph/factory.ts:492 | ~470 |
| AGUIStreamAdapter.transform_langgraph_events | agui-adapter.ts:925 | ~288 |
| makeAgentNode 闭包工厂 | graph/nodes.ts:1006 | ~290 |
| AGUIStreamAdapter._process_langgraph_event | agui-adapter.ts:1215 | ~262 |
| _humanReviewNode | graph/nodes.ts:1961 | ~270 |
| _stepFinalizeNode | plan-execute/dispatcher.ts:364 | ~240 |
| _plannerNode | plan-execute/planner.ts:426 | ~220 |
| agentNode | graph/nodes.ts:1070 | ~220 |
| toolResultProcessor | graph/nodes.ts:1327 | ~180 |
| file-ops invoke | tools/file-ops.ts:182 | ~159 |
| doc-writer invoke | tools/doc-writer.ts:204 | ~143 |
| routeAfterAgent | graph/nodes.ts:606 | ~143 |
| http-request _requestPinned | tools/http-request.ts:364 | ~138 |
| sql-query invoke | tools/sql-query.ts:201 | ~120 |
| TextPreprocessor.perceive | perception/text/rule-based.ts:203 | ~113 |
| code-executor invoke | tools/code-executor.ts:244 | ~103 |
| boot_observability | observability/boot.ts:55 | ~102（分段清晰可容忍） |
| http-request invoke | tools/http-request.ts:503 | ~90 |
| ParameterTuneStrategy.analyzeAndAdjust | evolution/parameter-tune.ts:54 | ~89 |
| _truncateJson | perception/text/rule-based.ts:394 | ~87 |

拆分建议：按"判定 / 组装 / 写 state"三段拆分；op 分支堆叠型（invoke 类）按 op 拆私有方法；事件分发型（_process_langgraph_event）改 handler 注册表。

### 5.3 异常处理机制 —— **无裸奔 Promise，1 处真实空 catch，~20 处吞异常**
- 真实空 catch：`agui-adapter.ts:1412`（doc_writer 启发式恢复失败静默，低危）。
- 需要修正的吞异常：**tool-guardrails.ts:334-337（fail-open，见 P1-1）**、**cost-tracker.ts:98-101（吞成 debug，见 P1-19）**、registry.ts:725 / scenario-loader.ts:333（空语义 catch）、sensor-manager.ts:119-121（真实错误记为 "cancelled"）。
- 可接受的降级型 catch（均有注释）：policy-consumers.ts:69-73,144-148（fail-open 有注释）、guard.ts:171-174、rule-based.ts:267-269、llm-parser.ts:340-373、http-request.ts:421,471,487、transport.ts:160 等。
- 未发现未 catch 的浮空 Promise；`Promise.allSettled/race` 使用正确（除 message-bus race 分支定时器不清理，见 P2-44）。

### 5.4 注释完整性 —— **JSDoc 覆盖率高，TODO 共 17 条**
- 公共 API JSDoc 覆盖率高（core/interfaces 12 文件全覆盖，registry/config 方法齐全，含依赖方向与"零行为变化"约束说明，属模范级）；graph 模块无 TODO/FIXME。
- 缺 JSDoc 的公共面：`TextPreprocessor.perceive`、`InMemoryShortTermMemory.query/update`、`ChromaLongTermMemory.query/update`、`AGUIStreamAdapter.transform/_parse_tool_records`、`EventBus.publish/request`（无限增长语义未提示）。
- TODO 17 条：14 条集中在 perception/* 的 TS 移植占位（camera.ts×4、asr-processor.ts×5、image-processor.ts×3、llm-parser.ts×3、rule-based.ts×1）；FIXME/HACK 为 0。

### 5.5 重复代码消除 —— **最大债务：81 处手写 logger；另有 8 组可抽取**
| 组 | 位置 | 建议 |
|---|---|---|
| ① console logger 对象 ×81 文件（351 处 console.*） | yaml-loader.ts:23-28 ≡ plugin-manifest.ts:16-21 ≡ memory-md-persistence.ts:18-23 ≡ pipeline.ts:18-23 ≡ fusion.ts:12-17 ≡ audit.ts:15-20 ≡ router.ts:14-19 等 | 新建 `observability/logger.ts` 提供 `createLogger(scope)`，一次性替换（同时解决结构化日志下 logger 名全是 "console" 的问题，并联动 P2-48 插值修复） |
| ② path 校验双份 | file-ops.ts:140-180 ≡ doc-writer.ts:173-202（含盘符修复逐行重复） | 抽 `src/tools/path-guard.ts` |
| ③ transport request/notify ×3 份 | transport.ts:190-215 / 269-293 / 351-374 | 基类实现，子类暴露 `_client` getter |
| ④ resume payload 两套 + 流式归一化不一致 | runner.ts:957-974 vs 1083-1101 | 抽 `buildResumePayload` + 复用 `_normalizeLangGraphStream` |
| ⑤ prompt 聚合三胞胎 | reasoning/prompt-composer.ts:53-71 ≡ skills/prompt-aggregator.ts:24-47 ≡ config/markdown-prompt-aggregator.ts | 统一 SegmentProvider 接口（收集→滤空→join→空降级） |
| ⑥ `_lw` reducer 两份 | graph/state.ts ≡ graph/subgraph/states.ts | 抽公共工厂 |
| ⑦ `_emptyResult` 三份 | llm-parser.ts:379 ≡ asr-processor.ts:270 ≡ image-processor.ts:218 | 抽共享工厂 |
| ⑧ loader 头部样板 | yaml-loader.ts:20-21/40 ≡ markdown-loader.ts:25-26/96-98（__dirname+包根推导）；"不抛异常返回空"契约三处 | 抽 `getPackageRoot()` 与 `safeParse` 包装器 |
| ⑨ SENSITIVE_KEY_RE 双份 | snapshot.ts:19 ≡ env.ts:99 | 改 import |

### 5.6 依赖管理优化 —— **可选依赖守卫规范；3 项治理点**
| 依赖 | 使用情况 | 结论 |
|---|---|---|
| @langchain/core | 15 文件/20 处 | 合理 |
| @langchain/langgraph | 11 文件/14 处 | 合理 |
| @langchain/openai | **仅 graph/adapters/llm-adapter.ts:21**（ChatOpenAI 一处） | 建议移入 optionalDependencies + 动态 import 守卫 |
| @modelcontextprotocol/sdk | 仅 mcp/transport.ts | 保留（集中使用） |
| zod | 仅 2 文件（tool-adapter.ts、plan-execute/types.ts） | 使用偏薄但保留 |
| 8 项 optionalDependencies | 全部动态 import + try/catch 守卫（含 otlp-grpc→http 回退、SQL_005/chromadb 明确报错） | **全部健康** |

治理点：① peerDependencies（`*`）与 dependencies（`^0.3.0`）双声明 @langchain/core+langgraph，npm7+ 自动装 peer 会与 dependencies 打架，库/应用定位二选一；② factory.ts:182 动态导入的 `@langchain/langgraph-checkpoint-sqlite` 未列入任何依赖段（靠 @ts-expect-error 兜底），应补入 optionalDependencies；③ `ws`（transport.ts:308-310 注释需使用方手动装）应正式声明为 optionalDependency。

---

## 六、安全专项结论（五项逐一）

| 专项 | 结论 | 依据 |
|---|---|---|
| **http-request SSRF** | ⚠️ 部分防护，存在 1 项 P0 绕过 | 已有：协议白名单（:303）、IPv4/IPv6 私网段、DNS 全记录解析校验（:337-354）、校验 IP 钉死连接防 rebinding（:364-404）、不跟随重定向、流式限长（:461-479）——整体是工具层最完善实现；**但 IPv6 十六进制映射形式可绕过（P0-4），修复后才可称闭环** |
| **sql-query 注入** | ✅ 不存在 | 强制 `?` 参数化（:276-277）+ SELECT 前缀/关键词黑名单/分号注释拦截（:28）+ 连接级 readonly（:265-267）多层防御；剩余为性能问题（P1-12），非注入面 |
| **code-executor 沙箱** | ❌ 弱沙箱可绕过 | 词法黑名单存在 `__getattribute__` 系统性逃逸链（P0-5，RCE）；无内存/CPU 限制（P1-14）；现有防线 = HITL 审批 + `-I` 隔离 + 环境净化，**应按"弱沙箱+强审批"定位使用，不应作为强沙箱** |
| **file-ops 路径穿越** | ✅ 基本不存在 | 绝对路径/盘符/`..` 分段/resolve+relative 复核（:140-179）+ 末段 symlink 校验；残余仅中间目录 symlink（P2-35，需外部预置） |
| **密钥泄漏到日志** | ⚠️ 无系统性泄漏，3 处通道需封堵 | 各 logger 不输出 env/API key/请求头；需封堵：http-request 错误路径内插原始 URL userinfo（P2-36）、factory.ts:944 打印整个 configurable（P2-5）、tracing attributes 无脱敏（P2-52）；另 `llm-adapter.ts:76-90` 直接读 `LLM_API_KEY`/`LLM_BASE_URL` 绕过 MODU_* 命名空间（env 治理项） |

---

## 七、优先级排序与实施路线图

### 第一批：P0（7 项，建议 1-2 个迭代内完成）
| 顺序 | 项 | 依赖 |
|---|---|---|
| 1 | P0-1 权限规则反注册（registry remove） | 无——单点修复，解锁 P3-B/C 回滚闭环 |
| 2 | P0-2 PII 全局替换 + P0-3 白名单短路 | 无——均单文件小改动+测试 |
| 3 | P0-4 SSRF IPv6 + P0-5 沙箱加固（短期部分） | 无——补禁用清单即可获得主要收益 |
| 4 | P0-6 蒸馏守卫内移 | 建议先于 P1-7（MemorySaper 淘汰），消除膨胀源头 |
| 5 | P0-7 事件总线全局订阅者 | 无 |

### 第二批：P1（26 项，按三组并行推进）
- **A 安全与权限闭环**（P1-1～P1-6）：依赖 P0-1 完成；scenario-host/loader 的 4 项（P1-2/3/4/5/6）可合并为一个"场景包健壮性"专题。
- **B 资源边界**（P1-7～P1-14）：P1-7 依赖 P0-6；其余独立。此组收益是"长周期运行不崩"，建议在做任何生产长跑前完成。
- **C 正确性与语义**（P1-15～P1-26）：P1-15/16/17 为 multi-agent/plan-execute 一组；P1-18 配置优先级独立；P1-19 与 P2-50 同模式可顺手同修；P1-24/25 涉及对外行为变更需 release note。

### 第三批：P2（43 项，按主题合并为 6 个重构专题）
1. **logger 统一专题**（最大杠杆）：5.5-① + P2-48 + P2-5——一次替换 81 处，同时修复结构化日志插值。
2. **nodes.ts 拆分专题**：P2-8/9/10 + 5.2 清单中 nodes.ts 的 6 个长函数——先抽 doc_writer 识别（P2-8），再拆 makeAgentNode/toolResultProcessor。
3. **场景包类型化专题**：P2-19 + P2-14/21 + P1 组 A 残留。
4. **mcp 传输健壮性专题**：P2-38/39 + P1-22/23。
5. **memory/安全单点修**：P2-26～P2-34 按表逐项。
6. **依赖治理**：5.6 三项 + `process.env` 收敛（33 处中 28 处散布 9 文件，`llm-adapter.ts:76-90` 直接读 `LLM_API_KEY` 最违规，应统一走 `config/env.ts`）。

### 量化目标（完成后预期）
- P0 清零：安全绕过面 4 项封堵、权限回滚闭环、审计事件 100% 送达。
- 长周期内存：4 处无界增长源（MemorySaver/versioned-store/evolution-signal/short-term-memory）+ 2 处指标泄漏（session label/tool_calls）全部有界。
- ReAct 热路径：每轮处理量从全量降为增量（P0-6 + P2 图内 3 项），token 与 checkpoint 成本随轮次线性而非二次增长。
- 代码卫生：logger 81→1、`: any` 450→<150、超 80 行函数 20→<8、`@langchain/openai` 依赖面 1→optional。

---

## 附录 A：全局一致性统计（横向扫描）

| 指标 | 数值 | Top 位置 | 严重度 |
|---|---|---|---|
| `as any` | 114 处 / 25 文件 | graph/nodes.ts(17)、graph/runner.ts(15)、graph/graph.ts(13)、graph/adapters/event-bridge.ts(11)、mcp/transport.ts(10)、graph/subgraph/supervisor.ts(5) | 中 |
| `: any` | 777 处 / 100 文件（其中 325 处来自 81 个 logger 的 `...args: any[]`，业务约 450 处） | graph/nodes.ts(43)、graph/factory.ts(37)、graph/graph.ts(36)、graph/runner.ts(24)、config/runtime-config.ts(24) | 中高 |
| @ts-ignore / @ts-expect-error | 0 / 1（factory.ts:181 动态导入 checkpoint-sqlite，写法合格） | — | 低 |
| 空 catch | 1 处真实命中 | agui-adapter.ts:1412 | 低 |
| console.* | 351 处 / 85 文件（几乎全部封装于 81 个手写 logger） | `createLogger|class Logger` 全库零命中——无统一日志设施 | 中 |
| TODO / FIXME / HACK | 17 / 0 / 0 | perception/* 移植占位 14 条 | 低 |
| process.env | 33 处 / 10 文件（env.ts 仅 5 处为授权入口，其余 28 处散布 9 文件） | **llm-adapter.ts:76-90 直接读 LLM_API_KEY/LLM_BASE_URL 最违规**；runtime-config.ts(7)、search.ts(5)、mcp/transport.ts(3) | 中 |

巨型文件 Top10（graph 层占 6 席）：
| # | 文件 | 行数 |
|---|---|---|
| 1 | graph/nodes.ts | 2685 |
| 2 | orchestration/communication/agui-adapter.ts | 1382 |
| 3 | graph/runner.ts | 1283 |
| 4 | graph/factory.ts | 899 |
| 5 | core/registry.ts | 769 |
| 6 | graph/graph.ts | 763 |
| 6 | perception/text/rule-based.ts | 763 |
| 8 | config/runtime-config.ts | 669 |
| 9 | graph/plan-execute/dispatcher.ts | 623 |
| 10 | graph/plan-execute/planner.ts | 617 |

---

## 附录 B：审查覆盖清单（153 文件逐一标注）

> 标注说明：【发现】= 存在问题（编号见上文）；【通过】= 已读且无显著问题。行数为审查时点统计。

### src 根（2 文件）
- 【通过】index.ts（48 行）
- 【通过】types/optional-modules.d.ts（104 行，环境声明，34 处 any 可接受）

### config（14 文件）
- 【发现 P1-18/P2-17/P2-22】runtime-config.ts（669）
- 【发现 P2-23】capability-registry.ts（513）
- 【发现 P2-23】env.ts（153）
- 【发现 P2-18】yaml-loader.ts（339）
- 【发现 P2-20】schemas.ts（333）
- 【发现 P2-24】snapshot.ts（113）
- 【发现 P2-25】markdown-prompt-aggregator.ts（143）
- 【通过】index.ts（110）、init-defaults.ts（207）、knowledge-index.ts（143）、markdown-loader.ts（289，头部样板见 5.5-⑧）、memory-md-persistence.ts（242，同上）、plugin-manifest.ts（117）

### core（15 文件）
- 【发现 P0-1/P2-14/P2-16】registry.ts（769）
- 【发现 P2-15】policy-engine.ts（104）
- 【通过】index.ts（69）
- 【通过】interfaces/ 全部 12 文件：action.ts（126）、context.ts（92）、feedback.ts（25）、llm-provider.ts（93）、llm.ts（185）、memory-strategy.ts（90）、memory.ts（27）、perception.ts（22）、policy.ts（144）、prompt.ts（65）、reasoning.ts（37）、skill.ts（59）

### graph（34 文件）
- 【发现 P0-6/P1(1346)/P2-8/9/10】nodes.ts（2685）
- 【发现 P2-1/2/3/4】runner.ts（1283）
- 【发现 P1-7/P2-5/7】factory.ts（899）
- 【发现 P2-6/13】graph.ts（763）
- 【发现 P2-9/11】state.ts（561）
- 【发现 P2-9】spec.ts（502）
- 【发现 P1-15/P2-12】plan-execute/dispatcher.ts（623）
- 【发现 P2-12】plan-execute/context.ts（76）
- 【发现 P1-16/P2-9】subgraph/supervisor.ts（309）
- 【发现 P1-17】subgraph/builder.ts（194）
- 【发现 P2-9/11】subgraph/states.ts（85）
- 【发现 P2-2】adapters/rate-limiter.ts（129）
- 【通过】index.ts（129）、prompt-templates.ts（263）、termination-engine.ts（456，除 P2-9 死导出）、context-strategies.ts（184）、plan-execute/{index(29),planner(617),prompts(140),types(138)}、adapters/{index(42),llm-adapter(228),llm-metrics(133),llm-provider-registry(125),mcp-tool-adapter(197),modu-llm-adapter(300),observation-distiller(466),retry(186),store-adapter(382),tool-adapter(400),tool-orchestrator(239),tool-result-cache(195),event-bridge(467,as any 密集见附录A)}

### kernel（3 文件，P3-B 新代码）
- 【发现 P1-2/3/4/P2-21】scenario-loader.ts（322）
- 【发现 P1-5/6/P2-19】scenario-host.ts（252）
- 【通过】index.ts（5）

### perception（17 文件）
- 【发现 P0-3/P1-26/P2-31/32】text/rule-based.ts（763）
- 【发现 P0-2/P2-29】security/guard.ts（362）
- 【发现 P1-21】pipeline.ts（189）
- 【发现 P1-20】fusion.ts（217）
- 【发现 P2-26】security/policy-consumers.ts（135）、security/output-guard-node.ts（75）
- 【发现 P2-30】audio/asr-processor.ts（249）
- 【发现 P2-33/32】text/llm-parser.ts（351）
- 【通过】index.ts（108）、security/index.ts（28）、security/{audit(121),policy-rules(301)}、audio/index.ts（3）、vision/{camera(245),image-processor(238)}（stub 为主，除 P2-32 死常量外无问题）、builtin-processors.ts（92）

### reasoning（11 文件）
- 【发现 P1-19】llm/cost-tracker.ts（95）
- 【发现 P2-32】symbolic/rule-engine.ts（5，空壳文件）
- 【通过】complexity-assessor.ts（252）、context-builder.ts（119）、cot-anchors.ts（82）、domain-adapters.ts（117）、index.ts（42）、prompt-composer.ts（65，与 skills 重叠见 5.5-⑤）、prompt-registry.ts（156）、llm/{router(186),index(19)}

### memory（5 文件）
- 【发现 P1-10】short-term-memory.ts（98）
- 【发现 P2-27/28】chroma.ts（282）
- 【发现 P2-34】base-store-strategy.ts（129）
- 【通过】memory-strategy.ts（127）、index.ts（20）

### tools（12 文件）
- 【发现 P0-4/P2-36】http-request.ts（541）
- 【发现 P0-5/P1-14】code-executor.ts（313）
- 【发现 P1-1/P2-42】tool-guardrails.ts（405）
- 【发现 P1-12】sql-query.ts（292）
- 【发现 P1-13/P2-35】file-ops.ts（325）
- 【发现 P2-37】doc-writer.ts（322）
- 【发现 P2-40】search.ts（447）
- 【发现 P2-41】datetime-tool.ts（343）
- 【发现 P2-43】tool-registry.ts（335）
- 【通过】index.ts（40）、synchronous-executor.ts（63，已废弃标注清晰）、calculator.ts（211，手写递归下降解析器无 eval）

### mcp（6 文件）
- 【发现 P1-22/23/P2-38】transport.ts（349）
- 【发现 P2-39】client.ts（389）
- 【通过】discovery.ts（148）、errors.ts（70）、lifecycle.ts（67）、index.ts（28）

### orchestration（10 文件）
- 【发现 P0-7/P1-11/P2-44】communication/message-bus.ts（409）
- 【发现 P1-24/P2-45/46】communication/agui-adapter.ts（1382）
- 【发现 P2-49】communication/protocol.ts（436）
- 【发现 P2-50】patterns/consensus.ts（431）
- 【发现 P2-55】sensor-manager.ts（113）
- 【通过】index.ts（46）、sop-registry.ts（69）、communication/{event-bus-adapter(156),index(63),streaming(137)}、patterns/delegation.ts（61，已规范标注 deprecated）、communication/index.ts

### feedback（6 文件）
- 【发现 P1-9】evolution-signal.ts（101）
- 【发现 P2-51/56】quality-monitor.ts（581）、metrics/accuracy.ts（44）
- 【通过】index.ts（7）、loop-controller.ts（163，环形缓冲修复到位，是内存治理的正面范例）、metrics/efficiency.ts（35）

### evolution（6 文件）
- 【发现 P1-8】versioned-store.ts（248）
- 【发现 P2-47】rollback-mechanism.ts（136）
- 【发现 P2-53】evolution-orchestrator.ts（208）
- 【通过】component-swap.ts（78）、index.ts（8）、parameter-tune.ts（189）

### observability（7 文件）
- 【发现 P1-25】metrics.ts（274）
- 【发现 P2-48】logging-config.ts（280）
- 【发现 P2-52】tracing.ts（261）
- 【发现 P2-54】exporters.ts（275）
- 【通过】boot.ts（144）、trace-context.ts（160）、index.ts（50）

### skills（6 文件）
- 【通过】全部：adapter.ts（108）、few-shot-selector.ts（305，MMR O(n²) 但 n=9 非热点）、index.ts（20）、loader.ts（130）、math-skill.ts（40）、prompt-aggregator.ts（43，重叠见 5.5-⑤）

---

## 附：审查方法与可信度说明
- 全部 153 个文件被 6 条审查线真实读取（五个最大文件 nodes.ts/agui-adapter.ts/runner.ts/factory.ts/registry.ts 逐段深读），发现均带行号级证据；横向统计数据来自全库 Grep 实测。
- 审查全程零代码改动；报告产出后已复跑基线：tsc 零错误、vitest 898 通过 / 7 失败（sql-query better-sqlite3 环境问题），与审查前一致。
- 本报告为只读审查结论，所有修复建议的实施应作为独立 spec 逐项立项（建议按第七章路线图分三批推进）。
