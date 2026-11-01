# desktop 对齐 web 分析模式与用户消息编辑重发（2026-11-01）

## 背景

本轮改动目标是让桌面端在「账号弹层、消息过程展示、消息操作栏、用户消息编辑」四处与
`apps/web` 分析模式（Pro）保持一致，同时修复上游模型名不合法导致的 400。

涉及模块：`apps/desktop`（renderer 主进程无关）、`apps/backend-ts`（模型别名）。

## 1. 账号弹层复刻 web

文件：`apps/desktop/src/renderer/src/components/sidebar/AccountMenu.tsx`

- 结构逐项对齐 web `AccountPopover`：
  设置 / 外观设置（级联：跟随系统·浅色模式·深色模式，当前项对勾）/
  收藏夹 / 创路Agent官网 / 下载创路电脑版 / 帮助与反馈 / 退出登录
- 移除桌面端原有的账号头部（名字/邮箱）与底部版本号
- 容器 `min-width 240px`、6px 内边距、16px 外圆角；行 10×12px 内边距、10px 圆角、
  14px 字号、16px 图标、2px 上下间距
- hover 行内圆底 `#e2e3e8`（深色 `#2c2c2c`）；分隔线左右 4px、上下 6px 内缩
- 占位项弱化文字色 `#9ca3af` / `#7a7a7a`、禁止光标、无 hover 高亮
- 退出登录常态同主文字色，hover 浅红底 + 红字，并接入全局 ConfirmDialog 二次确认

## 2. 消息过程容器对齐

文件：`apps/desktop/src/renderer/src/components/chat/AgentTimeline.tsx`

- 顶部摘要行改为 web `ProcessContainer` 形态：
  `已完成 · 耗时 8 秒` / `运行中 · 已用 X 秒`；运行中显示蓝色呼吸点
- 摘要行内容宽度、行内排列，箭头紧贴文字（不再整行铺开、箭头贴最右）
- 流式 → 终态自动收起为一行摘要；历史消息默认收起，点击展开
- 深度思考行：`深度思考`（运行中显示「开始思考」+ 呼吸），移除行尾耗时
- 思考正文改为左 4px 竖线引用、限高 188px 内部滚动、Markdown 渲染
- 工具行统一为行内紧凑样式，运行中图标蓝色呼吸；明细为左 2px 竖线 + 灰底代码块

## 3. 消息操作栏对齐

文件：`apps/desktop/src/renderer/src/components/chat/MessageBubble.tsx`

- AI 操作栏顺序对齐 web：复制 · 赞 · 踩 · 分享 · 重新生成
- 按钮 28px、图标 15px、圆角 6px；hover 底色 `#e2e3e8`（深色 `#2c2c2c`）
- 点赞/点踩选中态使用 web 的强调蓝 `#3b82f6` / `#46a8f0`；token 用量字号 12px
- 用户消息元信息行：12px 时间 + 28px 圆角操作钮，hover / focus 才显示

## 4. 用户消息编辑重发（方案 B）

涉及文件：

- `apps/desktop/src/shared/types.ts`：`SendMessageRequest` 增加 `truncateAfter`
- `apps/desktop/src/renderer/src/stores/chatStore.ts`
- `apps/desktop/src/renderer/src/components/chat/MessageBubble.tsx`
- `apps/desktop/src/renderer/src/components/chat/ChatArea.tsx`
- `apps/desktop/src/renderer/src/components/chat/MessageScrollerList.tsx`

流程：

1. 用户消息 hover 操作栏出现「编辑」铅笔按钮；点击进入行内编辑卡片
2. 编辑卡片支持自动增高（44–240px）、提示条、取消/发送；
   Enter 发送、Shift+Enter 换行、Esc 取消，IME 合成中的 Enter 不发送
3. 提交后 `chatStore.editMessage`：
   - 云端会话：请求携带真实 `messageId` + `truncateAfter: true`，后端在同一事务内
     更新该消息正文并截断其后消息（`/chat/completions`、`/agent/completions` 均支持）
   - 本会话新发的乐观 id（`user-<ts>`）：先拉取历史，按 `(role, 正文)` 从尾部单调回溯
     对齐后端真实 id；匹配失败直接报错，不猜 id
   - 本地乐观更新：目标用户消息就地替换正文、丢弃其后消息、重新追加 assistant 占位
4. 本地（SQLite）会话同时截断本地库，并以原 id 回写新正文；assistant 终态仍由
   现有落库链路写入

限制：本地（离线）会话暂不开放编辑入口——主进程 Agent 的对话上下文由 LangGraph
checkpoint 承载，缺少回滚/重建能力，强行编辑会保留旧上下文。

## 5. 模型别名兼容（上游 400 修复）

文件：`apps/backend-ts/src/config/models.ts`、`apps/backend-ts/test/models-config.test.ts`

- 上游只接受 `deepseek-flash` / `deepseek-v4-pro`；旧客户端可能把展示名
  “DeepSeek-V4.1-Flash” 当模型下发，触发 400
- `LEGACY_MODEL_ALIASES` 增加 `deepseek-v4.1-flash → deepseek-flash`
- `resolveModelAlias` 增加大小写兜底：`DeepSeek-V4.1-Flash`、`deepseek-v4-Pro`
  等写法均收敛到目录中的真实 ID；未知模型仍原样透传
- 回归用例覆盖展示名旧值与大小写变体

## 验证记录

- `apps/desktop`：`npm run typecheck`（node + web）通过
- `apps/desktop`：`npm run build` 通过
- `apps/backend-ts`：`npx vitest run test/models-config.test.ts` 8 项通过
- 后端 `tsx watch` 热重启后 `/health` 200
- 桌面端生产构建已重启，账号弹层、过程容器、操作栏、编辑重发均已生效

## 已知边界

- 桌面端没有 toast 体系：web 的占位项点击提示、编辑失败提示在桌面端分别退化为
  「置灰不可交互」与「底部错误条」
- 本地会话编辑需后续补齐 checkpoint 截断能力后再开放
