# apps/desktop 与 packages/modu-agent 代码现状深度复审

复审日期：2026-10-04 ｜ 分支：`V2.6`（HEAD `d133c2c`，工作区干净）
方法：基线核对 → 代码量统计 → **门禁实跑**（typecheck + 全量 vitest）→ 主/渲染层与内核逐文件深读 → **PoC 实证**（临时测试跑完移入 `~/.Trash`，`git status` 已验证仓库干净）
与上一版基线（V2.5 / 09-30）的差异：desktop 与 modu-agent 各新增一个特性提交（HITL 内嵌卡 + 命令面板/插件市场页；需求澄清全链路），本报告已把这两块作为重点复核对象。

---

## 一、结论先行

工程整体**成熟度高于规模给人的直觉**：主进程安全边界、云边双模语义对齐、HITL 状态机三处是真正做扎实的，代码卫生（全仓 3 处 `any`、5 处 `eslint-disable`、无 TODO 债堆）在同类项目里属上乘。

但存在 4 个必须处理的问题，其中 2 个是**本轮新发现的实证缺陷**：

1. **P1｜code_executor 在 macOS 上完全不可用**——资源限制 preamble 先于用户代码崩溃，`print(1)` 也失败；测试只断言「没被静态校验拒绝」，从不断言执行成功，所以全绿掩盖了工具死亡。
2. **P1｜沙箱黑名单仍可绕过（PoC 实证）**——`if 1: import urllib.request` 穿过行首 import 正则，任意本地文件读取实际成功。默认配置下有人工审批兜底，HITL 关闭即升级为 P0。
3. **P1｜组合模式（plan_execute + multi_agent）入口路由断链**——与 08-05 结论相同，**至今未修**，且原因查明：等价性测试只比节点清单，不校验「路由器返回值域 ⊆ 边 targets」。
4. **P1｜图片附件全链路断裂 + 待办面板伪造数据**——前者是老问题未修（协议里根本没有 images 字段）；后者是本轮新引入：每个会话的右栏都会显示一段与用户无关的、已完成的历史任务待办。

门禁现状：typecheck 两包全绿；vitest 合计 **15 红**（desktop 5 / modu-agent 10），经回源全部定性为「测试与环境/断言漂移」，非业务回归——但长期红灯会让真回归隐身。

---

## 二、代码量统计（仅 git 纳管文件）

### apps/desktop

| 范围 | 文件 | 行数 |
|---|---|---|
| `src/**`（ts+tsx，含单测） | 171 | **31,287** |
| ├ 非测试源码 | 161 | 29,428 |
| └ 单测（10 个 `__tests__` 文件） | 10 | 1,859（占源码 **6%**） |
| 样式（4 个 css，含 `pro-input.css` ~1,200 行） | 4 | 1,687 |
| `codewiki/` 文档（12 附录） | 21 md | 4,340 |
| 纳管文件合计 | **207** | — |

分区行数：`renderer/components` 14,919｜`services` 3,258｜`stores` 3,131｜`lib` 2,301｜`pages` 1,408｜`layouts` 797｜`hooks` 543｜`menu` 198｜`mocks` 165｜`platform` 102｜`main` 2,898｜`preload` 394｜`shared` 993。

热点文件：`chatStore.ts` 1,503｜`InputArea.tsx` 1,338｜`TemplateCard.tsx` 949｜`ipc-handlers.ts` 917｜`SecuritySection.tsx` 824｜`stream-handler.ts` 620。

### packages/modu-agent

| 范围 | 文件 | 行数 |
|---|---|---|
| `src/**` | 155 | **41,633** |
| `tests/**` | 90 | 15,636（占源码 **37.6%**） |
| 合计（ts） | 246 | **57,563** |
| 纳管文件合计 | **262** | — |

分区行数：`graph` 14,810｜`perception` 4,327｜`tools` 4,160｜`orchestration` 3,815｜`config` 3,728｜`core` 2,115｜`observability` 1,591｜`mcp` 1,353｜`reasoning` 1,255｜`feedback` 1,067｜`evolution` 1,009｜`memory` 780｜`skills` 725｜`kernel` 708。

热点文件：`graph/nodes.ts` 2,873（`makeAgentNode` 单函数 ~309 行、`makeHumanReviewNode` ~282）｜`agui-adapter.ts` 1,615｜`runner.ts` 1,441｜`graph.ts` 814。

### 两包合计

**88,556 行 TypeScript/TSX**（源码 70,061 + 单测 17,495），另有 desktop 4,340 行文档与 1,687 行 CSS。相邻 `packages/evals` 另有 21 文件 / 3,352 行（本轮澄清评测集所在）。

> 说明：`apps/desktop` 目录下另有打包产物（Electron.app、.asar、.dmg、.pak 等约 800 万行二进制），已全部按 git 纳管口径排除，不计入代码量。

---

## 三、门禁实跑结果

| 包 | typecheck | vitest |
|---|---|---|
| apps/desktop | `typecheck:node` + `typecheck:web` **0 错** | 133 例：**128 通过 / 5 红**（1 文件） |
| packages/modu-agent | `tsc --noEmit` **0 错** | 1,066 例：**1,056 通过 / 10 红**（3 文件） |

15 个失败逐一定性（全部回源确认，非猜测）：

1. **desktop 5 红｜`lib/__tests__/match-accelerator.test.ts`**——`isMacPlatform()` 直接读运行时 `navigator.platform`（`match-accelerator.ts:29`），而测试文件内**零平台 mock**（无 `vi.mock`、不注入 navigator），断言写的是 Windows 语义（`Ctrl+D → CmdOrCtrl+D`、`Ctrl+Comma` 展示不带 `⌃`）。→ 在任何 mac 上必红。**非 hermetic 测试**，建议把平台作为纯函数入参或提供注入点。
2. **modu-agent 6 红｜`tests/tools/sql-query.test.ts`**——源码已把「依赖缺失」与「SQL 执行错误」拆成独立错误码（`sql-query.ts:267-269` 注释明示 SQL_003→SQL_005），**测试断言未同步**；且这些用例把「better-sqlite3 未安装」当作前提条件。`better-sqlite3` 是 `optionalDependencies`，当前环境未安装。
3. **modu-agent 4 红｜`tests/observability/{exporters,metrics}.test.ts`**——`prom-client` 同样未安装 → `MetricsRegistry` 回落 no-op → `/metrics` 断言取到空。缺 `skipIf(!hasPromClient)` 之类的环境守卫。

结论：**没有一个是业务逻辑回归**，但测试套件对「可选依赖是否安装」「跑在哪个 OS」敏感，CI 环境一旦不同就长红，会淹没真信号。这是本轮第二值得投入的修复项（成本低于 1 天）。

---

## 四、分级问题清单

### P0（默认配置不触发；配置组合下即线上事故）

**P0-1 代码执行沙箱黑名单可被绕过（PoC 实证）**

- 位置：`src/tools/code-executor.ts:117-182`（CodeValidator）、`:58-64`（`_FORBIDDEN_NAMES`）、`:122-127`（import 检测）
- 机理两条：
  1. import 检测只有 `/^\s*import\s+/m` 与 `/^\s*from\s+\S+\s+import/m`，**只匹配行首**；`if 1: import urllib.request` / `for _ in [0]: import socket` 是合法 Python 且完全绕过。
  2. 模块黑名单只有 13 个名字，缺 `urllib / http / socket / gc / platform / tempfile / builtins / resource / codeop` 等。
- 实证：以下代码通过静态校验并进入子进程执行，成功读取任意本地文件（进程返回码 0，输出 `/etc/hosts` 前 60 字符）：

  ```python
  if 1: import urllib.request
  print(urllib.request.urlopen('file:///etc/hosts').read().decode().strip()[:60])
  ```

  同时确认 08-05 的老逃逸链（`().__class__.__bases__[0].__subclasses__()`）与 `open/os` 形态**已被拦住**（返回 CODE_002）——即加固有效但不充分。
- 现有缓解（重要，决定了它当前不是 P0）：`requiresApproval() = true`；desktop 仅在 `tools.human_in_loop.enabled` 为真时才注册该工具（`agent-runtime.ts:241-253`）；`config.yaml:22-25` 默认把 `code_executor` 列入 `sensitive_tools`；guardrail `guard_code_executor_network` 已能命中 `urllib|socket|http`（该文件参数名错配问题已修复）。
- 判定：**默认 HITL 开启时为 P1（纵深防御层失效）；任何宿主关闭 HITL 或另行注册该工具即升级为 P0**。文件头已自陈「弱沙箱 + 强审批」，因此更准确的处置是把这个前提写成硬约束：`if (!hitlEnabled) refuse to register code_executor`，并把 import 检测改为真正的 Python 语法解析（哪怕只在 `-I` 子进程里先跑 `ast` 白名单预检）。

### P1

**P1-1 code_executor 在 macOS 上 100% 不可用，且被假绿测试掩盖**（本轮新发现）

- 位置：`code-executor.ts:207-221`（`buildResourceLimitPreamble`）、`:351-358`（POSIX 无条件注入 preamble）
- 实证：`invoke({code:'print(1)'})` 返回 `CODE_003`，stderr 为 preamble 第 7 行 `resource.setrlimit(RLIMIT_AS, (536870912,536870912))` → `ValueError: current limit exceeds maximum limit`。用户代码根本没机会执行。macOS 对 `RLIMIT_AS` 的支持与下限语义与 Linux 不同，硬设 512MB 会被拒。
- 掩盖原因：`tests/tools/code-executor.test.ts:69-86` 的正常路径断言是 `expect(r.error_code).not.toBe('CODE_002')`，**从不断言 `status==='success'`**，注释还写明「环境缺 python3 也算通过」。所以 1,056 个测试全绿而工具是死的。
- 修复：preamble 里 `try/except ValueError: pass`（或先 `getrlimit` 取当前 soft/hard 再取 min）；测试补一条「真执行 `print(1+1)` 且 stdout=='2\n'」的强断言，并在缺 python3 时 `skipIf` 而非静默放行。

**P1-2 组合模式入口路由断链（08-05 至今未修，本轮 PoC 复现于 V2.6）**

- 证据链：
  - `graph/graph.ts:478-483` 声明「解除互斥，组合模式下 plan_execute 优先入口」；
  - `graph/graph.ts:667-672` 该模式下生效的 `memory_query` 边 targets 只有 `{agent, planner}`；
  - `config/runtime-config.ts:98-101` 的 `mode_router` **首条规则**是 `multi_agent.enabled → 'supervisor'`，`nodes.ts:2417-2426` 按顺序首个命中即返回；
  - 内置回退（`nodes.ts:2424-2426`）同样 multi_agent 优先。
- PoC 输出（配置 multi_agent + plan_execute 同时为真）：`routeAfterMemoryQuery = supervisor`，生效边目标集 `{agent, planner}` → LangGraph 运行时 unknown destination 崩溃。
- 为什么没被发现：`tests/graph/graph-spec-equivalence.test.ts:232`「组合模式：全部节点与分支共存」只对节点/边**清单快照**，不校验「路由器值域 ⊆ 声明 targets」。而 `step_dispatch` 那条边倒是用 `has('supervisor')` 动态补齐了目标（`graph.ts:694-704`）——修一半留下的不对称。
- 可达性：desktop 的 `ALLOWED_AGENT_MODES` 只放行 `react_agent/plan_execute`（`agent-runtime.ts:146`），但运维可在 `config.yaml` / `config_overrides`（进化闭环会写）里打开 multi_agent，此时任何 plan_execute 请求即崩。
- 修复：把 `mode_router` 规则顺序改为 plan_execute 优先，或让 `memory_query` 边目标集与 `step_dispatch` 一样按 `has('supervisor')` 动态生成；同时给等价性测试加「路由器值域 ⊆ targets」的全边不变量断言（这条不变量能一次性兜住同类断链）。

**P1-3 图片附件全链路断裂（老问题，仍未修）**

- `shared/types.ts:107-131` 的 `SendMessageRequest` **没有 images 字段**；渲染层 services 目录对 `images` 零引用（grep 验证）。
- 实际行为：`InputArea.tsx:857-865` 把附件交给 `onSend` → `chatStore.ts:663,742` 只挂到本地 `userMessage.images`（展示/落本地库）→ 发请求时只带 `buildSendText(content)`（`chatStore.ts:927`）。纯图片消息会以字面量 `[User attached images without additional text.]` 作为 prompt 发给模型（`image-attachments.ts:25`、`InputArea.tsx:855`）。
- 内核侧同样空转：`runtime-config.ts:221` 声明 image pipeline 需要 `image_processor`，但默认只注册 `text_preprocessor`（`factory.ts:551`、`builtin-processors.ts:47-90`），缺组件时 `pipeline.ts:92-94` 只 warn 后跳过。
- 判定：UI 完整（粘贴/拖拽/预览/上限校验）但能力不存在。要么接上（协议 + `content` 多模态块 + `image_processor` 注册），要么把入口置灰并说明「暂不支持」——现在这样是承诺与交付不一致。

**P1-4 右栏「待办」渲染伪造的已完成任务**（本轮新引入）

- `right-panel/RightPanel.tsx:55` 以 `<TaskMonitor />` 无 props 调用 → 落到 `TaskMonitor.tsx:44-49` 的 `DEFAULT_TODO_ITEMS`：4 条硬编码、全部 `completed: true`、内容还是某次历史会话（「搜索今日（2026-08-16）AI Agent 相关新闻」…），并且该分组 `defaultExpanded`（`:316`）。
- 后果：任何用户任何会话打开任务监控，都会看到一段不属于自己的「已完成」进度。注释自己承认「暂时沿用默认值」，但这是 shipped 的假数据。
- 修复：默认值改空数组（走 `:341-343` 已有的「暂无待办项」分支），待办从 `STATE_DELTA`/plan 事件注入。

### P2

**P2-1 安全设置页 9 个开关全是装饰**——`SecuritySection.tsx:36-46` 用 `useState` 持有沙箱、自动备份、备份上限、敏感保护、删除保护、批量阈值、node/python/gitbash 运行时开关，`onChange` 后既不落 store 也不发 IPC；而「沙箱」默认显示为**开启**，属于误导性的安全承诺。

**P2-2 斜杠命令有功能承诺、无执行器**——`CommandPalette.tsx:99-146` 的 `/clear`（hint「清空当前对话」）、`/plan`（「进入计划模式」）、`/help`、`/optimize`（「优化当前提示词」）均为 `kind:'insert'`，`InputArea.tsx:745-749` 只插入 token；全仓（desktop + backend-ts + modu-agent）不存在任何 `/clear` 消费者（grep 验证）。用户回车即把字面量塞进模型 prompt。注意该文件头注释写着「仅收录当前已落地的能力，不引入未实现的功能入口」——与注册表实际内容矛盾。

**P2-3 草稿把 base64 图片写进 electron-store，主进程同步清洗并整档重写**——`input-drafts.ts` 的 `InputDraftValue.images` 即 `ImageAttachment.dataUrl`（单图上限 20MB，`image-attachments.ts:22`，base64 后约 27MB 字符串）；`ipc-handlers.ts:505-517` 的 `STORE_SET` 每次做 `JSON.parse(JSON.stringify(value))`（`:185-191`）后由 electron-store 同步落盘。输入去抖 400ms 内多次触发即多次整档重写；未发送而丢弃的草稿永久驻留（仅发送成功 `clearDraft`）。建议：图片草稿走独立二进制/临时文件或根本不持久化，`STORE_SET` 对大对象设阈值拒绝。

**P2-4 抢占式 abort 不通知内核（现网触发面小）**——`chatStore.ts:677-678` 仅 `abortController.abort()`，`ipc-transport.ts:106` 的 abort 语义是「只退订」，不调 `AGENT_STOP` → 主进程 run 继续跑完并白烧 token。`stopStreaming` 是正确的（`:987` 调 `transport.stop`）；UI 在 `isStreaming` 时禁用发送按钮与快捷键（`InputArea.tsx:970,1220,1303`），所以主要残留在 `regenerateMessage` 等程序化路径。建议：abort 分支统一补 `void transport.stop(sessionId)`。

**P2-5 主进程 STORE_* 通道无键空间约束**——`ipc-handlers.ts:500-523` 允许渲染端读写任意 key。当前 CSP `connect-src` 只放行本机回环（`main/index.ts:46`）限制了外泄，但渲染端一旦被攻破可持久化改写后端地址等配置项。建议白名单前缀（`input-draft:`、`settings:`）+ 拒绝其他。

**P2-6 测试 hermeticity 系统性缺失**——见第三节：可选依赖未装 / 跑在非 Windows 平台就长红。建议 `skipIf` + 平台注入点 + 把 SQL 错误码断言按新语义改正。

### P3

- **P3-1 `plan_confirm` 只有协议和 UI，没有生产者**：`agui-adapter.ts:52-72, 1511-1566` 定义了 kind 与 artifacts 校验/透传，但 `src/**` 中无任何节点 `interrupt({kind:'plan_confirm'})`（grep 全仓验证）；desktop 唯一入口是 dev-only `/mock-plan`（`CommandPalette.tsx:153-163`）。属已知「前端先行」，但要防它变成永久占位。
- **P3-2 本地模式 HITL 恢复丢 artifacts**：`agent-runtime.ts:454-468` 显式构造 `HitlStateResponse` 时未透传 `state['artifacts']`，而 `shared/types.ts:370` 与 `hitlStore.ts:275` 都会消费 → 本地模式下重载会话后方案确认卡没有产物列表（云端 `/agent/state` 已在 a419914 补透传，两边不对齐）。
- **P3-3 `extractJsonBlock` 不处理字符串内的花括号**（`clarity-detector.ts:215-228`）：模型生成的追问里含 `{}` 时括号计数错位 → JSON 解析失败 → 静默 `llm_judge_failed` 放行。另 `llmJudgeClarity/llmPolishQuestion`（`:231-287`）无超时与 token 预算（默认关闭故未触发）。
- **P3-4 结构热点**：`graph/nodes.ts` 2,873 行且 `makeAgentNode` ~309 行；`chatStore.ts` 1,503 行；`InputArea.tsx` 1,338 行。`chatStore.ts:1013-1020` 在浅拷贝后原地改写 trace 节点（`n.status='completed'`），与 zustand 不可变约定相悖，`TaskMonitor.tsx:291` 还有一处 `(m as any).attachments`（全仓仅 3 处 `any`）。
- **P3-5 页面完成度**：9 条路由（`App.tsx:137-147`）中 `AssistantPage / MorePage / MyFilesPage` 为纯占位；`PluginsPage.tsx:9` 自陈「纯前端静态数据，安装与管理状态仅维护在本页本地」，`AutomationPage` 同构——UI 完整但无后端动作（较 09-30 基线的 5 个占位页已有改善）。
- **P3-6 `chatStore ↔ hitlStore` 双向 import**（`chatStore.ts:40` / `hitlStore.ts:23`）：靠 `getState()` 惰性调用不致崩，仍是脆弱耦合，建议把 `toHitlItem`/队列契约下沉到 shared 层。
- **P3-7 语义检索名不副实**：`memory/chroma.ts:153-175` 默认 hash embedding，`setEmbeddingFunction` 在 `src/**` 与 `apps/**` 均**零调用**（grep 验证）→ 长期记忆/知识检索实际是词面哈希相似度，召回质量与配置宣称（`store_type: 'chroma'`）不符。

### P4（可选打磨）

- `main/index.ts` 未挂 `webContents.on('will-navigate')`（只处理了 `setWindowOpenHandler`）；未设 `setPermissionRequestHandler`。当前 IPC 侧有 `isTrustedSender` 二次把关（`ipc-handlers.ts:117-127`），风险有限，但导航到远程页会带着 preload 注入。
- CSP `img-src 'self' data: blob:`（`main/index.ts:44`）不放行 https → 模型回答里的远程图片必然降级为占位文本（`MarkdownRenderer.tsx:104` 有兜底，行为正确但用户看不到图）。
- 观测日志里存在 `logger.info('...%s', x)` 风格与模板串混用（如 `[metrics] ... elapsed=%.2fms`），部分格式化未生效（`rollback] Recorded quality score %.3f for 0.9 version comp` 可见原始占位符）。

---

## 五、经回源确认「已修」的历史结论

对照 08-05 / 09-30 基线，以下问题在 V2.6 已确实修复，不应再计入待办：

1. **guardrails 规则参数名错配**：`tools/tool-guardrails.ts:60-107` 已改为 `op: '=write'` / `query: 'INSERT|...'`，并带修复注释与精确匹配语义；消费链路已接通（`graph/nodes.ts:2005-2008`、`decideToolApprovals`）。
2. **感知组件零注册空转**：新增 `perception/builtin-processors.ts`，`factory.ts:551` 启动时注册 `text_preprocessor`（显式只注册本地处理器，`llm_parser` 留给宿主 opt-in，注释说明理由）。
3. **组合模式下 `step_dispatch` Send 到未挂载 supervisor 崩溃**：`plan-execute/dispatcher.ts:34-46, 231-255` 加了 `_isSupervisorAvailable()` 守卫并降级 agent（P1-15），配套测试。⚠️ 但入口边 `memory_query` 的同型问题未修，即 P1-2。
4. **HITL 暂停态抢占**：`chatStore.ts:666-675` 新增暂停守卫（P0 阶段三），`stopStreaming` 走统一 `hitlStore.dismiss()`（`:953-963`）；`validateResumeRequest` 已透传 `answer/answerId`（`agent-runtime.ts:180-192`，修的是「本地模式澄清答案永远为空」）。
5. **代码执行加固**：错误码语义拆分、`_FORBIDDEN_ATTRS/_FRAGMENTS` 补齐 dunder 字符串形态、字符串拼接启发式、审计事件（`publish_security_audit_event_sync`）、POSIX rlimit（但其本身引入 P1-1）。
6. **主进程安全面**：S1/S6 严格主机名匹配、S4 符号链接逐级 realpath 回退、B5 `Buffer.byteLength` 单位统一、B6 净化失败拒绝写入、M5/B13 拖拽状态按 webContents 分片并在 closed 清理、S2 移除裸 `wss:`、S3 外链协议白名单、S8 `getPathForFile` 异常兜底、H5 不再暴露整包 preload API。
7. **密钥治理**：`key-store.ts` 用 safeStorage 加密敏感键 + 受管键白名单 + 掩码回显 + 删除即清 env；`SECURE_KEY_SET` 后主动 `invalidateAgentGraphCache()`（`ipc-handlers.ts:819`）解决「改 key 不生效」。

---

## 六、修复优先级建议（按投入产出）

| 顺序 | 动作 | 规模 |
|---|---|---|
| 1 | rlimit preamble 容错 + 补一条真执行断言 | 极小，直接救活 macOS 上的代码执行 |
| 2 | `mode_router` 规则顺序/边目标动态化 + 给等价性测试加「路由器值域 ⊆ targets」不变量 | 小，顺带防同类断链 |
| 3 | 清掉 15 个红：SQL 错误码断言同步 + 可选依赖 `skipIf` + 快捷键测试平台注入 | 半天，恢复 CI 信号可信度 |
| 4 | `TaskMonitor` 默认待办清空 + `SecuritySection` 装饰开关落地或标注预览 | 小，产品诚信 |
| 5 | 图片链路：协议加 images/多模态块 + 注册 `image_processor`；或先把入口置灰 | 中，需产品决策 |
| 6 | `code_executor`：import 检测改行法/AST 级 + 宿主侧「HITL 关闭即不注册」硬约束 | 中 |
| 7 | 草稿大对象旁路、`STORE_*` 键白名单、abort 补 `transport.stop` | 小-中 |

---

## 附：本轮 PoC 与验证记录

- `print(1)` 经 `CodeExecutorTool.invoke` → `CODE_003`，stderr 指向 preamble `setrlimit` `ValueError`。
- `if 1: import urllib.request` + `file://` 读取 → 静态校验通过、子进程 RC=0、输出 `/etc/hosts` 内容（PoC 仅读系统公开文件，写探针均指向 `/tmp` 且即时删除）。
- 老逃逸链 `().__class__.__bases__[0].__subclasses__()`、`open(...)`/`import os` → `CODE_002` 已拦。
- 组合模式：`resolveGraphProfile({multi:true, plan:true})` → `composeDefaultGraph` 生效边 targets `{agent, planner}`，`routeAfterMemoryQuery` 返回 `'supervisor'`，断言失败。
- 两个临时测试文件均已 `mv -n` 至 `~/.Trash/`，`git status --short` 无输出（仓库干净）。
