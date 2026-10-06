# web UI 栈对齐 desktop 说明（2026-10-05 实施记录）

> 交付物：`apps/web` 完成 React 19 + Tailwind 4 + shadcn/Radix 重写，TDesign 全家下线，与 `apps/desktop` renderer 层 UI 栈对齐。
> 依据：`outputs/web-UI栈对齐desktop重写方案-2026-10-05.md`（P0→P4 全程按计划执行，门禁为 `npm run typecheck/lint/test/build` 四绿）。

## 1. 最终技术栈

| 层 | 重写前 | 重写后（与 desktop 对齐） |
| --- | --- | --- |
| React | 18.3.1 | **19.3.0**（@types/react 19） |
| 样式 | Tailwind 3.4 + postcss（仅 task 作用域）+ TDesign 全局 CSS | **Tailwind CSS 4**（@tailwindcss/vite，CSS-first，无 postcss 配置） |
| 组件 | tdesign-react / @tdesign-react/chat | **shadcn/ui + Radix**（avatar/dialog/dropdown-menu/tooltip/label/input/button/card/input/textarea/checkbox/popover/switch/slider/select/radio-group/scroll-area） |
| 图标 | tdesign-icons-react + 大量内联 SVG | **lucide-react@0.469** |
| Toast | MessagePlugin | **sonner@2**（`<Toaster richColors position="top-center"/>` 挂在 main.tsx） |
| Markdown | 206 行自研正则渲染器（无表格/代码高亮） | **react-markdown 10 + remark-gfm 4 + rehype-highlight 7 + rehype-sanitize 6**（XSS 白名单 + 安全链接 + 代码块复制） |
| 路由 | react-router 7 + react-router-dom 7 双包 | **react-router-dom 单包**（BrowserRouter 保留） |
| 校验 | TDesign Form rules | 原生受控 + 手写校验（规则逐行平移，未引入 react-hook-form/zod） |

## 2. TDesign → shadcn 映射表（实施版）

| 旧 API | 新物 | 备注 |
| --- | --- | --- |
| `Button/Input/Textarea` | `ui/button|input|textarea` | desktop 同款源码 |
| `Form + rule` | 受控 state + validate 函数 | auth 三页；touched/submitted 显示错误 |
| `Checkbox` | `ui/checkbox`（Radix） | onCheckedChecked，非 onChange |
| `Dialog` | `ui/dialog` | Sidebar 删除/登出/个人中心均改为 Radix Dialog |
| `Popup` | `ui/dropdown-menu` | Sidebar 账号菜单、会话项"…"菜单 |
| `Avatar/Loading/Tooltip` | `ui/avatar/spinner/tooltip` | Tooltip 需 TooltipProvider 包裹 |
| `Switch/Slider/Select/Radio` | 同名 shadcn 件 + 自绘分段控件（`.seg`） | 设置弹窗 |
| `MessagePlugin.info/success/error` | `toast.*`（sonner API 同构，机械替换） | 全站 38+ 处 |
| `useChat(agui)` 四件套 | 自研 `useAguiChat` + `lib/parseAguiStream` | 见 §4 |
| `ChatSender` | shadcn textarea 组合卡片 | IME/草稿/autosize 复用 `useTaskInput` |
| `ChatMessage` 气泡 | 自建消息行/气泡/reasoning 折叠块 | 蓝泡用户、通栏助手、hover 操作栏 |
| `ChatActionBar` 五按钮 | 自建 `.chat-action-bar`（lucide） | copy/good/bad/share/replay 逻辑逐行平移 |

## 3. 主题与令牌

- 暗色机制统一为 `<html data-theme="light|dark">`（system 模式移除属性，媒体查询兜底）；
  Tailwind 4 端用 `@custom-variant dark (&:is([data-theme='dark']...))`，与手写 tokens.css 同一属性。
  TDesign 的 `theme-mode` / `t-theme-dark` 已删除。
- shadcn 令牌（`styles/tailwind.css`）取值对齐 desktop `index.css` 的中性 oklch 调色板；
  旧业务手写 CSS 变量（`tokens.css`）保留，重写页面继续消费，两套变量在同一页面共存。
- 正文字号设置接线：`--app-font-size` 作用于 `html { font-size }`，shadcn rem 组件随之缩放。

## 4. AG-UI 流式收敛

- `src/lib/parseAguiStream.ts`：纯函数 SSE 解析器（reader/行缓冲/粘包拆包/`[DONE]`/脏行容忍/abort），
  返回 `{ reason: finished|closed|error-event|aborted, error?, eventCount }`。
- 三个对话 hook 共用同一解析器：
  - `modes/chat/hooks/useAguiChat.ts`（新增，chat/completions + deepThink）
  - `modes/pro/hooks/useAgentChat.ts`（agent/completions + stateMap）
  - `modes/task/hooks/usePlanExecuteChat.ts`（agentMode=plan_execute + plan store）
- 消息类型平地化：`src/types/chat.ts`（结构与 tdesign chat-engine 一致，自包含），
  `types/tdesign.ts` deep-reexport 已删除。

## 5. Monorepo / 工程化注意事项

- React 19 当前已提升到仓库根（marketing 亦为 React 19）；工作区只剩单一 React 副本。
  历史上 web 嵌套 React 19 与根 React 18 共存过，为防双 React 回归，保留了两道保险：
  - `vite.config.ts` 的 `resolve.dedupe`；
  - Vitest 的 `src/test/forceReactSingleton.ts`（ESM `module.register` resolve hook +
    CJS `Module._resolveFilename` patch，把 react/react-dom/scheduler 统一到 web 的 19 副本）。
  若未来根再次出现 React 18（如引入新的 18-only 工作区），这两处会继续兜底；
  若确认永久单副本，可在后续清理中移除。
- Vite 依赖预构建缓存对依赖树变化敏感；增删大量依赖后如遇
  `ENOENT .../node_modules/react/...`，用 `npx vite --force` 重建 `.vite` 缓存。
- 阶段 2 临时演示页 `/__ui-preview` 已在 P4 随路由与文件一并删除。

## 6. 顺手修复的存量问题

- `TaskMessageList` hooks 规则违规（P1-4）：MessageContent hooks 上移。
- Sidebar 856 行单文件拆为 `Sidebar/SidebarItem/AccountPopover/ConfirmDialog`。
- 设置弹窗 8 个"存而不用"假设置：6 个禁用并打"开发中"徽标（语言/桌面通知/提示音/显示时间/语音快捷键/隐私模式），桌面 IDE 语境的"本地链接打开方式"整条移除；TRAE 品牌文案与终端语境文案清理。
- Radix DropdownMenu 键盘选中后立即挂载 Dialog 导致 `body{pointer-events:none}` 残留：菜单项 onSelect 中同步清除。
- 设置浮层 Portal 到 body：修复移动端 `<aside>` transform 收纳 fixed 后代导致弹窗被困抽屉；补窄屏 max-width。
- P2-5：ChatMessageItem 的 comment 状态用 useEffect 与消息反馈同步。
- auth：autoComplete（username/current-password/new-password/email）、密码可见性、label/aria-invalid/aria-describedby 补齐。

## 7. 遗留 / 后续

- 实时流式端到端冒烟受运行中的 backend-ts 旧 Prisma Client 阻塞（`ChatSessionCreateInput` 缺
  `runtime` 字段，POST /api/chat/sessions 500）。修复：在 `apps/backend-ts` 重新
  `prisma generate` 并重启 8088，然后按 `docs/冒烟测试清单.md` ① 复测
  （登录→发消息→流式→停止→重生成→反馈→AI 标题/归档/恢复/删除）。
  流式生命周期已由 27 个新单测（parseAguiStream 11 + useAguiChat 16）在 mock SSE 下覆盖。
- task/pro 右侧面板在 ≤768px 下的响应式（自动收起/移动端可再展开）为存量问题，单独排期。
- 帮助页 example.com / support@example.com 占位链接仍待替换为真实地址。
- 测试规模：65 → 92（+27）；ChatMode chunk 2067KB(gzip 553KB) → 16.7KB(gzip 6.2KB)。
