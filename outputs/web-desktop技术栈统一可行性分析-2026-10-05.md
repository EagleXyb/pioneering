# web 与 desktop 技术栈统一可行性分析

> 分析基线：HEAD `4ef2741`，工作树干净；两 app 均为已实证复审状态（web 首审 2026-10-05，desktop V2.7 全量复审）
> 分析方式：desktop 栈层实证（package.json / vite.browser.config.ts / renderer 入口 / transport / authStore / api 面）+ 与 web 深审结论交叉比对
> 结论先行：**可行，且正确方向是"web 并入 desktop 的 renderer（作为 browser 运行时）"，而不是把 desktop 栈反向搬进 web**。desktop 已经为浏览器形态做了架构级准备，约 60% 的统一基础已存在。

---

## 一、两栈实证对比矩阵

| 维度 | apps/web | apps/desktop | 差异等级 |
|---|---|---|---|
| 宿主 | 纯浏览器（Vite dev + build） | Electron 42.7.1 + electron-vite 4 | 结构性（但 desktop 有 browser 逃生门） |
| React | 18.3 | **19.0** | 大版本差 |
| 构建工具 | Vite 6 | Vite 6（electron-vite 封装 + 独立 browser 配置） | ✅ 相同 |
| TS | ~5.6.2 | ^5.7 | 微 |
| CSS | Tailwind **3**（作用域限定 .tw-scope）+ 大量手写 CSS | Tailwind **4**（@tailwindcss/vite）全量 | 跨大版本 |
| UI 组件库 | **TDesign 双包**（tdesign-react + @tdesign-react/chat）+ Radix 3 件 + 手写 | **Radix/shadcn 全家桶**（11 个 @radix-ui/* + radix-ui 聚合包 + @shadcn/react） | 完全不同 |
| Markdown | **自研 206 行零依赖**渲染器（不支持表格） | react-markdown 10 + remark-gfm + rehype-sanitize/highlight + mermaid 11 | 完全不同（desktop 强） |
| 状态管理 | Zustand 5（6 store） | Jotai 2.20（atoms）+ Zustand 5（混用） | 部分重合 |
| 路由 | react-router 7（BrowserRouter）+ react-router-dom 7.17 双包 | react-router-dom 7.18（**HashRouter**） | 形态差 |
| 长列表/布局 | 无虚拟滚动、手写 resizer | @tanstack/react-virtual + react-resizable-panels | desktop 强 |
| HTTP 层 | fetch 手封 client.ts（401 刷新并发去重） | axios apiClient（baseURL 可配置持久化 + 端口归一化迁移） | 各有优势 |
| 测试 | vitest + **@testing-library**（组件可测）65 例 | vitest（**无 testing-library**）170 例，纯逻辑/单测 | 能力互补 |
| 后端契约 | `/chat/completions`(TDesign agui) + `/agent/completions`(手写 SSE) + `/chat/*` CRUD | `/agent/*` 全家（sessions/completions/**resume/abort/state**/executions）+ `/chat/*` CRUD；AGUI 流统一 streamAgui | desktop 是超集 |
| 持久化 | 全靠后端 REST + localStorage | 本地 better-sqlite3（localChat，按 session.runtime 分流）+ electron-store | 架构差 |

## 二、desktop 的"浏览器就绪度"实证（统一的基础已存在）

这是本分析最重要的发现——desktop 不是"只能跑在 Electron"，它已经做了系统性准备：

1. **独立浏览器构建配置**：`vite.browser.config.ts`（root=src/renderer，alias @/@renderer/@shared，产物 out/browser），配套 `npm run dev:browser / build:browser`。
2. **preload mock**：`renderer/src/mocks/electron-mock.ts` 在浏览器模式模拟 `window.api/window.electron`，main.tsx 注释明说"Electron 环境下自动跳过，无副作用"。
3. **transport 抽象（云边双模阶段 1）**：`AgentTransport` 五方法接口（sendMessage/resume/abort/getState/stop）+ `ipc-transport`/`http-transport` 双实现 + `window.__setAgentTransportMode()` 运行时切换；http-transport 直连 backend-ts 的 `/agent/*` 全套端点（agent.ts:23-118 实证）。
4. **双会话源分流**：`localChat.ts` 把 IPC 封装成与 REST `chatService` **同构接口**，chatStore 按 `session.runtime` 分流（本地 SQLite / 云端 REST）——浏览器模式接 REST 会话的挂点已经预留。
5. **免登录档案**：authStore 定义 `LOCAL_USER`（"云边双模阶段 2：本地模式免登录即完整可用"），认证五态状态机（idle/loading/authed/anonymous/error）比 web 的三态更完备。
6. **平台降级设计**：`?platform=mac|windows|linux` URL 参数可脱离 Electron 预览；快捷键 hydrate 浏览器下静默降级。

**结论：desktop renderer 已经是一个"带 Electron 增强的 React SPA"。让 web 消失、把浏览器形态变成 desktop 的第一公民运行时，缺的不是架构，是功能补齐。**

## 三、方案空间与取舍

### 方案 A：把 desktop 栈搬进 web（反向统一）❌ 不推荐
React 18→19、TW3→4、TDesign→shadcn、自研 Markdown→react-markdown、fetch→axios、加 Jotai——等于**重写 web 全部 UI 层**，换来的只是"版本号对齐"，而 web 的能力（登录注册、会话列表、三模式）依然要在新栈上重写一遍，desktop 侧零收益。
- 工作量：≈ 方案 B 的 80%（全部重写）+ 双栈共存期更长。
- 判定：纯成本无增量价值。

### 方案 B：web 并入 desktop renderer，web 退役 ✅ 推荐
以 desktop renderer 为唯一前端代码库；浏览器形态 = `vite.browser.config.ts` 产物 + `http-transport` + REST 会话源 + 云端登录。web 的**独有能力**移植进 desktop，其余（自研 Markdown、TDesign 输入框、手写 SSE 解析器 ×2、三份 useChatSync）直接废弃。
- 已就绪：构建链、transport、平台降级、状态机骨架、后端 /agent/* 与 /chat/* 端点全部在线。
- 需补齐：见第四节清单。

### 方案 C：不合并，抽共享核心包（低风险过渡）✅ 可作为 B 的第一步
新建 `packages/web-shared`（或并入现有 monorepo packages）：AG-UI 事件类型 + SSE 解析器（收敛 web 两份手写解析）、auth client（401 刷新逻辑）、消息类型契约、（可选）Markdown 渲染组件。web/desktop 各自 import。
- 工作量：1–2 周；收益是立即止血"三份 useChatSync、两份 SSE 解析器"类双份维护；不动 UI。
- 判定：若近期无资源做全量合并，先做 C，避免重复代码继续增殖。

## 四、方案 B 实施计划与工作量（1 人全职）

| 阶段 | 内容 | 工作量 | 依赖/说明 |
|---|---|---|---|
| 0 前置 | 修 web P0（tsc 28 错 + lock 刷新）；desktop `build:browser` 对接 backend-ts 冒烟（登录→发消息→HITL→plan 时间轴） | **1–2 天** | web P0 不修则任何"复用 web 代码"的起点都是坏的 |
| 1 认证 | 移植 web 登录/注册页（shadcn 重写）+ ProtectedRoute + client.ts 的 401 刷新并入 desktop apiClient | **2–3 天** | desktop apiClient 无刷新机制（需确认，按无算）；authStore 五态机可直接承接 |
| 2 会话 | web Sidebar（分组/归档/重命名/无限滚动/AI 标题/删除确认）移植；chatStore 的 runtime 分流扩展 browser+REST 分支 | **3–5 天** | REST 会话 CRUD 与 AI 标题后端已就绪（web 在用）；归档=DELETE?archive=true |
| 3 模式 | **决策点**：建议三模式收敛为两形态——"快聊"（复用 desktop ChatPage 走 /chat/completions 或 /agent/completions）+ "任务/Plan-Execute"（移植 planExecuteStore + PlanPipelineTree，2–3 天）；**pro 直接砍**（web pro 本是半成品：无历史/无 IME/无 Markdown，desktop AssistantPage 已承接其定位） | **3–8 天** | 若坚持三模式完整移植则 8–15 天，不推荐（pro 是负资产） |
| 4 收尾 | 设置项并轨（web SettingsDialog 有效项：theme/density/fontSize/enterToSend → desktop 设置 9 分区）；tokens.css→TW4 @theme 主题变量映射；InputArea 能力清单 diff（IME/草稿 web 已有对应物）；docs 4 份契约文档迁移 | **2–3 天** | InputArea 1420 行已含草稿/命令面板，需逐项核对防遗漏 |
| 合计 | | **≈ 3–4 周**（砍 pro）/ 5–6 周（保三模式） | 另加 1 周缓冲做双端并行验证与 web 退役切换 |

## 五、风险清单

| 级别 | 风险 | 缓解 |
|---|---|---|
| P1 | **AG-UI 方言差异**：web TDesign `protocol:'agui'` 消费与 desktop streamAgui 16 事件解析是两套实现；0713 遗留 F13"agui 方言待实机联调"仍未闭环。统一到 desktop 解析器后，/chat/completions 与 /agent/completions 两条通道的事件流需逐一回归 | 用方案 C 抽出的单一解析器 + 两通道各自的快照测试（mock SSE 序列） |
| P1 | **会话模型差异**：web Session(messageCount/lastMessage/isArchived) vs desktop ChatSession(threadId/runtime/HITL 状态)；browser 模式下 runtime 字段语义要重定义（全部 REST=cloud） | chatStore 分流函数集中改造，类型层加 `runtime: 'cloud'` 字面量 |
| P2 | **UI 回归面大**：web 65 个测试大多绑定 web 自有 store/组件结构，迁移后部分作废；desktop 无 @testing-library，移植的页面缺组件级回归手段 | 阶段 0 同步给 desktop 装 @testing-library + jsdom（web 的测试模式可直接抄） |
| P2 | **主题/样式跨版本**：TW3→4 类名与配置语法有破坏性变更（web 作用域 .tw-scope 策略失效），移植页面的样式要按 TW4 重写而非拷贝 | 按"重写而非搬运"执行；tokens.css 变量名先映射表后批量替换 |
| P2 | **detail 丢失**：web 侧精细实现（IME 500ms 时间戳校验、草稿 debounce、游标滚动位置恢复、ArtifactRender sandbox+CSP）在移植中最易被丢 | 建立 web 能力清单 checklist（报告附表），逐项打勾验收 |
| P3 | BrowserRouter→HashRouter 的 URL 形态变化（`/chat`→`#/chat`）；外部深链/文档引用需同步 | 内部工具影响小；如在意可保留 Browser 模式分支（vite browser build 用 BrowserRouter，Electron 内 Hash） |
| P3 | 双库状态管理（Jotai+Zustand）心智负担延续 | 不强制统一；新代码按 desktop 惯例（跨组件原子用 Jotai，业务 store 用 Zustand） |
| — | 无 P0 风险：现状两套代码均可运行，"不做"不阻塞任何现有功能——这是重构而非抢救 |

## 六、需要拍板的决策点

1. **web 的最终归宿**：退役（方案 B）还是长期共存（方案 C 止血）？——影响 3–4 周 vs 1–2 周的投入。
2. **三模式是否收敛**：pro 砍不砍（本报告建议砍，web pro 无历史/无 IME 属负资产）；chat 与 task 是否保留独立入口。
3. **浏览器版是否要登录**：desktop 本地模式是免登录哲学（LOCAL_USER）；若浏览器版面向公网用户则必须有完整 auth（阶段 1 必做），若仅内网演示可延后。
4. **TDesign 是否彻底出局**：方案 B 下 web 的 TDesign 依赖随 web 退役自然消失；desktop 内部不存在 TDesign，无兼容负担。

## 七、总结

- **技术可行性：高**。两 app 本就同属 Vite 6 + React + Zustand + react-router + lucide 家族，真正的断层（TDesign vs shadcn、自研 vs react-markdown、React 18 vs 19）全部在**可整体替换的 UI 层**，而 desktop 已用 browser 配置 + transport 抽象 + preload mock 把"浏览器运行时"的地基打完。
- **方向判断**：统一 = web 并入 desktop renderer，而非反向。web 的真正价值不是代码，是**已验证的后端契约 + 登录/会话/归档这些 desktop 缺的产品能力**。
- **代价**：3–4 周（砍 pro）拿下一个代码库、双运行时（Electron 本地内核 / 浏览器云端 REST）、消灭 4 组重复实现；先做 1–2 周的方案 C 可以在任何时候安全启动。
