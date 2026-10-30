# Pioneering 优化建议（产品 + 架构）

> **来源**：基于《Pioneering 项目全面评估报告（产品 × 架构）》中已核实的证据做方案设计，不重复代码审查。
> **规模**：产品 27 条 + 架构 35 条 = **62 条**，每条含「针对的问题（附路径）→ 具体做法 → 预期收益 → 成本 → 优先级 → 验收方式」。
> **口径**：成本为熟悉仓库的 1 名高级工程师人日估算，不含跨团队等待。性能类收益**一律不预设百分比**，改用「可测量项 + 测量方法」。
> **日期**：2026-10-30

## 0. 交付说明与使用方式

**三条使用前提**

1. **62 条里有 11 条依赖业务/部署决策**（产品 9/16/18/24，架构 5/19/27/28 及部分子项）。这些条目标注「需要业务决策」，列出的是**决策前可先做的工作**，不要直接派人开工终局方案。
2. **优先级 P0 不等于「全都现在做」**。P0 里也分两种：一种是「不做会持续产生错误数据或错误承诺」（如 token 估算、全终态结算、假承诺下线），另一种是「不做会挡住后续」（如 CI、schema 所有权）。前者按天算损失，后者按批次算。
3. **性能类建议必须先建基线再改**。架构章第 9/10/13/15/16/17 条都要求先采集 baseline，否则无法证明收益——这是刻意设计，避免「改完感觉快了」。

**一处交付完整性说明**

架构建议产出过程中，架构师在写完文件并汇报后遭遇 429 频率限制，其原计划的自我复核轮次未能完成。我已独立复核该文件：**302 行完整、35 条齐全、四维度结构与结尾的执行顺序段落均正常收束**，无截断。其中涉及的文件路径与行号我已抽检 12 处，均与仓库实际一致。若后续需要架构师补充论证，需要等限流重置（2026-10-31 04:23 后）。

**产品建议中已修正的 8 处路径错误**

汇编时核实并修正了以下引用（原稿路径有误，行号与结论不受影响）：

| 原稿 | 实际路径 |
|---|---|
| `apps/web/src/pages/Chat/ChatInput.tsx` | `apps/web/src/modes/chat/components/ChatInput.tsx` |
| `apps/web/src/pages/HelpPage.tsx` | `apps/web/src/pages/Help/HelpPage.tsx` |
| `apps/web/src/pages/AutomationPage.tsx` | **`apps/desktop/src/renderer/src/pages/AutomationPage.tsx`（属桌面端，非 web）** |
| `desktop/src/components/SidebarNav.tsx` | `apps/desktop/src/renderer/src/components/sidebar/SidebarNav.tsx` |
| `apps/marketing/src/components/TryComposer.tsx` | `apps/marketing/components/site/forms/TryComposer.tsx` |
| `apps/web/src/**/modes-boundary.test.ts` | `apps/web/src/modes/modes-boundary.test.ts` |
| `apps/web/src/components/Sidebar.tsx` | `apps/web/src/layout/Sidebar/Sidebar.tsx` |
| `apps/web/src/stores/sidebarGroupsStore.ts` | `apps/web/src/store/sidebarGroupsStore.ts` |

---

## 1. 一页总览：先做哪 10 条

按「影响 ÷ 成本」排序，这 10 条合计约 **17–26 人日**，覆盖了评估中 5 个 P0 风险中的 4 个：

| # | 建议 | 解决什么 | 预期收益 | 人日 |
|---|---|---|---|---|
| 1 | **架构 18**｜把 modu-agent + desktop 纳入 CI | 全仓 50% 的测试（21,466 行）从不执行 | 21k 行测试从「存在」变「门禁」；是一切重构的安全前提 | 2–3 |
| 2 | **架构 9**｜TokenEstimator 替换 chars/4 | 中文 token 系统性低估，污染上下文预算与配额 | 六处口径统一；成本计量第一次可信 | 3–5 |
| 3 | **架构 10**｜为 `chat_messages`/`chat_sessions` 补索引 | 两张热表零索引，每条消息都全表扫描排序 | 用 `EXPLAIN (ANALYZE, BUFFERS)` 直接量化；可 `CONCURRENTLY` 低风险 | 1–2 |
| 4 | **产品 14**｜补 web `/` 根路由 | 域名根路径直接 404 | 所有外部访问的第一跳不再硬失败 | 0.5–1 |
| 5 | **架构 6**｜禁止 checkpointer 静默降级 | sqlite 缺依赖时 HITL 暂停态随重启丢失 | 隐性数据丢失变部署前可见错误 | 1–2 |
| 6 | **产品 7**｜撤回 5 条不可兑现承诺 | 对外 9 条承诺兑现率仅 44% | 承诺兑现率 100%；降退款与合规风险 | 0.5–1 |
| 7 | **架构 12**｜所有终态都结算用量 | paused/error/abort 跳过 `recordUsage`，「停止 = 免费」 | 成本与上游账单可对账 | 2–3 |
| 8 | **架构 26**｜认证凭据加固 | JWT 存 localStorage；弱 secret 仅 warn | 消除 XSS 窃取主路径；弱密钥变部署门禁 | 3–5 |
| 9 | **产品 6**｜marketing CTA 接真实产品 | 唯一转化入口是 `setTimeout` 假提交 | 营销→产品从 0 条真实通路变可归因通路 | 1 |
| 10 | **架构 7**｜desktop 接入 `agent-protocol` | HITL 状态机与 bridge 各维护两份 | 删约 350 行重复，消除两端行为漂移 | 3–5 |

> **如果只能做一条**：做第 1 条。它是唯一一条「零业务决策、零架构改动、但让后面所有改动变安全」的建议。

**三道决策闸门（不决策就不要开工）**

| 闸门 | 卡住哪些建议 | 需要定的问题 |
|---|---|---|
| 业务：这是几个产品？ | 产品 9/10/12/13/18/24、架构 27/28 | 三条业务线（培训咨询 / 云端工具 / 本地执行）是否收敛为一个产品 |
| 部署：单实例还是多副本？ | 架构 5（终局）、部分 13/14 | 决定是否引入 Redis/PG 做 stop 广播、幂等租约、事件序列 |
| 数据：谁是 schema 所有者？ | 架构 19（终局）、27（下线） | TS 独占，还是 Python 继续负责存量表 |

---

## 2. 产品优化建议（27 条）

### 2.1 止血与信任修复（8 条）

> 这 8 条的共同判断：**当前 5 处假功能应优先「删/标」而不是「接起来」**。理由是接入真实能力的成本远高于下线的成本，而假功能对信任的伤害是即时且不可逆的。

**1. 隐藏无行为的语音按钮**（P0｜0.5 人日｜本周可做）
- 问题：三个输入框的语音按钮没有 `onClick`，点击零反馈（`apps/web/src/modes/chat/components/ChatInput.tsx:221-228`、`modes/pro/components/AnalysisInput.tsx:226-234`、`modes/task/components/TaskInput.tsx:221-229`）。
- 做法：选「删」——从渲染树移除按钮及多模态暗示，不保留 toast 占位；待真实音频链路就绪再恢复。
- 收益：消除 3 个确定的假入口，减少无效点击与「产品失灵」感知。
- 验收：三个输入界面均无语音按钮；无「可聚焦但无动作」的控件。

**2. 下架桌面端占位导航**（P0｜0.5 人日｜本周可做）
- 问题：3/5 导航项标了 `placeholder:true`，渲染函数却忽略该字段（`apps/desktop/src/renderer/src/components/sidebar/SidebarNav.tsx:30-50` 声明、`:90-118` 渲染）。
- 做法：选「删」——渲染前过滤 placeholder，同步隐藏对应快捷键与空状态入口；只保留两个真实目的地，不以禁用样式继续展示。
- 收益：桌面主导航可用项占比从 40% 升至 100%。
- 验收：导航与键盘切换只出现真实页面；补一条测试覆盖「placeholder 不渲染」。

**3. 清理伪帮助与法律链接**（P0｜1 人日｜本周可做）
- 问题：帮助页指向 `example.com`、`support@example.com`；11 分类中 10 个只 toast「暂未开放」；隐私政策/服务协议为 `href="#"`（`apps/web/src/pages/Help/HelpPage.tsx:95,118`）。
- 做法：选「删 + 接」——删除示例域名、假邮箱、未开放分类、空法律链接；有真实法务文本则接实际路由，没有则暂不显示入口。
- 收益：帮助入口可兑现率 100%，降低注册与付费前的信任风险。
- 验收：全站无 `example.com`、空 `href`、「暂未开放」；帮助链接返回 200 且内容对应标题。

**4. 收敛插件目录到真实供给**（P0｜1 人日｜本周可做）
- 问题：38 个插件仅 3 个可安装，使用量是手填示意值（`apps/web/src/pages/Plugins/catalog.ts:7` 自述）。
- 做法：选「删 + 标」——默认只列 3 个可安装项；其余从计数、搜索和营销材料移除，不展示伪造使用量。若要保留路线图，单列「规划中」区且不可点击安装。
- 收益：插件安装入口可用率 7.9% → 100%，宣传数量与真实供给一致。
- 验收：目录/搜索/对外文案只宣称可装数量；每个展示插件都能完成安装或明确报错。

**5. 将自动化页降级为本地模板工具**（P0｜0.5–1 人日｜本周可做）
- 问题：675 行页面只有本地状态，自述「不与后端调度系统联动」（`apps/desktop/src/renderer/src/pages/AutomationPage.tsx:9`）。
- 做法：选「标」而非仓促接调度——标题改为「自动化流程草稿（仅保存在本机）」，移除「运行/定时/已启用」等执行暗示；若草稿也不能导出，直接隐藏导航入口。
- 收益：避免用户把本地草稿误认为已在运行的任务。
- 验收：页面不再产生「系统会执行」的承诺；刷新行为与「仅本机」说明一致。

**6. 停止营销站的模拟提交**（P0｜1 人日｜本周可做）
- 问题：唯一转化入口明示「模拟提交，不产生任何请求」，全站 CTA 都收敛于此（`apps/marketing/components/site/forms/TryComposer.tsx:6`、`:43,50`）。
- 做法：选「接」——删除假进度/假成功/表单提交语义，改为真实链接按钮「进入产品」，指向修复后的 web 根路由并带 UTM。免费试用未决策前，不得暗示输入内容已发送。
- 收益：营销→产品从 0 条真实通路变为可追踪通路，避免假线索污染数据。
- 验收：点击实际到达产品并产生一次 CTA 事件；无网络请求时不得显示「提交成功」。

**7. 撤回当前不可兑现的对外承诺**（P0｜0.5–1 人日｜本周可做）
- 问题：9 条承诺中 5 条不可兑现——vision、免注册试用、知识溯源 RAG、¥99/月定价、38 插件（对照 `apps/marketing/data/site/agent.ts` 与 `backend-ts/src/config/models.ts:34-57`）。
- 做法：选「删/标」——从营销页、应用内介绍、定价与元信息删除定量承诺；RAG 标「规划中」，vision 在模型支持前不展示；试用与定价在决策前不报价。
- 收益：对外承诺兑现率 44% → 100%，降低退款与合规风险。
- 验收：以原 9 条承诺逐项走查，页面、分享摘要、定价、插件计数无残留。

**8. 明示深度思考的实际模型**（P0｜1–2 人日｜本周可做）
- 问题：deepThink 在服务端静默覆盖用户所选模型，选择器仍显示原值（`backend-ts/src/routes/chat.ts:608-611`）。
- 做法：选「标」——开启 deepThink 时把选择器切到 reasoning 并禁用冲突项，说明「深度思考使用推理模型」；响应记录实际 model，关闭后恢复用户此前选择。
- 收益：消除「显示的模型 ≠ 计费的模型」，减少错误预期。
- 验收：fast + deepThink 请求前后端均显示 reasoning；响应日志、配额记录与 UI 一致。

### 2.2 三模式重构（5 条）

**候选取舍**

| 方案 | 内容 | 成本 | 代价 |
|---|---|---|---|
| A 保留三模式并补齐 | 把工具/技能/HITL 接入 chat，维持三套矩阵 | 15–25 人日 | 入口稳定，但模式差异更难解释，重复测试长期存在 |
| **B 单模式 + 能力预设**（推荐） | chat 也接入 Agent 内核，以预设承载「快速问答/协作执行/完整任务」 | 12–18 人日 | 需迁移与高级能力发现率保障 |
| C 按任务场景重组 | 在 B 之上按写作/研究/开发改信息架构 | 18–30 人日 | 场景更自然，但需用户研究，场景交叉会造新边界 |

> **推荐 B 的核心理由**：它同时消除两个根因——chat 绕过内核（`routes/chat.ts:681` 直连 `llmService`）与会话绑模式（`layout/Sidebar/Sidebar.tsx:192-198`），并与 desktop 的单页 + 开关形态对齐；同时保留场景包与任务体验的差异化。

**9. 采用单模式与能力预设方案**（P0 方向 / P1 实施｜8–12 人日｜**需要业务决策**）
- 问题：能力由模式硬切，矩阵由测试强制（`apps/web/src/modes/modes-boundary.test.ts:37-41`）。
- 做法：统一会话页与 Agent 执行通道；模型/deepThink/netSearch/技能/工具改为显式能力配置。提供三个**预设**而非三种运行时；旧 `/chat`、`/pro`、`/task` 跳转到对应预设。先灰度，保留回滚开关。
- 收益：一套执行语义、一套安全机制、一套能力说明；长期减少三端重复维护，同时保留低门槛入口。
- 验收：同一会话在三个预设发起任务均走统一内核；能力只受开关与权限影响；旧 URL 不丢会话。

**10. 解绑会话与模式并迁移历史**（P1｜4–6 人日｜依赖第 9 条）
- 问题：会话被 mode 绑定，切模式丢上下文；`session.runtime` 只存不用（`schemas/chat.ts:12` 声明，`routes/chat.ts:188,212,227` 仅回显）。
- 做法：用 `session.runtime` 保存当前预设与能力快照，会话列表不按 mode 隔离；迁移旧会话时保留原 mode 为 `legacy_mode`，切换预设只影响后续消息，并在时间线记录配置变更。
- 收益：同一任务可从问答连续进入执行，消除「入口选错」导致的上文损失。
- 验收：旧会话迁移后消息完整；问答切完整任务无需新建会话，历史与产物仍可访问。

**11. 在重构前先公开能力边界**（P0｜1 人日｜本周可做，不受长期方案影响）
- 问题：模式卡只讲能力不讲限制（`components/welcome/ModeWelcome.tsx:18-40`）。
- 做法：作为过渡立即「标」——在模式选择卡与切换确认中列出三行真实矩阵：「chat 无工具/技能/HITL」「pro 无 Plan 时间轴/产物预览」「切模式会新开上下文」。
- 收益：用户在发起前即可选对入口，降低中途切换与失败预期。
- 验收：矩阵与 `modes-boundary.test.ts` 一致；三个入口说明与实际能力逐项相符。

**12. 将 HITL 保留为统一执行的安全底座**（P1｜3–5 人日｜依赖第 9 条）
- 问题：HITL 被模式隔离，chat 无 HITL；而三态 + 超时自动拒绝 + 暂停落半截消息 + resume 续写才是真实壁垒。
- 做法：单模式中默认对写操作、外部副作用、高风险工具强制 HITL；只读低风险工具可由用户设为自动。预设不得绕过超时拒绝与续写机制。
- 收益：能力开放不以牺牲安全为代价，把已验证壁垒变成全产品一致能力。
- 验收：快速问答预设开启写工具后仍出现审批；允许/拒绝/超时/暂停恢复四组端到端用例通过。

**13. 用场景模板承接差异化而非重建模式**（P2｜2–4 人日｜第 9 条稳定后）
- 问题：配置驱动场景包、Plan 时间轴、工具轨迹是真实壁垒，简单合并入口可能削弱高级能力发现。
- 做法：把场景包做成预设模板，声明默认模型/能力/是否 Plan/轨迹与产物布局；「完整任务」默认展开 Plan+轨迹+产物。模板可保存复用，但不复制运行时代码。
- 收益：保留专业用户效率与演示价值，同时避免再造 N 套能力矩阵。
- 验收：从模板创建会话能正确应用配置；切换模板只改配置与视图，不改内核。

### 2.3 首次体验与转化链路（4 条）

**14. 补齐 web 根路由**（P0｜0.5–1 人日｜本周可做）
- 问题：`apps/web/src/App.tsx:97-122` 无 `/` 路由，域名首页直接 404。
- 做法：新增 `/`——已登录跳默认会话入口，未登录跳登录/试用入口；保留 query 中的 UTM 与 `returnTo`；未知路由显示可返回首页的 404。
- 收益：消除所有外部访问的第一跳硬失败，使营销导流可用。
- 验收：直接访问 `/` 在两种登录态均不 404；登录后回到原目标，UTM 不丢失。

**15. 用真实示例缩短首次成功路径**（P1｜2–3 人日｜本周可做基础版）
- 问题：根路由断裂 + 模式卡偏能力说明，新用户缺少从进入到首个结果的明确路径。
- 做法：空会话页提供 3 个可直接发送的真实示例：快速问答、带审批的工具任务、带 Plan/产物的完整任务。示例只调用现有能力，**不用录制结果冒充执行**。
- 收益：缩短首次消息/任务时间，并自然展示 HITL 与 Plan 壁垒。
- 验收：三个示例在测试环境均能完成；埋点可区分示例与自发任务；无假成功结果。

**16. 决策并最小化匿名试用边界**（P1｜决策 0.5 + 实施 5–8 人日｜**需要业务决策**）
- 问题：对外承诺免注册试用但无真实能力；直接开放又带来模型成本与滥用风险。
- 做法：业务先定是否以试用获客。若做，最小范围＝「每设备/IP 1 个临时会话、5 条文本消息、仅 fast、无工具/文件/插件」，服务端限额 + 验证码防滥用，第 3 条后展示注册保留上下文 CTA。若不做则持续删除承诺。
- 收益：以受控成本验证「访问→首次回答→注册」漏斗，而非先开放全能力。
- 验收：未登录可完成真实回答且第 6 条被阻断；限额按服务端执行；注册后能接续临时会话。

**17. 建立营销到产品的可归因跳转**（P1｜1–2 人日｜本周可做）
- 问题：marketing 与产品零链接，双域名无法评估哪个入口带来激活。
- 做法：所有真实 CTA 统一带 `utm_source/medium/campaign` 指向 web 根路由；落地后写入首方会话归因，登录/注册时继承。**不在 URL 传递 prompt 或敏感内容**。
- 收益：可计算 CTA 点击率、落地成功率、注册率、首次任务率。
- 验收：四组不同 UTM 的端到端访问均能在注册与首次任务事件看到原归因；URL 无提示词内容。

### 2.4 一致性与信息架构（4 条）

**18. 决策唯一对外品牌与主域名**（P0｜决策 1 + 实施 3–5 人日｜**需要业务决策**）
- 问题：并存 创路Agent / Pioneering / 知境 COGNILAB / 知境智能体 及 cognilab.com、pioneering.ai。
- 做法：业务确定「一个产品名 + 一个公司/实验室背书 + 一个主域名」，形成旧名映射；营销、web、desktop、登录、邮件、法务统一替换，次域名 301 到主域。**决策前冻结新增品牌名，不擅自选名**。
- 收益：降低认知割裂与跨域信任成本，为链接、SEO、归因提供唯一口径。
- 验收：关键页面与安装包只出现批准的品牌层级；旧域逐页 301；无混合 title/logo/联系方式。

**19. 建立跨端链接单一来源**（P0｜1–2 人日｜校验脚本本周可先做）
- 问题：`apps/desktop/src/shared/links.ts:18-26` 声称与 marketing 的 `OFFICIAL_SITE` 对齐，但该常量不存在（`apps/marketing/lib/constants.ts` 只有 `BRAND='Pioneering'`）。
- 做法：品牌确定后，在共享配置或构建注入中定义真实 `OFFICIAL_SITE` / 帮助 / 隐私 / 条款 URL；两端引用同一组值，删除手写示例链接，并对关键链接做**构建期校验**。
- 收益：避免下次改域名漏一端，消除「指向不存在常量的假对齐」。
- 验收：desktop 与 marketing 输出同一主域；构建遇到空链接、`example.com` 或未定义常量即失败。

**20. 同步会话分组并提供本地降级**（P2｜3–4 人日｜设计本周可做）
- 问题：分组仅落 localStorage（`apps/web/src/store/sidebarGroupsStore.ts:5-8`），换浏览器或清缓存即丢。
- 做法：登录后把分组名、排序、会话归属存到用户维度；本地作离线缓存并监听跨标签更新，冲突以更新时间最后写入为准；未登录明确标「仅本机」。
- 收益：减少整理成果丢失，支撑跨设备连续使用。
- 验收：两个浏览器登录同账号看到一致分组；离线修改恢复联网后无重复分组或会话丢失。

**21. 修正 MCP 与技能设置的归属和权限反馈**（P1｜3–5 人日｜单用户持久化本周可做）
- 问题：MCP 全局单例且不落盘（`backend-ts/src/routes/mcp.ts:194-200`），技能写操作却要 `adminGuard`（`routes/skills.ts:208-209`）——同一页面两个 tab 权限模型相反。
- 做法：MCP 至少按当前用户持久化；若定位为工作区共享则须明确权限模型。普通用户不可写的技能设置应隐藏或禁用并说明「需管理员」，不要允许编辑后才失败；重启后恢复配置。
- 收益：避免配置互相污染、重启丢失、无效编辑，形成可信设置闭环。
- 验收：两用户配置互不影响；重启后保留；普通用户与管理员看到的可写能力一致。

### 2.5 能力与定价的真实化（3 条）

**22. 校准中文 token 与配额计量**（P1｜3–5 人日｜本周可做｜与架构 9 同源）
- 问题：至少 5 处以 chars/4 估算 token（`core/quota.ts:67,69`、`core/context-budget.ts:43`、`core/quota-reservation.ts:173`），中文被显著低估。
- 做法：服务端统一使用目标模型 tokenizer；无法精确时用中文保守校准并标注为估算。上下文预算、预留、结算共用同一计量模块；响应后以真实 usage 对账；超限时提前提示而非静默截断。
- 收益：降低上下文超窗与配额偏差，为试用限额与套餐定价提供可信成本底座。
- 验收：建立中文/中英混合/代码测试集与模型 usage 对照；预留与结算同口径；边界请求有明确提示。

**23. 补齐三个真实插件的安装与用量闭环**（P1｜3–5 人日｜本周可做）
- 问题：目录供给虚高，示意使用量无法帮助用户判断插件价值（`apps/web/src/pages/Plugins/catalog.ts`）。
- 做法：只为已开放的 3 个插件补齐安装中/成功/失败、权限说明、卸载、真实调用次数；无数据时显示「暂无调用」，**禁止随机或硬编码数字**。
- 收益：把有限但真实的插件能力做成可验证价值，为后续扩展提供需求数据。
- 验收：每插件完成安装→调用→卸载；失败可重试；调用计数与后端日志一致。

**24. 基于真实成本重算套餐后再报价**（P1｜决策 2–3 人日｜**需要业务决策**）
- 问题：¥99/月当前不可兑现；模型、上下文、插件、试用成本未形成统一计量，价格缺单位经济依据。
- 做法：业务先定目标客群与毛利底线；以真实 token、任务次数、并发、存储、插件与支持范围设计 1 个基础套餐，写明限额与超额策略。**完成第 22 条且积累至少两周用量基线前不恢复固定价格**。
- 收益：避免低价承诺不可持续或高配限制引发退款。
- 验收：套餐页每项都能映射到系统强制限额；用真实样本核算收入、成本与毛利；超额路径可执行。

### 2.6 产品度量（3 条）

**25. 建立最小首方事件采集**（P0｜3–4 人日｜本周可做）
- 问题：当前几乎没有产品度量，无法判断模式、HITL、任务或导流是否有效。
- 做法：先在现有后端新增轻量事件接口/表，不急于接大型平台。采集 `cta_clicked`、`session_started`、`preset_selected(mode)`、`message_sent`、`hitl_requested/decided`、`task_started/finished`、`artifact_previewed/exported`、`plugin_install_finished`；公共字段含时间、客户端、匿名/用户 ID、会话/任务 ID、预设、模型、UTM、`schema_version`。**严禁上传 prompt、文件和工具参数正文**。
- 收益：以最小数据形成转化与质量基线，并支撑三模式迁移前后对照。
- 验收：关键流程事件顺序、字段、去重稳定；服务端校验非法事件；抽查载荷不含内容正文。

**26. 建立四个核心漏斗与统一口径**（P0｜2–3 人日｜事件字段确定后本周可做）
- 问题：仅有点击量会掩盖任务失败、审批超时和产物未被消费。
- 做法：看板固定四组指标——① 模式/预设使用率＝各预设启动会话数/总会话数；② HITL 通过率＝允许/(允许+拒绝+超时)，另列超时率；③ 任务完成率＝成功/(成功+失败+取消)，按预设拆分；④ 产物导出率＝有导出任务数/有产物的成功任务数。另加营销 CTA→落地→注册→24h 首次成功任务漏斗。
- 收益：直接衡量核心价值与重构收益，避免用消息量替代任务成功。
- 验收：用固定测试样本手算与看板一致；取消/超时/无产物不错误计入成功或导出分母。

**27. 把真实性检查纳入每次发布**（P1｜1–2 人日｜本周可做）
- 问题：无行为按钮、placeholder、示例链接、模拟提交、虚高数量同时存在，说明仅靠代码审查挡不住假功能回流。
- 做法：发布清单增加「所有 CTA 有真实动作、所有承诺可演示、所有数量来自真实配置」；CI/端到端检查空 `href`、`example.com`、placeholder 导航、无 handler 按钮及「模拟/暂未开放」文案，例外必须登记负责人与到期日。
- 收益：把信任修复从一次性清理变为持续约束，降低复发率。
- 验收：故意加入一个假链接或占位入口时检查失败；三端扫描无未登记例外。

---

## 3. 架构优化建议（35 条）

### 3.1 可扩展性（8 条）

**1. 建立按模型解析的 ProviderRegistry**（P0｜3–4 人日）
- 问题：`backend-ts/src/core/llm-gateway.ts:34-37` 的 `resolveProvider` 忽略 model 参数；`core/agent-bridge.ts:141-153` 又直读单一 `LLM_*`；新增 provider 需改 8–10 处。
- 做法：新增 `core/provider-registry.ts` 与 `config/providers.ts`，以 `alias→model_id→provider→secretRef/baseUrl` 为唯一解析链；`resolveProvider(model)` 必须消费解析结果，`agent-bridge` 注入同一 registry，禁止回退全局 env。
- 收益：新增 provider 从 8–10 处收敛为「1 份配置 + 1 个适配器」，消除模型与密钥错配。
- 风险与回滚：可能暴露既有隐式默认模型；保留旧 resolver 一个版本，按配置切回并记录回退原因。
- 验收：同进程用两个不同 baseUrl/apiKey 的契约测试分别命中正确上游；未知 provider 明确报错；全仓无新增直读 `LLM_API_KEY` 的业务路径。

**2. 收敛 Agent 与 Chat 的 LLM 可靠性策略**（P1｜4–6 人日）
- 问题：`routes/chat.ts` 经 llm-gateway 获得熔断/重试/指标；`packages/modu-agent/src` 的 LangChain 自建调用面无同等保护，且未 import `llm-*`（grep 零命中）。
- 做法：在 `packages/modu-agent/src/graph/adapters` 增加 gateway-backed ChatModel 适配器，由 `core/agent-bridge.ts` 注入；超时/重试/熔断只归 gateway，LangChain 层关闭重试，沿用同一 model catalog 与计量上下文。
- 收益：两条调用链共用一套可靠性语义，减少一套自建 LLM 调用维护面，Agent 故障可观测。
- 风险与回滚：双重重试会放大延迟与费用；用配置仅对 `/agent` 灰度，保留原适配器并验证最大尝试次数恰为 1 层。
- 验收：故障注入下 `/chat` 与 `/agent` 的超时/重试/熔断行为一致；同一请求只产生一条逻辑调用链与一份 usage。

**3. 用场景包 Manifest 替换模式硬编码**（P1｜3–4 人日）
- 问题：`core/agent-bridge.ts:161-164` 将 `react_agent`/`plan_execute` 固定映射到领域，新增场景需改宿主。
- 做法：在 `packages/modu-agent/src/kernel` 定义含 `id/domain/graph/tools/skills/prompts/version` 的 manifest；宿主启动时扫描显式配置的场景包并校验冲突，`MODE_DOMAIN` 仅作兼容迁移表。
- 收益：新增场景从「改内核」变为「注册一个版本化包」，可独立测试与启停。
- 风险与回滚：动态加载扩大依赖与权限边界；先只允许静态白名单包，配置关闭即回到内置两模式。
- 验收：测试新增场景包无需修改 `agent-bridge.ts`；重复 domain、未知工具、版本不兼容在启动时失败。

**4. 抽出唯一的 AgentRuntime 装配契约**（P1｜5–7 人日）
- 问题：`backend-ts/src/core/agent-bridge.ts`（1,150 行）与 `apps/desktop/src/main/agent-runtime.ts` 各自装配同一 TS 内核，行为易漂移。
- 做法：新建 `packages/agent-runtime`，只承载 TS 的 graph/checkpointer/gateway/tool 装配与生命周期；backend 与 desktop 各保留薄适配器处理 Fastify 与 IPC，**不搬 UI**。
- 收益：两份装配实现收敛为一份，桌面与云端差异由显式配置表达。
- 风险与回滚：两端生命周期不同可能造成资源提前释放；先让 backend 消费，desktop 灰度后再删旧实现，包版本可独立回退。
- 验收：同一 fixture 在两宿主得到相同图配置与事件序列；原生资源销毁、暂停/恢复测试通过。

**5. 为 Run 协调建立可持久化边界**（P1｜接口化 2–3 + 持久化 6–10 人日｜**依赖部署决策**）
- 问题：`routes/chat.ts`、`routes/agent.ts` 的 stop、限流、幂等、回放均用进程内 Map；多实例后请求可能落到错误实例。
- 做法：先在 `core/run-events.ts` 等模块定义 `RunRegistry`/`IdempotencyStore`/`EventStore` 接口与容量语义；单实例保留内存实现。确定多副本后，再以 PG/Redis 实现 stop 广播、幂等租约、事件序列——**不先引入无用途的基础设施**。
- 收益：消除水平扩容的架构硬阻断；决策前即可得到可测试边界。
- 风险与回滚：分布式锁与事件排序提高复杂度；保留单实例开关，持久层不可用时 readiness 失败而非伪降级。
- 验收：双实例测试中跨实例 stop 生效、同幂等键仅执行一次、断线按序补齐；单实例模式不回归。

**6. 禁止 Checkpointer 静默降级**（P0｜1–2 人日）
- 问题：`packages/modu-agent/src/graph/factory.ts:201-276` 在 sqlite optional dependency 缺失时退回内存，暂停态随重启丢失，而配置看起来是持久化的。
- 做法：生产配置 `sqlite` 时缺依赖或打开失败**直接 readiness/startup 失败**；只有显式 `allowVolatileCheckpointer=true` 才允许内存模式，并暴露醒目指标；补原生依赖 smoke test。
- 收益：把隐性数据丢失变为部署前可见错误，避免错误承诺持久化。
- 风险与回滚：现有误配环境会启动失败；发布前扫描配置，开发环境可显式开 volatile，回滚只恢复配置不恢复静默行为。
- 验收：缺 sqlite 绑定时生产启动失败；重启后暂停/恢复成功；volatile 模式有日志、指标、状态接口标识。

**7. 复用跨端协议而非强并 UI**（P1｜3–5 人日）
- 问题：web/desktop 文本重合仅 1.45%、共享代码 0 行，10 个 shadcn 原语全不同；但 `packages/agent-protocol`（955 行）只被 web 使用，desktop 另留 `hitlStore.ts`(318) + `hitl-bridge.ts`(32)。
- 做法：让 desktop 安装并消费 `@pioneering/agent-protocol`，用 adapter 把协议事件接进现有 store；先统一 HITL/AG-UI 类型、事件校验、纯 reducer，**明确不合并 CSS、组件与交互壳**。
- 收益：HITL 三份协议适配降为一份，直接消除 desktop 约 350 行重复适配；避免低收益的大规模 UI 合并。
- 风险与回滚：协议升级可能同时影响两端；包内保持版本兼容，desktop 以 feature flag 切回旧 bridge 一个发布周期。
- 验收：同一份协议 golden fixtures 在两端得到相同 HITL 状态；desktop 不再维护独立事件类型定义。

**8. 收窄 ModuAgent 公共扩展 API**（P1｜2–3 人日）
- 问题：`packages/modu-agent/src/index.ts` 有 17 个 `export *`，内部符号意外成为公共契约（`:40-41` 已在为同名歧义打补丁）。
- 做法：建立 `public-api.ts` 显式导出宿主所需类型/工厂/注册接口，内部实现改从 `@pioneering/modu-agent/internal/*` 受限导入；用 API Extractor 等价快照审查变更。
- 收益：公共面从 17 个通配桶变为可审计清单，后续节点拆分不必冻结全部内部实现。
- 风险与回滚：可能暴露未登记的消费方；先发兼容版本并给弃用警告，根 barrel 保留一版转发即可回滚。
- 验收：API 快照进入 CI；backend/desktop 仅从公开入口构建；新增内部符号不改变公共报告。

### 3.2 性能（9 条）

**9. 用模型感知的 TokenEstimator 替换 chars/4**（P0｜3–5 人日）
- 问题：`core/quota.ts:67,69`、`core/context-budget.ts:43`、`core/quota-reservation.ts:173`、`routes/chat.ts:712,758-760,926` 统一按 chars/4，中文显著低估上下文、预扣与用量。实测影响：`context-budget` 的 8,000 token 预算在中文下会放行约 2–3 倍的实际 token，且该预算用于**历史消息选择**（`:30,42-43,61`），预算形同虚设。
- 做法：新增 `core/token-estimator.ts` 统一 `estimate(text, model)`——有官方/兼容 tokenizer 的模型用对应编码（OpenAI 兼容可用固定版本 `js-tiktoken`），其余模型用校准后的 Unicode 分类估算。**不得换成另一个固定除数**。全部调用点改走该接口，记录 `estimated/actual/model/encoding`。
- 收益：上下文、配额、`tokenCount` 使用同一口径，直接消除中文系统性低估这一误差源。
- 风险与回滚：更保守估算会减少历史条数；按模型配置回退旧算法，但**配额与上下文必须同时切换，禁止口径混用**。
- 验收：建立中文/英文/代码/emoji 混合样本集与上游 usage 对照，报告各模型误差分布与 p95；误差上界进测试；同一文本六处结果一致。

**10. 为热查询补复合索引并用执行计划验收**（P0｜1–2 人日）
- 问题：`apps/backend-ts/prisma/schema.prisma` 中 `ChatMessage`、`ChatSession` **零索引**（全库仅 5 个索引，都在 `plan_steps` 与 `agent_runs`），而 `core/context-budget.ts:35-40` 持续执行 `sessionId + createdAt DESC + LIMIT 100`。
- 做法：先冻结 schema 双写，再为 `ChatMessage` 加 `@@index([sessionId, createdAt])`；依据会话列表实际 where/order 为 `ChatSession` 加匹配复合索引（常见为 `userId,isArchived,updatedAt`），**不要照抄未使用组合**。生产 PG 用非事务 `CREATE INDEX CONCURRENTLY`。
- 收益：消除热表按会话/时间扫描与排序的可测量成本；收益以扫描行数、Buffers、延迟复测呈现。
- 风险与回滚：索引增加写放大与磁盘；大表避开高峰，回滚用 `DROP INDEX CONCURRENTLY`，不改数据。
- 验收：迁移前后对同形状数据跑 `EXPLAIN (ANALYZE, BUFFERS)`，目标查询命中新索引；记录 p50/p95 DB 耗时、扫描行数、索引体积、写入回归。

**11. 实施端到端上下文与成本预算**（P0｜2–4 人日｜依赖第 9 条）
- 问题：`core/context-budget.ts` 只粗算历史正文，未统一计入 system、工具/schema、输出上限与真实 usage。
- 做法：引入 `PromptBudget` 明确 `model context window = system + history + tools + input + reserved output`；历史按最新消息逐条装入并记录截断原因；结算优先用上游 usage，预扣按实际差额归还。
- 收益：把「预算通过但上游溢出」变成可观测且可测试的边界。测量项：上下超限率、截断率、预扣偏差、实际费用/请求。
- 风险与回滚：工具描述过大可能挤占历史；设分桶上限与拒绝原因，可按模型开关回退旧预算，但不能回退真实 usage 结算。
- 验收：构造刚好上限、超 1 token、超大工具 schema 三类测试；压测前后对比上游 context overflow 数、平均输入 token、配额差异，均可从日志关联 runId。

**12. 让所有终态都结算实际用量**（P0｜2–3 人日）
- 问题：`routes/agent.ts:729,1014` 在 paused/error/abort 时跳过 `recordUsage`，用户停止生成反而免于计量，预扣也可能悬置。
- 做法：抽出 `finally` 中的幂等 `settleRunUsage(runId)`，completed/paused/error/abort 均结算已产生 usage；暂停后续段以同一 run/segment 累积；`token_usage` 增加 `runId+segment` 唯一约束，预扣只释放一次。
- 收益：堵住「停止生成 = 免费」，成本日志与上游账单可对账。测量项：未结算 run 数、预扣余额、上下游 token 差。
- 风险与回滚：重复结算会多扣费；先用只记录不扣款的 shadow ledger 对账，再启用扣费，保留冲正记录而非删除历史。
- 验收：四种终态 + 重复 finally 各测一次只产生一个逻辑结算；停止后预扣归零；日配额与 usage 明细一致。

**13. 为 SSE 写入增加统一背压**（P0｜3–4 人日）
- 问题：`routes/chat.ts:815`、`routes/agent.ts:678,975` 忽略 `write()` 返回值，慢客户端会让 Node 缓冲持续增长。
- 做法：在 `core/sse-writer.ts` 实现 async write——`false` 时等待 `drain`，同时监听 close/abort 与超时；chat 保留事件回放，agent 消费循环必须 `await`，心跳也走同一 writer，并设明确缓冲上限。
- 收益：内存增长由无界变为可测可控。测量 `writableLength`、进程 RSS、drain 等待、慢客户端断开数。
- 风险与回滚：背压会把压力传到上游并增加尾延迟；保留有界断开策略与旧 writer 开关，**不能用无限队列「修复」**。
- 验收：限速客户端压测下内存达阈值后触发等待或断开而非持续增长；正常客户端事件顺序、回放 seq、终态不变。

**14. 补齐 Agent 流的事件回放与断连宽限**（P1｜3–5 人日｜依赖第 13 条）
- 问题：`/chat` 有 `runEventHub + Last-Event-ID`，`/agent` 无回放且断连即中止上游，长任务容易重做。
- 做法：复用 `core/run-events.ts`，为 agent/resume 分配连续 seq、有限 TTL/容量缓冲与 Last-Event-ID；网络断开后给可配置宽限期，只有用户 stop 或宽限到期才 abort。
- 收益：减少断网后重复生成与 token 浪费。测量重连恢复率、重复 run 数、断连后上游完成率、缓冲占用。
- 风险与回滚：重放可能重复执行客户端副作用；事件必须只描述状态，客户端按 `runId+seq` 去重；可关闭宽限恢复立即 abort。
- 验收：代理在指定 seq 后断线，重连无缺口/重复；缓冲溢出给出可识别错误；stop 仍立即生效。

**15. 为长消息列表引入可回退虚拟化**（P1｜4–6 人日）
- 问题：web 消息列表无虚拟化；desktop `components/chat/MessageScrollerList.tsx:19` 明确未用虚拟化，动态高度与流式锚点是实际约束。
- 做法：先对 web 用 `@tanstack/react-virtual` 的 dynamic measurement，保留首屏/底部锚定、编辑重发、流式追加；desktop 先采样长会话，再复用策略做独立 feature flag，**不直接照搬**。
- 收益：测量 DOM 节点数、long task、滚动帧率、流式期间主线程占用，而非承诺固定提速。
- 风险与回滚：动态高度可能跳动、破坏复制与滚动位置；按消息数阈值启用，保留原列表一键回退。
- 验收：100/500/1000 条含代码块消息做 Performance trace；首屏、回到底部、编辑历史位置正确；屏幕阅读器与文本选择不回归。

**16. 合并秒级计时器并隔离渲染**（P2｜1–2 人日）
- 问题：`desktop/.../TraceNodeView.tsx:270`、`MessageBubble.tsx:47`、`web/.../ProcessContainer.tsx:60` 各自 1 秒 `setInterval` 驱动整组件重渲染。
- 做法：建立单个可见性感知 ticker，通过 `useSyncExternalStore` 订阅；把时间文本拆成 memo 小组件，页面隐藏时暂停，终态立即冻结并退订。
- 收益：N 个运行消息从 N 个 interval 降为最多 1 个。以 timer 数、React commits/s、Profiler 渲染耗时验证。
- 风险与回滚：共享时钟可能造成秒边界显示差异；组件内保留原实现，按渲染器开关切换。
- 验收：同屏 20 个运行项只有一个 interval；终态与后台页面 commits 停止；显示误差不超过既定 1 秒粒度。

**17. 按运行时清单裁剪桌面安装包**（P1｜2–4 人日｜依赖第 32 条）
- 问题：`apps/desktop/electron.vite.config.ts` 的 `externalizeDepsPlugin` 全量外置依赖，安装包混入 chromadb、5 个 OTel 包、mermaid、双 better-sqlite3。
- 做法：在 `apps/desktop/package.json` 与 electron-builder 配置中建立 main/renderer/preload 运行时 allowlist；未接线的 chroma/OTel 不进包；mermaid 按需异步 chunk；原生模块只保留统一 ABI 的一份并 rebuild。
- 收益：测量安装包、asar/unpacked 体积、文件数、冷启动、安装耗时，识别每项裁剪贡献。
- 风险与回滚：误删动态依赖会在打包后才暴露；保留上一版 manifest，启动 smoke test 覆盖 agent/checkpoint/图表后逐批裁剪。
- 验收：产物内无未授权包；packed 应用离线启动与上述 smoke test 通过；CI 比较产物清单与体积基线。

### 3.3 可维护性（9 条）

**18. 把真实代码面纳入 CI**（P0｜2–3 人日）
- 问题：`.github/workflows/llm-ci.yml` 只覆盖 backend + web；`packages/modu-agent` 的 21,466 行测试从不执行；desktop 不在 workspaces → 16 个测试永不跑。
- 做法：根 workspaces 纳入 desktop；CI 分 backend/web、modu-agent、desktop 三个 job（安装、typecheck、test、build），按路径过滤但公共包变更触发全部；缓存锁文件并发布 JUnit 摘要。
- 收益：占全仓约一半的 modu-agent 测试从「存在」变为持续门禁，桌面装配破坏可提前发现。
- 风险与回滚：历史失败会阻塞合并；先短暂 report-only 并清理确定失败项，设截止日期转 required。
- 验收：分别制造三区域测试失败均能挡住 PR；公共包改动触发全矩阵；主分支结果与本地一致。

**19. 固化数据库 Schema 单一所有者**（P0｜止血 1 + 基线迁移 3–5 人日｜**部分依赖业务决策**）
- 问题：`apps/backend-ts/prisma/schema.prisma:4-7,95,223` 同时宣称可 migrate、绝不 migrate、由 Python 维护，三处互斥。
- 做法：决策前先冻结 Python 新 DDL、删除矛盾注释、加 schema drift 检查；确定 TS 为唯一所有者后，把现有结构基线化为 Prisma migration，Python 只保留兼容 client 或随下线删除。
- 收益：DDL 从三头声明变为一条可审计路径，避免环境间列/生成列漂移。
- 风险与回滚：基线化误标已存在表会破坏环境；先在影子库 replay，生产 `migrate resolve` 前备份，保留旧 DDL 只读归档。
- 验收：空库可完整 migrate；现有库无 diff；CI 阻止两个运行时写同一表结构；注释与 ADR 一致。

**20. 按接缝依次拆解上帝文件**（P1｜8–12 人日，可分批）
- 问题：`graph/nodes.ts` 3,368 行、`chatStore.ts` 1,596 行、`routes/agent.ts` 1,357 行、`routes/chat.ts` 1,288 行、`main/ipc-handlers.ts` 1,148 行，修改半径过大。
- 做法：顺序为——先抽 routes 的 SSE/run lifecycle/usage；再拆 `agent-bridge.ts` 的 context/装配/持久化；再按 graph 节点边界拆 `nodes.ts`；最后按 session/message/stream slice 拆 desktop store，按领域把 60 个 IPC 通道分组注册。每步保留原 facade。
- 收益：先降高风险路由的变更成本，再降内核与桌面成本；目标新模块单一职责、通常 < 500 行，而非追求文件数。
- 风险与回滚：隐式共享状态最易回归；每批只移动代码不改语义，facade 可恢复旧导入，**禁止顺手格式化全文件**。
- 验收：每批现有及契约测试通过、公共 API 不变；diff 以移动为主；新模块依赖方向无环。

**21. 先收敛事件解析再收敛同步 Hook**（P1｜3–5 人日）
- 问题：全仓 3 份 SSE 解析器；`apps/web/src/modes/{chat,pro,task}/hooks/useChatSync.ts` 三份 **MD5 完全相同**（`903fcf78…`），修复需重复三遍。
- 做法：先在 `packages/agent-protocol` 建唯一增量 SSE parser，用跨行 data、CRLF、heartbeat、残缺 UTF-8 fixtures 验证；再抽 `useChatSyncCore`，三种 mode 只传 endpoint 与领域回调；最后删除两份复制文件。
- 收益：SSE parser 3→1、useChatSync 3→1，后续协议修复只改一处。
- 风险与回滚：隐式 mode 差异可能被复制代码掩盖；先跑三端 golden 对比，保留薄 wrapper，差异未澄清前不强行统一回调。
- 验收：三模式同步行为测试一致、重复文件删除；fuzz/残缺帧不丢事件、不重复回调。

**22. 将领域逻辑移入应用服务层**（P1｜4–6 人日）
- 问题：`routes/chat.ts`、`routes/agent.ts` 承载配额、运行状态、持久化、协议转换；backend 无 service 层且成为胖宿主。
- 做法：在第 20 条首批抽取后形成 `ChatRunService`/`AgentRunService`；路由只做 auth、DTO、HTTP 状态与流控制；service 通过显式 Prisma/gateway/event-store 接口组合用例。
- 收益：领域用例可脱离 Fastify 单测，HTTP 与桌面 IPC 不再复制业务规则。
- 风险与回滚：过度抽象会制造 pass-through；只抽已有两个以上调用点或需独立事务的用例，路由 facade 可逐步回退。
- 验收：路由不含 Prisma 事务与配额细节；service 可用 fake gateway 完成终态测试；无新增运行时环。

**23. 用 ADR 与可执行校验防止文档腐化**（P2｜1–2 人日）
- 问题：`apps/web/vite.config.ts:16-21` 仍称根 React 18（实际 19.3.0 唯一）；`schema.prisma` 注释互相冲突——说明文字未随实现演进。
- 做法：将 React 版本、DB 所有权、运行时拓扑、LLM 流量切换写入短 ADR；代码注释只解释当前约束；CI 用 `npm ls react`、schema drift、依赖清单校验替代手工版本声明。
- 收益：删除已知错误前提；决策有日期、负责人、退出条件，不再靠跨文件考古。
- 风险与回滚：ADR 可能再次过期；只记录决策不复制实现细节，每次相关 PR 必须更新对应 ADR。
- 验收：仓库不再出现「根 React 18」等错误陈述；ADR 链接到验证命令；schema 注释无互斥指令。

**24. 为关键边界补契约与性质测试**（P1｜3–5 人日）
- 问题：测试总量大但 CI 未覆盖核心包；现有「`@ts-ignore`=0、878 条值边无运行时环」是应保留的正面基线，不能靠泛化「补类型」替代边界保障。
- 做法：优先为 token 估算、SSE 增量解析、usage 幂等、HITL reducer、provider 解析写表驱动/性质测试；为公共包生成 API 快照；保留循环依赖与 `@ts-ignore=0` 检查。
- 收益：重构前形成行为安全网，覆盖本次最高风险的五条边界，而非追求无意义覆盖率数字。
- 风险与回滚：golden 可能固化错误行为；fixtures 必须附协议/上游样本来源，发现错误时同步更新规范与数据版本。
- 验收：第 20–22 条重构全程无需跳过测试；随机流分片结果与一次性解析一致；CI 报告可定位失败边界。

**25. 接线可观测性并为静默降级设告警**（P1｜3–5 人日）
- 问题：`packages/modu-agent/src/observability` 约 1,703 行但 `tracing.enabled:false` 且宿主未初始化；`LLM_GATEWAY_ENABLED=0`、checkpointer 内存降级可静默发生。
- 做法：在 backend `src/index.ts` 与 desktop main 最早启动阶段 init SDK，注入 `traceparent`/`runId`/`session` 哈希；输出 LLM 尝试/熔断/usage、SSE 背压、checkpoint 模式指标；legacy 或 volatile 状态触发持续告警。
- 收益：现有 1,703 行从死代码变成排障能力；性能基线、跨端链路、安全降级均可量化。
- 风险与回滚：高基数与敏感正文会增成本/泄密；默认不采正文，按 runId 采样，设 span/metric 限额，可通过配置关闭 exporter 而不改业务。
- 验收：本地 collector 能看到一次 chat/agent 跨宿主 trace；故障注入出现预期告警；指标无 userId、原始 prompt 等高基数/敏感标签。

**26. 加固认证凭据与生产密钥边界**（P0｜3–5 人日）
- 问题：web JWT 存 localStorage（`apps/web/src/api/client.ts:12-30`），XSS 可直接窃取；`apps/backend-ts/src/config/env.ts:69-77` 对弱 `JWT_SECRET` 仅 warn。
- 做法：`routes/auth.ts` 改为 HttpOnly/Secure/SameSite refresh cookie，access token 仅内存保存；`store/auth.ts`、`api/auth-api.ts` 去掉持久化 bearer，cookie 写操作补 CSRF；生产弱/默认 secret 启动失败并支持轮换。
- 收益：消除持久化 token 被脚本读取的主路径；弱密钥从提示变为部署门禁。
- 风险与回滚：跨域 cookie、桌面深链、CSRF 易回归；先双读旧新认证短期灰度，撤销旧 refresh token 后完成切换，保留紧急密钥轮换手册。
- 验收：刷新页面可恢复会话；localStorage 无 token；XSS 无法读取 refresh；弱 secret 生产启动失败；CSRF/跨域矩阵通过。

### 3.4 技术选型（9 条）

**27. 冻结 Python 内核并在决策后下线**（P1｜准备 3–5 + 迁移 10–20 人日｜**依赖业务决策**）
- 判定：**保留只读兼容、停止新增、择机下线**；不建议现在直接删除。
- 问题与做法：`apps/backend/ModuAgent` + FastAPI 共约 21,076 行非测试代码，不在 workspaces/CI/start.sh 却仍影响 DB。决策前补 TS/Python 能力与 golden parity 清单、冻结 Python DDL、标记 owner；业务确认无独立用户后按「只读流量→停写→归档」退役。
- 收益：终局最多退役约 21,076 行维护面并消除双内核。
- 风险与回滚：可能有未记录 Python 使用者；先访问日志与依赖盘点，保留最后一版镜像与数据备份，可恢复只读服务。
- 验收：parity 清单全部有 TS 替代或明确弃用；连续观察期无 Python 流量、DB 无 Python 写入后方可归档。

**28. 保留双端产品壳并推迟合并终局**（P1｜决策准备含第 7 条｜**依赖业务决策**）
- 判定：**近期保留双壳、共享协议；是否合并由产品终局决定**。
- 问题与做法：web 25,282 行、desktop 30,973 行但文本重合仅 1.45%，强行抽组件收益低。决策前只实施第 7 条协议复用，并统计两端功能/用户重叠；若未来单壳，依据数据选主端并逐域迁移，而非先建「大 UI 公共包」。
- 收益：避免大规模低复用改造，同时先消协议漂移。
- 风险与回滚：Electron 能力可能无法由浏览器替代；保留现有两端构建，任何迁移按功能域独立回退。
- 验收：决策记录明确目标平台与不再支持的能力；决策前 desktop 已消费共享协议且两端构建不受影响。

**29. 收敛 Desktop 到 Zustand**（P2｜6–10 人日，按 slice 派工）
- 判定：**保留 Zustand，分片替换 Jotai**——web 已单一 Zustand，可统一跨端范式；但不因 jotai 文件多而一次性重写。
- 问题与做法：desktop 39 文件用 jotai、5 文件用 zustand。先为 `chatStore.ts` 等运行态划 slice，新代码只用 Zustand；按「只读派生状态→交互状态→HITL」顺序迁移并删除 atom。
- 收益：状态库 2→1，跨端调试方式一致。
- 风险与回滚：订阅粒度变化会增加渲染；每片以 Profiler 对比，保留 jotai provider 至迁移完成，单片可还原。
- 验收：最终 `package.json` 与源码无 jotai；迁移期无组件同时镜像两份可写状态；渲染次数不劣于基线。

**30. 升级并统一 Tailwind 4**（P2｜2–4 人日）
- 判定：**升级 marketing 的 Tailwind 3，保留 web/desktop 的 4**。
- 问题与做法：三端两套大版本（根 3.4.19 / web 4.3.3 / desktop 4.3.2）增加指令与插件差异；在 marketing 构建配置、CSS 入口、PostCSS 插件按官方迁移路径升级，锁定同一大版本。
- 收益：构建工具链 2 套 → 1 套。
- 风险与回滚：样式构建与自定义类可能漂移；用视觉回归与 CSS 产物 diff，保留旧分支配置可整包回滚。
- 验收：三端 lockfile 仅一个 Tailwind 大版本；关键页面截图无未解释差异；无重复兼容插件。

**31. 固定 LangChain 兼容版本**（P1｜1–2 人日）
- 判定：**保留 LangChain/LangGraph，替换 `"*"` 依赖声明**。
- 问题与做法：`packages/modu-agent/package.json:19-20,27-28` 的 `@langchain/*` 通配符使安装不可重复，core/langgraph 又同时位于 deps 与 peerDeps。按当前锁文件验证版本，使用明确兼容范围并统一放置：core 由直接宿主提供时只留 peer+dev，否则只留 deps。
- 收益：消除无 PR 的依赖漂移与双实例风险。
- 风险与回滚：锁紧可能暴露 peer 冲突；在干净环境安装验证，必要时逐个升级，保留上一锁文件回退。
- 验收：两次干净安装生成相同解析树；`npm ls` 无 invalid/意外多副本；checkpoint 与图测试通过。

**32. 统一 better-sqlite3 大版本与 ABI 验证**（P1｜2–3 人日）
- 判定：**统一到同一经验证大版本，优先评估 13；不保留 11/13 双轨**。
- 问题与做法：modu-agent optional 用 11、desktop 用 13，Electron/Node ABI 重编译不同。先在 `packages/modu-agent/package.json` 与 `apps/desktop/package.json` 对齐版本，electron-builder 统一 rebuild，再验证 checkpoint。
- 收益：原生包与 ABI 组合 2→1，并支持第 17 条裁剪。
- 风险与回滚：Node 与 Electron 支持矩阵不同；若 13 不兼容则统一回 11 的验证版本，但**不得继续双轨**，保留上一原生产物。
- 验收：CI Node 与 packed Electron 都能打开/重启恢复同一 checkpoint；安装树只有一个 better-sqlite3 大版本。

**33. 有门禁地下线 LLM Legacy**（P1｜告警 1 + 下线 2–3 人日）
- 判定：**短期保留紧急开关，完成观察后下线 `llm-legacy`**。
- 问题与做法：`LLM_GATEWAY_ENABLED=0` 会静默失去网关可靠性（`core/llm.ts:20-23,40-42`）。先在 env 解析与启动日志把 legacy 标为受限模式、加指标/告警与到期日；gateway 关键路径稳定后删除旧路径，紧急回滚改为部署已验证旧版本。
- 收益：最终减少一条长期分叉与一套故障语义。
- 风险与回滚：网关未覆盖的模型可能依赖旧路；下线前 parity 清单全覆盖，观察期可用明确告警的开关回退，过期后禁止静默启用。
- 验收：legacy 开启即有可见告警与负责人；最终代码无该环境开关；所有模型经 gateway 契约测试。

**34. 保留 OTel 但删除未用导出器**（P1｜选型与裁剪 1–2 人日，接线计入第 25 条）
- 判定：**保留 OpenTelemetry API/SDK 并实际接线；按目标后端保留一个 exporter，删除其余未用依赖**。
- 问题与做法：1,703 行 instrumentation 当前零接线，且桌面携带 5 个 OTel 包。实施第 25 条，选定 OTLP 或现有平台 exporter；web 不盲目引入 Node SDK；desktop 仅打包实际启用模块。
- 收益：复用已有投资而非另建监控栈，同时减少无用包。
- 风险与回滚：SDK 版本与 exporter 冲突；固定兼容版本，exporter 故障不得阻塞对话，可关闭导出但保留内部指标。
- 验收：干净安装无未选择 exporter；collector 收数；SDK 初始化失败时业务仍可启动并明确告警。

**35. 下线 ForceReactSingleton 僵尸补丁**（P2｜0.5–1 人日）
- 判定：**下线**。
- 问题与做法：`apps/web/src/test/forceReactSingleton.ts` 72 行针对 React 18 多实例，而根实际只有 React 19.3.0；同步删除 `apps/web/vite.config.ts:16-21` 错误注释与测试 `setupFiles` 引用；以 `npm ls react` + CI 单一实例断言替代。
- 收益：删除 72 行无前提补丁与全局测试副作用。
- 风险与回滚：若某隐藏工具链仍带入第二副本会暴露测试失败；补丁保留在 git 历史，先修依赖而非恢复全局补丁。
- 验收：干净安装与 CI 均只有一份 React；web 测试无该 setup 仍通过；构建不再声明 React 18。

---

## 4. 执行路线：四条并行车道

建议按「车道」而非「优先级排序」推进——同一车道内串行，车道之间并行。这样每条车道都可以交给一个固定负责人，不必频繁同步。

**车道 A｜数据正确性（最先动，因为它在持续产生错误数据）**

```
架构 9（TokenEstimator）→ 架构 11（PromptBudget）→ 架构 12（全终态结算）
                                                    ↘ 产品 22（配额计量同源）
```
依赖关系：11 不得早于 9；12 可与 11 并行，但两者必须同时切换口径，**禁止估算与结算混用**。
交付判据：任一次请求的「估算 token / 上游 usage / 配额扣减」三者可对账。

**车道 B｜工程安全网（第二动，因为它决定后面敢不敢动）**

```
架构 18（CI 纳入 modu-agent + desktop）→ 架构 24（边界契约测试）
                                        ↘ 架构 19 止血部分（删矛盾注释 + schema drift 检查）
                                        ↘ 架构 10（DDL 冻结后加索引）
```
交付判据：故意破坏三区域任一测试都能挡住 PR；`EXPLAIN` 显示热查询命中新索引。

**车道 C｜承诺与入口修复（可与 A/B 并行，纯前端/文案）**

```
产品 14（根路由）→ 产品 6（marketing CTA 接真实产品）→ 产品 7（撤回承诺）
                                    ↘ 产品 17（UTM 归因）
产品 1/2/3/4/5/8/11（删/标假功能，可一次性批量做）
```
交付判据：全站扫描无 `example.com`、空 `href`、无 handler 按钮、`placeholder` 导航；`/` 不 404。

**车道 D｜可靠性与安全（第三动，需要 A 的计量口径才能验证效果）**

```
架构 6（禁止 checkpointer 静默降级）→ 架构 13（SSE 背压）→ 架构 14（Agent 回放）
架构 26（认证凭据加固，可独立提前）
架构 25 + 34（OTel 接线 + 裁剪 exporter）
```
交付判据：慢客户端压测内存有界；断线重连无缺口；弱 secret 生产启动失败。

**第一批之后的顺序**（车道 A-D 完成后）

1. 架构 20 → 22（拆上帝文件 → 抽 service 层），必须在 18/24 就绪后。
2. 架构 2 → 7 → 4（收敛 LLM 可靠性 → 统一 HITL 协议 → 统一 AgentRuntime 装配），三者共享协议 fixtures，可协同但需分别合并；上线顺序**先背压、再回放、后装配**，避免把无界内存问题复制到 Agent。
3. 架构 8（收窄公共 API）应在 graph 大拆**之前**确定，避免反复改导出。
4. 架构 15/16/17（体验性能）以实测决定是否全量，先建长会话与打包基线。
5. 架构 29/30/32/35（选型清理）按低峰分片，不阻塞 P0。
6. 架构 27/28（Python 下线 / 双端合并）**只做盘点与协议复用，决策未下不得删除或合并**。

**与业务决策挂钩的三条独立闸门**

| 闸门 | 开放前可做 | 开放后才能做 |
|---|---|---|
| 产品终局（一个还是三个产品） | 产品 7/11/14/19 全部止血动作；架构 7 协议复用 | 产品 9/10/12/13/18/24；架构 28 合并 |
| 部署形态（单实例还是多副本） | 架构 5 的接口化 | 架构 5 的持久化实现（6–10 人日） |
| Schema 所有权 | 架构 19 止血（删矛盾注释 + drift 检查） | 架构 19 基线迁移；架构 27 Python 归档 |

---

## 5. 明确不建议做的事

这一节与建议同等重要——以下 8 条都是「看起来很合理、实际会亏」的动作：

| 不建议 | 理由 |
|---|---|
| 以 1.45% 文本重合为依据强推「大公共 UI 包」 | 重合度这么低，抽出来的组件会变成第三套实现；共享协议与纯逻辑即可，双端合并必须等业务决策 |
| 立即删除 Python 内核，或让 TS/Python 同时 migrate | 先盘点消费者、冻结 DDL、做 parity 与基线；否则会造出无法回滚的数据分叉 |
| 重写 LangGraph 或自研新 Agent 框架 | 当前主要问题是装配、可靠性与文件边界，**不是图引擎缺失** |
| 把 chars/4 换成 chars/2、chars/1 等另一个固定除数 | 必须按模型 tokenizer 或样本校准，并保留真实 usage 对账；换除数只是把误差从一种变成另一种 |
| 盲目虚拟化 desktop 动态消息区 | 会牺牲滚动锚点、文本选择与流式体验；必须先采样长会话再决定 |
| 在单实例语义未修正前直接引入 Redis/Kafka | 先定义 Run/Event/Idempotency 接口与终态，再按部署决策实现；否则只是把缺陷搬到分布式 |
| 全仓格式化、为「零 any」大改类型、同时升级所有依赖 | 会淹没行为 diff，且无助于已核实的首要风险 |
| 把指标/日志/trace 当一次性上线动作 | 没有采样、高基数限制、告警责任人、退出条件的 OTel 接线不应验收 |

---

## 6. 一句话收束

> 62 条建议里，真正需要「先想清楚」的只有 3 个问题：**这是几个产品、跑几个实例、谁是 schema 所有者**。
> 其余 59 条无论这三个问题怎么答都成立——所以现在就可以开工，不必等决策。
> 而开工的第一件事不是重构，是**让已有的 21,466 行测试开始执行**（架构 18，2–3 人日）——它是唯一一条「不做架构改动、但让后面所有改动变安全」的建议。
