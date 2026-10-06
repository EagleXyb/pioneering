# web UI 栈对齐 desktop 重写方案（React 19 + shadcn）

> 决策前提：保留 web 独立代码库，UI 层重写为 React 19 + Tailwind 4 + shadcn/Radix，与 desktop 对齐
> 硬约束：**改造全程功能可用**——每阶段退出时 `tsc 0 错 + vitest 全绿 + vite build 绿 + 冒烟通过`，任何时刻可发布
> 实证基础：web 首审（2026-10-05）+ desktop 栈层实证 + 本轮补充验证
> 总工作量：**18–21 个工作日（约 4 周，1 人）**，按 P0→P4 优先级分 6 个阶段

---

## 〇、关键实证结论（决定方案形态）

1. **TDesign 兼容 React 19**：`tdesign-react 1.17.1` 与 `@tdesign-react/chat 1.0.2` 的 peerDependencies 均为 `react: ">=16.13.1"`（开放上界，已查 node_modules 实证）→ **可以先升 React 19 再换组件**，无需 --legacy-peer-deps，无 peer 冲突。
2. **web 的 TDesign 表面积有限且全部可映射**（11 个文件，~20 个 API）：chat 四件套（useChat/ChatSender/ChatMessage/ChatActionBar）+ 基础件（Button/Input/Form/Checkbox/Space/Dialog/Popup/Avatar/Loading/Tooltip/Switch/Slider/Select/Radio）+ MessagePlugin（toast，6 个文件）。**唯一需要"自建"的是 chat 四件套**，其余全部有 shadcn/Radix 现成对应。
3. **desktop 可抄基座 14 件**：ui/{avatar,bubble,button,card,confirm-dialog,dialog,dropdown-menu,input,label,message,message-scroller,radio-group,resizable,scroll-area,tooltip}.tsx。**desktop 没有 toast**——web 的 MessagePlugin（15+ 调用点）需新建（推荐 sonner，shadcn 官方推荐且 TW4 兼容）。
4. **web 已有 shadcn 底子**：components/ui/{button,textarea,tooltip}.tsx + cn() 工具 + tailwind-merge 已就位；@testing-library 已装（65 测试可作安全网）；`@radix-ui/react-slot/tooltip` 已装。
5. **功能逻辑层与 UI 层天然隔离**：api/store/hooks 层零依赖 TDesign（唯二例外：types/tdesign.ts 的类型 re-export、client.ts 无涉），**UI 重写不动业务逻辑**是本方案可行的根基。

---

## 一、组件映射总表（TDesign → shadcn/desktop 对齐物）

| TDesign API | 使用处 | 替换物 | 来源 |
|---|---|---|---|
| Button | auth×3、ChatInput | ui/button | ✅ 双端已有 |
| Input / Textarea | auth×2 | ui/input + ui/textarea | ✅ 双端已有 |
| Form + rule 校验 | Login/Register | 原生受控 + zod 手写校验（desktop 无 react-hook-form，不引入新依赖） | 自建（逻辑从 TDesign rule 平移） |
| Checkbox | Register（记住我） | ui/checkbox（@radix-ui/react-checkbox） | shadcn 新增 |
| Space | ChatInput | `<div className="flex items-center gap-2">` | 直接删 |
| Dialog | Sidebar ×3（删除确认/登出/个人中心） | ui/dialog（@radix-ui/react-dialog） | ✅ desktop 已有 confirm-dialog 可扩展 |
| Popup | Sidebar（账号菜单） | ui/dropdown-menu（desktop 已有）或 popover | ✅ desktop 已有 |
| Avatar | Sidebar ×2 | ui/avatar | ✅ desktop 已有 |
| Loading | Sidebar | spinner（CSS 动画小件） | 自建 5 行 |
| Tooltip | Sidebar/TopNav | ui/tooltip | ✅ 双端已有 |
| Switch / Slider / Select / Radio | SettingsDialog | ui/switch + ui/slider + ui/select + ui/radio-group | shadcn 新增（radix 标准件） |
| MessagePlugin.info/success/error | 6 文件 15+ 处 | **sonner toast**（`toast.info()`/`toast.success()`，API 形态接近，机械替换） | 新增依赖 |
| useChat(agui) | ChatMode | **useAguiChat 自研 hook**（阶段 4 详述） | 自建 |
| ChatSender | ChatInput | shadcn textarea 组合件（autosize/R1 开关/停止按钮/Enter 策略，逻辑抄 useTaskInput——已含 IME/草稿/autosize 完整实现） | 组合 |
| ChatMessage | ChatMessageItem/List | 消息气泡组件（react-markdown + reasoning 折叠区） | 自建 |
| ChatActionBar | ChatMessageItem | 操作栏小件（copy/good/bad/share/replay 五按钮，逻辑平移不动） | 自建 |

**依赖变更清单**：
- 新增：`tailwindcss@^4 + @tailwindcss/vite`、`@radix-ui/react-{dialog,checkbox,popover,switch,slider,select,radio-group,avatar,dropdown-menu}`（对齐 desktop 版本）、`react-markdown + remark-gfm + rehype-highlight + rehype-sanitize`（对齐 desktop）、`sonner`、react 19/react-dom 19/@types/react 19
- 移除（阶段 5）：`tdesign-react`、`@tdesign-react/chat`、`tdesign-icons-react`、`tailwindcss@3 + tailwindcss-animate + postcss 配置`、`react-router`（双包收敛为 `react-router-dom@^7.18` 单包，对齐 desktop）
- 保留不动：zustand、vite 6、vitest、clsx/tailwind-merge/cva/lucide-react（升级到 ^0.469 对齐 desktop，**顺带修复 P0 的 28 个类型错误**——desktop 版本的类型签名即修复）

---

## 二、分阶段实施计划（优先级 P0 → P4）

### P0 · 阶段 0：安全网先行（2 天）——不做此阶段，后面全是空中楼阁

| 动作 | 说明 |
|---|---|
| 0.1 修 tsc 28 错 | 两个 MoreMenu 的 `IconComponent` 改 `LucideIcon`（2 文件各 1 行，desktop 同款类型即修复） |
| 0.2 刷新 lockfile | apps/web 重跑 `npm install`，lucide/radix 等进 lock，提交 → `npm ci` 恢复可用 |
| 0.3 加 ESLint | 最小集：`react-hooks`（拦截 TaskMessageList 那类违规）+ `@typescript-eslint` 推荐集 + prettier（对齐 desktop 有 format 脚本） |
| 0.4 固化门禁 | `typecheck / test / build` 三命令全绿作为每阶段退出条件；顺手修 P1-4（MessageContent hooks 上移，半小时） |
| 0.5 冒烟清单固化 | ① 登录→发消息→流式→停止→重生成→反馈→AI 标题 ② 切会话→历史分页→归档/恢复/删除 ③ task 发任务→时间轴→artifact 预览 ④ 设置改主题/字号 ⑤ 404/help。每阶段跑一遍 |

**退出标准**：`npm run build` 恢复绿色，CI（如已接）全绿。web 此刻已是"可安全动手术"状态。

### P1 · 阶段 1：React 19 升级（1–2 天，趁 TDesign 还在，早升级早换轨）

| 动作 | 说明 |
|---|---|
| 1.1 升级 react/react-dom/@types 至 ^19 | peer 已验证无冲突；web 已用 createRoot（无 legacy API） |
| 1.2 升级 @testing-library/react 至 ^16.3+ 并跑全量 | 65 例全绿 |
| 1.3 冒烟重点：TDesign 组件在 React 19 下的运行时表现 | ChatMessage 流式渲染、Form 校验、Dialog/Popup 开关。**应变分支**：若 TDesign 在 19 下有运行时异常（peer 开放但实现未验证），把阶段 4（chat 替换）提前到此处执行，阶段 2/3 顺延 |
| 1.4 lucide-react 升 ^0.469 对齐 desktop | 与 0.1 的类型修复互为确认 |

**退出标准**：React 19 + TDesign 全功能冒烟通过，65 测试绿。

### P1 · 阶段 2：Tailwind 4 + 设计令牌 + shadcn 基座（3 天）

| 动作 | 说明 |
|---|---|
| 2.1 TW3→TW4 | `@tailwindcss/vite` 插件 + CSS-first 配置（tailwind.config.ts 内容迁入 `@theme`）；`tailwindcss-animate`→TW4 内置 animation 或 `tw-animate-css`；web 的 `.tw-scope` 作用域策略**废除**（全站统一用 Tailwind，与 desktop 一致）——task 模式现有 tailwind 类名逐个过一遍（TW4 少数工具类改名） |
| 2.2 tokens.css 对齐 desktop 语义 | web tokens.css 保留变量名（被手写 CSS 引用），**变量值**与 desktop index.css 的色板/圆角/阴影对齐；亮暗主题机制不变（data-theme + t-theme-dark 换成 TW4 dark 策略后统一） |
| 2.3 基座组件入库 | 抄 desktop 14 件（button/dialog/dropdown-menu/avatar/tooltip/…直接可用）；shadcn 新增 select/switch/slider/checkbox/popover/input/label；自建 spinner + toast（sonner 接 Provider 于 main.tsx） |
| 2.4 图标策略统一 | 全部走 lucide-react（消灭 Sidebar 内联手写 SVG；tdesign-icons-react 随阶段 5 移除） |

**退出标准**：新组件在独立演示路径可达（或 Storybook 式临时页），旧页面零改动零影响（**双轨共存：components/ui/ 与 TDesign 并存**）。

### P2 · 阶段 3：非 chat 页面替换（5 天，每页独立提交、独立可回滚）

按风险从低到高逐页替换，**每页一个 commit，随时可 revert**：

| 顺序 | 页面 | 工作量 | 要点 |
|---|---|---|---|
| 3.1 | NotFound / HelpPage | 0.5 天 | 纯静态，仅 MessagePlugin→toast |
| 3.2 | auth 三页（Login/Register/Forgot） | 1.5 天 | Form rule→zod 校验平移；密码强度/确认提示逻辑不动；**补 autoComplete/密码可见性/a11y（auth 设计文档 P0 项，顺手清账）** |
| 3.3 | SettingsDialog | 1 天 | Switch/Slider/Select/Radio→shadcn 四件；**顺手落实功能审计结论：8 个假设置砍掉或标"开发中"禁用，TRAE 文案清理** |
| 3.4 | Sidebar + TopNav | 2 天 | Dialog×3→ui/dialog、Popup→dropdown-menu、Avatar/Loading/Tooltip→基座；重命名/归档/无限滚动/骨架屏逻辑零改动（都在 SidebarItem 与 store 层）；**顺手拆分 856 行单文件为 Sidebar/AccountPopover/SidebarItem 三件（复用阶段 3 的组件测试）** |

**退出标准**：除 chat 模式外全站已无 TDesign 渲染；冒烟清单 ②④⑤ 通过；此状态下 web 已可长期稳定运行（chat 仍走 TDesign 旧轨）。

### P3 · 阶段 4：chat 模式去 TDesign（5–6 天）——全局最大风险项，放最后单独攻坚

| 动作 | 说明 |
|---|---|
| 4.1 类型平地化 | `types/tdesign.ts` 的 `ChatMessagesData/ChatStatus/ChatComment` 深拷贝为自建 `types/chat.ts`（**结构不变**——它是全 app 消息类型的根基，先平移类型让所有组件无感切换，tdesign-web-components 依赖随阶段 5 删除） |
| 4.2 抽取共享 SSE 解析器 | 落地 docs §6.1 欠账：新建 `lib/parseAguiStream.ts`（纯函数，reader→事件回调），**useAgentChat 与 usePlanExecuteChat 一并改为调用它**（消灭 150 行重复），并为它写 mock SSE 单测 |
| 4.3 自研 useAguiChat | ChatMode 的 useChat 替换：对齐 desktop 的 streamAgui 模式 + 保留 web 特有逻辑（历史 setMessages 手动同步、游标分页、停止→/stop 联动、重生成→regenerate API、两阶段 AI 标题——**这些全在 ChatMode/store 层，不受影响**）；配套 mock SSE 单测覆盖 流式/停止/错误/abort |
| 4.4 消息渲染 | ChatMessage→气泡组件 + **react-markdown + remark-gfm + rehype-highlight + rehype-sanitize**（对齐 desktop；顺带获得表格/代码高亮，替换自研 206 行渲染器）；reasoning 折叠区平移 |
| 4.5 输入区 | ChatSender→shadcn textarea 组合件：**直接复用 useTaskInput 的 IME/草稿/autosize 逻辑**（chat 模式顺带获得 IME 保护，修复 chat 未覆盖的输入细节）；R1 开关→ui/toggle |
| 4.6 操作栏 | ChatActionBar→自建五按钮小件，copy/good/bad/share/replay 逻辑逐行平移 |

**退出标准**：冒烟清单 ① 全流程通过；新增 useAguiChat/parseAguiStream 单测 ≥15 例全绿；ChatMessageItem 的 comment 同步问题（P2-5）顺手修复。

### P4 · 阶段 5：清理与收尾（2–3 天）

| 动作 | 说明 |
|---|---|
| 5.1 移除 TDesign 全家 | `tdesign-react/@tdesign-react/chat/tdesign-icons-react` + main.tsx 样式 import + types/tdesign.ts 删除（已被 types/chat.ts 替代）；确认全库 grep 零引用 |
| 5.2 依赖收敛 | react-router 双包→react-router-dom 单包（保留 BrowserRouter，web 不学 desktop 的 Hash）；@radix-ui 版本对齐 desktop；自研 Markdown.tsx 与 extractCodeBlocks 的关系梳理（extractCodeBlocks 有 16 例测试保留，Markdown 移除） |
| 5.3 全量回归 | 65+新增测试全绿 + 冒烟清单全项 + 亮暗主题双态过一遍 + 移动端断点抽查 |
| 5.4 文档 | docs/ 增补"UI 栈对齐说明"（映射表 + 双轨期历史 + TW4 作用域变更），更新 memory |

---

## 三、"不影响正常使用"的保障机制（对应你的硬约束）

1. **每阶段退出即可发布**：typecheck/test/build/冒烟四道门禁，任何阶段中断都不留半成品状态（P2 阶段结束时 chat 仍是旧栈但全功能可用——新旧双轨天然支持这种中间态）。
2. **组件双轨**：`components/ui/`（新）与 TDesign（旧）整个阶段 2–3 并存，替换是"页面级切换"而非"全量切换"，单页 commit 可独立 revert。
3. **业务逻辑层零改动**：api/client.ts、store×6、hooks×3、conversationStore 的乐观更新/游标分页、useTaskInput/usePlanExecuteChat 全部不动——重写只发生在渲染层。功能回归风险因此收敛到"组件 props 映射是否正确"这一低维问题。
4. **风险最大项放最后且最小化**：chat 替换的不可控点只有 useChat 内部行为（消息 id 管理/流式 status），4.2/4.3 用 mock SSE 单测先固化后端契约再动手，且 desktop 的 streamAgui 是已验证的参照实现（不是从零摸索）。
5. **主分支纪律**：每阶段一个 PR 序列，dev 分支验证冒烟后并入；阶段 4 的 chat 重写在 feature 分支进行到冒烟通过才合入，master 上的 chat 始终可用。

## 四、风险清单

| 级别 | 风险 | 概率 | 缓解 |
|---|---|---|---|
| P1 | TDesign 在 React 19 下运行时异常（peer 开放但未实测） | 低-中 | 阶段 1 首日冒烟即验证；触发则启用应变分支（chat 替换提前） |
| P1 | chat 四件套自建的回归面（消息 id 一致性/流式 status/反馈指向） | 中 | 4.1 类型结构不变策略 + 4.2/4.3 mock SSE 单测先行 + desktop 参照实现 |
| P2 | TW3→TW4 工具类改名/task 模式样式回归 | 中 | 2.1 后 task 模式全页面人工过一遍；TW4 迁移指南逐条对照 |
| P2 | MessagePlugin 15+ 调用点形态差异（info/success/error/loading） | 低 | sonner API 高度同构，机械替换 + grep 验收零残留 |
| P2 | Form rule→zod 平移遗漏校验细节（密码强度/确认匹配） | 低 | auth 设计文档 §三 列明了全部规则，逐条对照 |
| P3 | 手写 CSS（4.8k 行）与新 Tailwind preflight 冲突 | 中 | TW4 preflight 影响面在阶段 2 统一排查；tokens.css 变量机制不变，冲突集中在 reset 层 |
| P3 | 工作量膨胀（chat 重写中发现 useChat 隐性依赖） | 中 | 4.3 严格以现有 ChatMode 行为为验收基准，不顺手扩需求 |

## 五、总工作量与里程碑

| 里程碑 | 累计 | 交付状态 |
|---|---|---|
| M1（P0 完成，第 2 天） | 2 天 | 构建链修复，web 回到可迭代状态 |
| M2（P1 完成，第 7 天） | ~7 天 | React 19 + TW4 + 基座就位，双轨开始 |
| M3（P2 完成，第 12 天） | ~12 天 | 非 chat 全部新栈，**可长期稳定运行的中点态** |
| M4（P3 完成，第 18 天） | ~18 天 | chat 新栈，TDesign 出局 |
| M5（P4 完成，第 21 天） | ~21 天 | 依赖收敛 + 全量回归，**web 与 desktop UI 栈完全对齐** |

## 六、与 desktop 对齐后的最终形态

- **对齐项**：React 19 / Tailwind 4 / Radix-shadcn 组件基座（同名组件可直接互相移植）/ react-markdown 渲染链 / lucide-react / cva+cn 工具 / 无 TDesign
- **有意不对齐项**（各归其位，不做无谓迁移）：状态管理 web 保持纯 Zustand（不引 Jotai）；路由 web 用 BrowserRouter（desktop 因 file:// 用 Hash）；HTTP 层 web 保留 fetch 封装（401 刷新逻辑是 web 资产，desktop 是 axios+token 轮换，各配各的后端形态）
- **额外收益**（重写顺带清账）：tsc 28 错修复、ESLint 从无到有、8 个假设置清理、TRAE 文案清除、auth a11y 补齐、chat 获得表格/代码高亮渲染、三份 useChatSync 与两份 SSE 解析器收敛、InputArea 级 IME 能力覆盖 chat 模式
