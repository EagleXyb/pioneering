# Pioneering Desktop 可视化设计规范

> 版本 1.0 · 2026-08-07  
> 基于 `apps/desktop` 代码库深度提取，参考 Apple Human Interface Guidelines 与 shadcn/ui 设计系统实践。

---

## 1. 设计原则

### 1.1 核心原则

| 原则 | 说明 |
|------|------|
| **清晰 (Clarity)** | 内容为王。每个像素都有其目的，不添加装饰性冗余。文字层级清晰，操作路径可预测。 |
| **一致 (Consistency)** | 同一概念使用同一组件，同一组件使用同一变体。系统级 token 驱动，无硬编码值。 |
| **高效 (Efficiency)** | 操作即反馈。悬浮态、聚焦态、按下态均以毫秒级过渡响应。快捷键与键盘导航优先。 |
| **尊重 (Deference)** | UI 退后，内容向前。中性灰色调 + 白色卡片作为画布，品牌色仅用于功能性强调。 |
| **平台适配 (Platform-aware)** | macOS / Windows / Linux 各自遵循原生窗口惯例——红绿灯、标题栏、菜单栏、滚动条，通过 CSS 变量统一管理。 |

### 1.2 Apple 设计语言参考

本系统在以下方面参考 Apple Human Interface Guidelines：

- **窗口管理**：macOS 下使用红绿灯（traffic lights）系统原生控件，全屏隐藏标题栏；Windows/Linux 自绘标题栏与窗口控制按钮。
- **字体层级**：macOS 使用 SF Pro 字体栈，其他平台回退到系统 UI 字体，与 Apple 的「平台原生字体优先」原则一致。
- **内容区域**：白色卡片浮于灰色背景之上，形成视觉层次，类似 macOS 偏好设置面板的布局风格。
- **动效曲线**：使用 `cubic-bezier(0.16, 1, 0.3, 1)` 作为标准缓动曲线，与 Apple 的 iOS/macOS 动画曲线接近。

---

## 2. 技术栈约定

### 2.1 框架与工具链

| 层 | 技术选型 | 版本 |
|----|---------|------|
| 框架 | React | 19.0.0 |
| 构建工具 | Vite + electron-vite | 6.0.0 / 4.0.1 |
| 样式方案 | Tailwind CSS 4 + CSS 自定义属性 | 4.0.0 |
| 类型系统 | TypeScript | 5.7.0 |
| 状态管理 | Jotai + Zustand | 2.20.1 / 5.0.0 |
| 路由 | react-router-dom (HashRouter) | 7.18.1 |
| 测试 | Vitest | 2.1.9 |

### 2.2 UI 组件库

| 库 | 用途 |
|----|------|
| `radix-ui` / `@radix-ui/*` | 无障碍原语（Dialog, DropdownMenu, Tooltip, Tabs, ScrollArea, Avatar, Collapsible, Slot） |
| `class-variance-authority` (cva) | 组件变体驱动的样式管理 |
| `clsx` + `tailwind-merge` | 条件类名合并（`cn()` 工具函数） |
| `lucide-react` | 图标库（全部图标均从该库引入） |
| `react-resizable-panels` | 可拖拽调整大小的面板布局 |
| `@tanstack/react-virtual` | 长列表虚拟化 |

### 2.3 命名约定

所有设计 token 遵循 `kebab-case` 命名：

| 类别 | 模式 | 示例 |
|------|------|------|
| 颜色（视觉层） | `color-{role}-{shade}` | `color-primary-500`, `color-neutral-100` |
| 颜色（语义层） | `color-{semantic-role}` | `color-brand`, `color-bg-surface` |
| 间距 | `spacing-{size}` | `spacing-xs`, `spacing-md` |
| 字号 | `font-size-{scale}` | `font-size-sm`, `font-size-lg` |
| 圆角 | `radius-{size}` | `radius-sm`, `radius-md`, `radius-lg` |
| 阴影 | `shadow-{level}` | `shadow-sm`, `shadow-md`, `shadow-lg` |
| 动效 | `motion-duration-{speed}` | `motion-duration-fast`, `motion-duration-normal` |
| 组件 | `{component}-{property}` | `btn-bg`, `card-shadow` |

---

## 3. 色彩系统

### 3.1 视觉层 — 色板（Light Mode）

色板采用 OKLCH 色彩空间定义，保证明暗主题下的色彩一致性。

| Token | OKLCH 值 | 等值 HEX | 用途 |
|-------|----------|----------|------|
| `--background` | `oklch(1 0 0)` | `#ffffff` | 页面背景 |
| `--foreground` | `oklch(0.145 0 0)` | `#252525` | 正文文字 |
| `--card` | `oklch(1 0 0)` | `#ffffff` | 卡片背景 |
| `--card-foreground` | `oklch(0.145 0 0)` | `#252525` | 卡片文字 |
| `--primary` | `oklch(0.205 0 0)` | `#343434` | 品牌色（深灰） |
| `--primary-foreground` | `oklch(0.985 0 0)` | `#fafafa` | 品牌色上文字 |
| `--secondary` | `oklch(0.97 0 0)` | `#f5f5f5` | 次要背景 |
| `--secondary-foreground` | `oklch(0.205 0 0)` | `#343434` | 次要文字 |
| `--muted` | `oklch(0.97 0 0)` | `#f5f5f5` | 柔化背景 |
| `--muted-foreground` | `oklch(0.556 0 0)` | `#8e8e8e` | 次要/辅助文字 |
| `--accent` | `oklch(0.97 0 0)` | `#f5f5f5` | 强调背景 |
| `--accent-foreground` | `oklch(0.205 0 0)` | `#343434` | 强调文字 |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `#e54b4b` | 破坏性操作 |
| `--destructive-foreground` | `oklch(0.985 0 0)` | `#fafafa` | 破坏性文字 |
| `--border` | `oklch(0.922 0 0)` | `#eaeaea` | 边框/分割线 |
| `--input` | `oklch(0.922 0 0)` | `#eaeaea` | 输入框边框 |
| `--ring` | `oklch(0.708 0 0)` | `#b4b4b4` | 聚焦环 |
| `--sidebar` | `#e5e7eb` | `#e5e7eb` | 侧边栏背景 |
| `--sidebar-foreground` | `oklch(0.145 0 0)` | `#252525` | 侧边栏文字 |
| `--sidebar-accent` | `oklch(0.97 0 0)` | `#f5f5f5` | 侧边栏强调 |
| `--sidebar-border` | `oklch(0.922 0 0)` | `#eaeaea` | 侧边栏边框 |

### 3.2 视觉层 — 色板（Dark Mode）

| Token | OKLCH 值 | 用途 |
|-------|----------|------|
| `--background` | `oklch(0.145 0 0)` | 页面背景 |
| `--foreground` | `oklch(0.985 0 0)` | 正文文字 |
| `--card` | `oklch(0.205 0 0)` | 卡片背景 |
| `--primary` | `oklch(0.922 0 0)` | 品牌色 |
| `--primary-foreground` | `oklch(0.205 0 0)` | 品牌色上文字 |
| `--secondary` | `oklch(0.269 0 0)` | 次要背景 |
| `--muted` | `oklch(0.269 0 0)` | 柔化背景 |
| `--muted-foreground` | `oklch(0.708 0 0)` | 次要文字 |
| `--accent` | `oklch(0.269 0 0)` | 强调背景 |
| `--destructive` | `oklch(0.704 0.191 22.216)` | 破坏性操作 |
| `--border` | `oklch(1 0 0 / 10%)` | 边框 |
| `--input` | `oklch(1 0 0 / 15%)` | 输入框边框 |
| `--ring` | `oklch(0.556 0 0)` | 聚焦环 |
| `--sidebar` | `oklch(0.205 0 0)` | 侧边栏背景 |
| `--sidebar-foreground` | `oklch(0.985 0 0)` | 侧边栏文字 |

### 3.3 语义层 — 角色 Token

| Token | 浅色引用 | 深色引用 | 用途 |
|-------|---------|---------|------|
| `color-brand` | `var(--primary)` | `var(--primary)` | 品牌元素 |
| `color-bg-page` | `var(--background)` | `var(--background)` | 页面背景 |
| `color-bg-surface` | `var(--card)` | `var(--card)` | 卡片/面板背景 |
| `color-text-primary` | `var(--foreground)` | `var(--foreground)` | 主文字 |
| `color-text-secondary` | `var(--muted-foreground)` | `var(--muted-foreground)` | 辅助文字 |
| `color-border-default` | `var(--border)` | `var(--border)` | 默认边框 |
| `color-border-focus` | `var(--ring)` | `var(--ring)` | 聚焦边框 |
| `color-bg-subtle` | `var(--muted)` | `var(--muted)` | 轻微背景 |
| `color-feedback-error` | `var(--destructive)` | `var(--destructive)` | 错误提示 |

### 3.4 图表色板

| Token | 浅色 OKLCH | 浅色 HEX | 深色 OKLCH |
|-------|-----------|----------|-----------|
| `--chart-1` | `oklch(0.646 0.222 41.116)` | `#e87040` | `oklch(0.488 0.243 264.376)` |
| `--chart-2` | `oklch(0.6 0.118 184.704)` | `#5ab8a0` | `oklch(0.696 0.17 162.48)` |
| `--chart-3` | `oklch(0.398 0.07 227.392)` | `#4a6a90` | `oklch(0.769 0.188 70.08)` |
| `--chart-4` | `oklch(0.828 0.189 84.429)` | `#e8c840` | `oklch(0.627 0.265 303.9)` |
| `--chart-5` | `oklch(0.769 0.188 70.08)` | `#d8a840` | `oklch(0.645 0.246 16.439)` |

---

## 4. 字体排版

### 4.1 字体栈

| Token | 值 | 平台 |
|-------|-----|------|
| `font-family-sans` | `'Public Sans', ui-sans-serif, system-ui, sans-serif` | 默认回退 |
| `font-family-sans` (macOS) | `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Public Sans', ui-sans-serif, system-ui, sans-serif` | macOS |
| `font-family-sans` (Windows) | `'Segoe UI', 'Public Sans', ui-sans-serif, system-ui, sans-serif` | Windows |
| `font-family-sans` (Linux) | `'Public Sans', ui-sans-serif, system-ui, sans-serif` | Linux |
| `font-family-mono` (代码) | `Consolas, 'Monaco', 'Menlo', 'Ubuntu Mono', 'Andale Mono', 'Courier New', monospace` | 所有平台 |

### 4.2 字号与行高

| 层级 | 字号 | 行高 | 字重 | 用途 |
|------|------|------|------|------|
| `text-xs` | 11–12px | `1.2` | 400 | 标签、辅助文字、徽章 |
| `text-sm` | 13–14px | `1.4` | 400 / 500 | 会话列表项、表格单元格、表单标签 |
| `text-base` | 15–16px | `1.5` | 400 / 500 | 正文、按钮标签、输入文本 |
| `text-lg` | 16–20px | `1.4` | 600 | 子标题、卡片标题 |
| `text-xl` | 20–24px | `1.3` | 600 | 页面区段标题 |
| `text-2xl` | 24–32px | `1.25` | 600 | 页面标题、欢迎页主标题 |

### 4.3 字重

| Token | 值 | 用途 |
|-------|-----|------|
| `font-normal` | 400 | 正文文本 |
| `font-medium` | 500 | 标签、表头、强调 |
| `font-semibold` | 600 | 标题、按钮 |
| `font-bold` | 700 | 大标题（保留） |

### 4.4 对话区排版（`.chat-markdown`）

| 元素 | 样式 |
|------|------|
| 段落 | 字号 15px，行高 1.75（leading-7），上下边距 10px |
| 一级标题 | `text-xl` + `font-semibold`，上下边距 20px / 10px |
| 二级标题 | `text-lg` + `font-semibold`，上下边距 16px / 8px |
| 三级标题 | `text-[15px]` + `font-semibold`，上下边距 14px / 6px |
| 列表 | 无序 `list-disc` / 有序 `list-decimal`，缩进 20px，行间距 6px |
| 引用块 | 左边框 2px，`muted-foreground` 文字颜色 |
| 行内代码 | `muted` 背景，`0.85em` 字号，`px-1 py-0.5` 内边距 |
| 代码块 | 13px 等宽字体，行高 1.65 |
| 表格 | 字号 `text-sm`，`border-border` 边框，表头 `font-semibold` |

---

## 5. 间距系统

### 5.1 间距 Token

系统使用 4px 基网格（8pt 网格系统参考）。

| Token | 值 | 用途 |
|-------|-----|------|
| `spacing-0.5` | 2px | 极紧凑间距 |
| `spacing-1` | 4px | 图标与标签间隙 |
| `spacing-1.5` | 6px | 紧凑内边距 |
| `spacing-2` | 8px | 表单字段内部间距 |
| `spacing-2.5` | 10px | 输入框内边距 |
| `spacing-3` | 12px | 侧边栏内边距 |
| `spacing-3.5` | 14px | 段落间距 |
| `spacing-4` | 16px | 默认卡片内边距 |
| `spacing-5` | 20px | 输入框区域外间距 |
| `spacing-6` | 24px | 区段内间距 |
| `spacing-8` | 32px | 区段间间距 |
| `spacing-10` | 40px | 大区段间距 |

### 5.2 布局关键尺寸

| 变量 | 值 | 说明 |
|------|-----|------|
| `--titlebar-h` | 48px | 标题栏高度（所有平台统一） |
| `--traffic-light-w` | 72px | macOS 红绿灯区域宽度 |
| `--chat-col-max` | 880px | 中栏内容最大宽度 |
| `--sidebar-width` | 262px | 侧边栏展开宽度 |
| `--radius-control` | 6–8px | 控件圆角（平台自适应） |
| `--gutter` | 5px | 卡片间沟渠宽度 |

---

## 6. 圆角系统

### 6.1 圆角 Token

基础圆角 `--radius: 0.375rem`（约 6px），所有圆角由此派生。

| Token | 计算 | 约值 | 用途 |
|-------|------|------|------|
| `radius-sm` | `calc(var(--radius) * 0.6)` | 3.6px | 内部元素、标签 |
| `radius-md` | `calc(var(--radius) * 0.8)` | 4.8px | 按钮、输入框 |
| `radius-lg` | `var(--radius)` | 6px | 卡片容器、面板 |
| `radius-xl` | `calc(var(--radius) * 1.4)` | 8.4px | 侧边栏导航项 |
| `radius-2xl` | `calc(var(--radius) * 1.8)` | 10.8px | 对话框 |
| `radius-3xl` | `calc(var(--radius) * 2.2)` | 13.2px | 确认对话框 |
| `radius-4xl` | `calc(var(--radius) * 2.6)` | 15.6px | 大卡片 |
| `radius-full` | `9999px` | 圆形 | 头像、圆形按钮 |

### 6.2 平台自适应

| 平台 | `--radius-control` | 说明 |
|------|-------------------|------|
| macOS | 6px | 更紧凑的控件圆角 |
| Windows | 8px | Win11 风格圆角 |
| Linux | 6px | 紧凑风格 |

---

## 7. 阴影系统

### 7.1 阴影 Token

| Token | 值 | 用途 |
|-------|-----|------|
| `shadow-sm` | `0 1px 2px 0 rgba(0, 0, 0, 0.05)` | 卡片静态态 |
| `shadow-md` | `0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)` | 下拉菜单、弹出层 |
| `shadow-lg` | `0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)` | 对话框、浮动面板 |
| `shadow-xl` | `0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)` | 全屏覆盖层 |

### 7.2 输入框阴影

输入框卡片使用多层阴影构建层次感：

```css
/* 正常态 */
box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.02),
            0 2px 8px rgba(0, 0, 0, 0.04),
            0 8px 32px rgba(0, 0, 0, 0.06);

/* 聚焦态 */
box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.03),
            0 2px 10px rgba(0, 0, 0, 0.06),
            0 12px 40px rgba(0, 0, 0, 0.1);
```

### 7.3 暗色阴影

暗色模式下阴影更暗但更柔和，依靠亮度区分层级而非纯阴影。

---

## 8. 动效系统

### 8.1 动效曲线

| Token | 值 | 参考 |
|-------|-----|------|
| `ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | 标准弹入（欢迎页动画） |
| `transition-fast` | `150ms cubic-bezier(0.4, 0, 0.2, 1)` | 按钮、输入框过渡 |
| `transition-normal` | `200ms ease-out` | 抽屉滑入滑出 |
| `transition-duration` | `200ms` | 面板展开/折叠 |
| `duration-slow` | `300ms` | 欢迎页入场 |

### 8.2 关键帧动画

#### 欢迎页入场 (`welcome-fade-up`)

```css
@keyframes welcome-fade-up {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

子元素依次延迟：0ms → 80ms → 160ms。尊重 `prefers-reduced-motion: reduce`。

#### 消息高亮闪烁 (`artifact-source-flash`)

```css
@keyframes artifact-source-flash {
  0%   { box-shadow: 0 0 0 0 var(--ring); background-color: color-mix(...); }
  100% { box-shadow: 0 0 0 2px transparent; background-color: transparent; }
}
```

### 8.3 Radix 动画

所有 Radix 原语使用内置的 `animate-in` / `animate-out` 类：

| 组件 | 入场动画 | 出场动画 |
|------|---------|---------|
| Dialog | `fade-in-0 zoom-in-95 slide-in-from-left-1/2 slide-in-from-top-48%` | `fade-out-0 zoom-out-95` |
| DropdownMenu | `fade-in-0 zoom-in-95` | `fade-out-0 zoom-out-95` |
| Tooltip | `fade-in-0 zoom-in-95 slide-in-from-top-2` | `fade-out-0 zoom-out-95` |

---

## 9. 图标系统

### 9.1 图标来源

所有图标从 `lucide-react` 引入，不引入自定义 SVG 图标。

### 9.2 图标尺寸

| 尺寸 Token | 像素 | 用途 |
|-----------|------|------|
| `size-3` | 12px | 窗口控制按钮 |
| `size-3.5` | 14px | 窗口控制按钮（大） |
| `size-4` | 16px | 默认：按钮内图标、导航项、会话操作 |
| `size-5` | 20px | 警告图标 |
| `size-8` | 32px | 占位页图标 |
| `size-10` | 40px | 空状态/错误状态大图标 |

### 9.3 描边宽度

所有图标使用 `strokeWidth={1.5}` 作为默认描边宽度。

### 9.4 图标颜色

图标继承 `currentColor`，通过 Tailwind 文字颜色类控制：

```
text-foreground        → 主文字色
text-muted-foreground  → 次要文字色
text-foreground/70     → HeaderButton 默认色
text-destructive       → 错误/警告图标
text-amber-500         → 确认对话框警告图标
text-blue-500          → 信息图标
```

### 9.5 50 个通用图标清单

| # | 图标名 (lucide-react) | 分类 | 用途 |
|---|----------------------|------|------|
| 1 | `PanelLeft` | 导航 | 展开/收起侧边栏 |
| 2 | `PanelRight` | 导航 | 展开/收起上下文面板 |
| 3 | `MessageCirclePlus` | 操作 | 新建任务/对话 |
| 4 | `Plus` | 操作 | 添加（通用） |
| 5 | `Search` | 操作 | 搜索 |
| 6 | `Filter` | 操作 | 筛选 |
| 7 | `Share2` | 操作 | 分享 |
| 8 | `History` | 操作 | 历史记录 |
| 9 | `X` | 导航 | 关闭/删除 |
| 10 | `Minus` | 窗口 | 最小化 |
| 11 | `Square` | 窗口 | 最大化/还原 |
| 12 | `Sparkles` | 导航 | 助理 |
| 13 | `FolderOpen` | 导航 | 技能 |
| 14 | `GraduationCap` | 导航 | 插件 |
| 15 | `Zap` | 导航 | 自动化 |
| 16 | `Ellipsis` | 导航 | 更多 |
| 17 | `ChevronDown` | 导航 | 展开 |
| 18 | `ChevronRight` | 导航 | 折叠 |
| 19 | `ChevronLeft` | 导航 | 返回 |
| 20 | `ChevronUp` | 导航 | 收起 |
| 21 | `GripVertical` | 操作 | 拖拽手柄 |
| 22 | `AlertTriangle` | 反馈 | 警告（确认对话框） |
| 23 | `Info` | 反馈 | 信息提示 |
| 24 | `AlertCircle` | 反馈 | 危险提示 |
| 25 | `Check` | 反馈 | 选中/完成 |
| 26 | `Circle` | 反馈 | 单选指示器 |
| 27 | `MoreHorizontal` | 操作 | 更多操作 |
| 28 | `MoreVertical` | 操作 | 更多操作（垂直） |
| 29 | `Settings` | 导航 | 设置 |
| 30 | `User` | 用户 | 用户头像/账户 |
| 31 | `LogOut` | 用户 | 退出登录 |
| 32 | `Trash2` | 操作 | 删除 |
| 33 | `Edit` | 操作 | 编辑/重命名 |
| 34 | `Copy` | 操作 | 复制 |
| 35 | `Download` | 操作 | 下载 |
| 36 | `Upload` | 操作 | 上传 |
| 37 | `Send` | 操作 | 发送消息 |
| 38 | `StopCircle` | 操作 | 停止生成 |
| 39 | `Mic` | 操作 | 语音输入 |
| 40 | `Paperclip` | 操作 | 附件 |
| 41 | `Image` | 媒体 | 图片 |
| 42 | `FileText` | 文件 | 文档 |
| 43 | `Code` | 开发 | 代码 |
| 44 | `Terminal` | 开发 | 终端 |
| 45 | `Globe` | 网络 | 网页搜索 |
| 46 | `Clock` | 时间 | 历史/时间 |
| 47 | `BookMarked` | 内容 | 书签/收藏 |
| 48 | `Star` | 反馈 | 收藏/评分 |
| 49 | `RefreshCw` | 操作 | 刷新/重试 |
| 50 | `ExternalLink` | 导航 | 外部链接 |

---

## 10. 组件规范

### 10.1 Button（按钮）

**描述：** 多功能按钮，支持多种变体、尺寸和加载态。

#### Props

| Prop | Type | Default | 说明 |
|------|------|---------|------|
| `variant` | `'default' \| 'destructive' \| 'outline' \| 'secondary' \| 'ghost' \| 'muted' \| 'link'` | `'default'` | 视觉变体 |
| `size` | `'default' \| 'xs' \| 'sm' \| 'lg' \| 'icon' \| 'icon-xs' \| 'icon-sm' \| 'icon-lg'` | `'default'` | 尺寸 |
| `disabled` | `boolean` | `false` | 禁用 |
| `asChild` | `boolean` | `false` | 使用 Radix Slot 组合 |

#### 变体

| 变体 | 样式 | 用途 |
|------|------|------|
| `default` | `bg-primary text-primary-foreground shadow-sm hover:bg-primary/90` | 主要 CTA |
| `destructive` | `bg-destructive text-destructive-foreground shadow-sm` | 删除等破坏性操作 |
| `outline` | `border border-input bg-background shadow-sm hover:bg-accent` | 次要操作 |
| `secondary` | `bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80` | 替代操作 |
| `ghost` | `hover:bg-accent hover:text-accent-foreground` | 工具栏、导航项 |
| `muted` | `bg-muted text-foreground hover:bg-muted-foreground/10` | 中性填充按钮 |
| `link` | `text-primary underline-offset-4 hover:underline` | 链接样式 |

#### 尺寸

| 尺寸 | 高度 | 水平内边距 | 字号 |
|------|------|-----------|------|
| `xs` | 28px (h-7) | 8px (px-2) | 12px (text-xs) |
| `sm` | 32px (h-8) | 12px (px-3) | 12px (text-xs) |
| `default` | 36px (h-9) | 16px (px-4) | 14px (text-sm) |
| `lg` | 40px (h-10) | 32px (px-8) | 14px (text-sm) |
| `icon` | 36px (h-9 w-9) | — | 图标 16px |
| `icon-xs` | 28px (h-7 w-7) | — | 图标 14px |
| `icon-sm` | 32px (h-8 w-8) | — | 图标 16px |
| `icon-lg` | 40px (h-10 w-10) | — | 图标 20px |

#### 状态

| 状态 | 表现 |
|------|------|
| Default | 变体默认样式 |
| Hover | `hover:bg-{variant}/90` 或 `hover:bg-accent` |
| Active | 无额外样式（默认 CSS） |
| Focus | `focus-visible:ring-1 focus-visible:ring-ring` |
| Disabled | `disabled:pointer-events-none disabled:opacity-50` |
| Loading | 图标替换 + `pointer-events: none` |

### 10.2 Card（卡片）

**描述：** 内容容器，带圆角、边框和轻微阴影。

**结构：** `Card` → `CardHeader` → `CardTitle` + `CardDescription` → `CardContent` → `CardFooter`

**样式：** `rounded-xl border bg-card text-card-foreground shadow-sm`

| 子组件 | 样式 |
|--------|------|
| `CardHeader` | `flex flex-col space-y-1.5 p-6` |
| `CardTitle` | `font-semibold leading-none tracking-tight` |
| `CardDescription` | `text-sm text-muted-foreground` |
| `CardContent` | `p-6 pt-0` |
| `CardFooter` | `flex items-center p-6 pt-0` |

### 10.3 Dialog（对话框）

**描述：** 基于 Radix Dialog 的模态对话框，支持自定义遮罩层和关闭按钮。

**关键样式：**
- 遮罩层：`bg-black/50`（50% 黑色半透明）
- 内容面板：`fixed left-1/2 top-1/2 z-50 ... rounded-lg` 居中定位
- 关闭按钮：`absolute right-4 top-4`，hover 时 `opacity-100`

### 10.4 DropdownMenu（下拉菜单）

**描述：** 基于 Radix DropdownMenu 的完整下拉菜单实现，支持子菜单、复选框、单选组。

**关键样式：**
- `z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 shadow-md`
- 菜单项：`px-2 py-1.5 text-sm rounded-sm focus:bg-accent`

### 10.5 Tabs（标签页）

**描述：** 基于 Radix Tabs 的标签页导航。

**结构：** `Tabs` → `TabsList` → `TabsTrigger` → `TabsContent`

**TabsList 样式：** `inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1`
**TabsTrigger 样式：** `rounded-md px-3 py-1 text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm`

### 10.6 Tooltip（工具提示）

**描述：** 基于 Radix Tooltip 的弹出提示。

**关键样式：** `z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground`

### 10.7 Avatar（头像）

**描述：** 基于 Radix Avatar 的用户头像。

**样式：** `relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full`
**Fallback：** `flex h-full w-full items-center justify-center rounded-full bg-muted`

### 10.8 Textarea（文本域）

**描述：** 多行文本输入框。

**样式：** `flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-ring`

### 10.9 ScrollArea（滚动区域）

**描述：** 基于 Radix ScrollArea 的自定义滚动容器。

**滚动条宽度：** `var(--scrollbar-size)`（macOS: 6px, Windows: 12px, Linux: 12px）

### 10.10 Bubble（气泡） / Message（消息）

**描述：** 对话气泡与消息组件，支持多种变体和对齐方式。

**Bubble 变体：** `default | secondary | muted | tinted | outline | ghost | destructive`
**Message 对齐：** `start`（AI 消息） / `end`（用户消息）

---

## 11. Z-Index 层叠

| 层级 | 值 | 用途 |
|------|-----|------|
| `z-10` | 10 | 浮动按钮、欢迎页覆盖 |
| `z-20` | 20 | TitleBar 标题栏 |
| `z-30` | 30 | macOS 侧边栏工具栏 |
| `z-40` | 40 | Drawer 遮罩层 |
| `z-50` | 50 | Dialog 内容、Drawer 面板、DropdownMenu、Tooltip |

---

## 12. 页面模板

### 12.1 聊天页面（ChatPage）

**布局结构：**

```
┌─────────────────────────────────────────────────────────┐
│ 灰色底色 (bg-sidebar)                                    │
│  ┌──────────┬──────────────────────────────┬──────────┐  │
│  │          │ 白色卡片 (bg-background)      │ 白色卡片  │  │
│  │ 侧边栏   │ ┌────────────────────────┐   │ (可选)    │  │
│  │ (262px)  │ │ ChatHeader             │   │          │  │
│  │          │ │ 标题 + 操作按钮         │   │          │  │
│  │ 灰色     │ ├────────────────────────┤   │          │  │
│  │ bg-sidebar│ │ ChatArea              │   │          │  │
│  │          │ │ 消息列表 + 输入框       │   │          │  │
│  │          │ └────────────────────────┘   │          │  │
│  └──────────┴──────────────────────────────┴──────────┘  │
│  5px 沟渠 (透显灰色底色)                                  │
└─────────────────────────────────────────────────────────┘
```

**状态变体：**

| 状态 | 表现 |
|------|------|
| 欢迎页 | 标题栏隐藏，输入框居中，浮动按钮在左上角 |
| 正常 | ChatHeader 显示标题 + 搜索/分享/历史/右面板按钮 |
| 空会话 | 欢迎页 + 引导提示 |

### 12.2 功能页模板（助理/技能/插件/自动化/更多）

**布局结构：**

```
┌─────────────────────────────────┐
│ ChatHeader                      │
│ 功能页名称（标题）               │
├─────────────────────────────────┤
│                                 │
│  居中：图标 + 标题 + 描述        │
│  (开发中，即将上线)              │
│                                 │
└─────────────────────────────────┘
```

**样式：** 居中布局，图标 `size-10` + `text-muted-foreground/30`，标题 `text-sm font-medium`，副标题 `text-[11px] text-muted-foreground/50`

### 12.3 列表页参考

**布局结构：**

```
┌─────────────────────────────────┐
│ PageHeader: 标题 + 主要操作按钮   │
├─────────────────────────────────┤
│ FilterBar: 搜索 + 筛选 + 日期范围 │
├─────────────────────────────────┤
│ [批量操作栏: 选中行时出现]        │
├─────────────────────────────────┤
│ 数据表格 / 列表                  │
│ 可排序列、行选择、虚拟化          │
├─────────────────────────────────┤
│ 分页: 页码选择器 + 页面导航       │
└─────────────────────────────────┘
```

**参考实现：** 会话列表（ConversationList）使用 `@tanstack/react-virtual` 长列表虚拟化，固定行高 34px，overscan 8 行。

### 12.4 表单页参考

**布局结构：**

```
┌─────────────────────────────────┐
│ 表单标题                         │
├─────────────────────────────────┤
│ ┌─ 表单字段 ──────────────────┐ │
│ │ 标签                         │ │
│ │ [输入框 / 选择器 / 开关]      │ │
│ │ 验证消息（可选）              │ │
│ └──────────────────────────────┘ │
│ ┌─ 表单字段 ──────────────────┐ │
│ │ ...                          │ │
│ └──────────────────────────────┘ │
├─────────────────────────────────┤
│ [取消] [提交] (右对齐)           │
└─────────────────────────────────┘
```

**参考组件：** `Textarea`、`Button`、`Dialog`（确认对话框作为表单提交前的二次确认）

### 12.5 确认对话框模板

**布局结构：**

```
┌──────────────────────────────────┐
│ ⚠ 标题（左对齐）                  │
│                                  │
│ 描述文字（灰色）                  │
│                                  │
│           [取消] [确认删除]       │
└──────────────────────────────────┘
```

**样式：** 12px 圆角，460px 宽度，图标使用 `AlertTriangle` + `text-amber-500`，确认按钮使用 `destructive` 变体。

---

## 13. 平台自适应

### 13.1 平台变量

| 变量 | macOS | Windows | Linux |
|------|-------|---------|-------|
| `--titlebar-h` | 48px | 48px | 48px |
| `--traffic-light-w` | 72px | 0px | 0px |
| `--titlebar-leading` | 0px | 8px | 4px |
| `--radius-control` | 6px | 8px | 6px |
| `--scrollbar-size` | 6px | 12px | 12px |
| `--density` | 0.96 | 1 | 1 |

### 13.2 窗口控制

- **macOS：** 使用系统红绿灯（native traffic lights），TitleBar 仅覆盖侧边栏区域，不覆盖中栏。
- **Windows/Linux：** 自绘窗口控制按钮（最小化/最大化/关闭），TitleBar 全宽覆盖，含应用菜单栏。

### 13.3 布局模式

| 模式 | 触发条件 | 行为 |
|------|---------|------|
| 三栏模式 | 窗口宽度 ≥ 断点 | 侧边栏固定 262px，中栏 + 右栏通过 ResizablePanelGroup 可拖拽调整 |
| 覆盖模式 | 窗口宽度 < 断点 | 中栏全宽，侧边栏/右栏通过 Drawer 抽屉覆盖显示 |

断点：macOS 980px，其他平台 1080px。

---

## 14. 无障碍

### 14.1 对比度

| 元素 | 最小对比度 | 标准 |
|------|-----------|------|
| 正文文字 (< 18px) | 4.5:1 | WCAG 2.1 AA |
| 大文本 (≥ 18px) | 3:1 | WCAG 2.1 AA |
| UI 组件边框 | 3:1 | WCAG 2.1 AA |

### 14.2 聚焦管理

- 所有交互元素使用 `focus-visible:ring-1 focus-visible:ring-ring` 聚焦环
- Radix 组件内置 focus trap（Dialog）和 ARIA 属性
- 键盘导航支持：Tab 顺序、Enter/Space 激活、Escape 关闭

### 14.3 减少动画

使用 `@media (prefers-reduced-motion: reduce)` 查询，当用户偏好减少动画时，禁用所有入场动画。

---

## 15. 变量命名汇总

### 15.1 CSS 自定义属性（完整清单）

```css
:root {
  /* 颜色 */
  --background; --foreground; --card; --card-foreground;
  --popover; --popover-foreground;
  --primary; --primary-foreground;
  --secondary; --secondary-foreground;
  --muted; --muted-foreground;
  --accent; --accent-foreground;
  --destructive; --destructive-foreground;
  --border; --input; --ring;
  --chart-1; --chart-2; --chart-3; --chart-4; --chart-5;
  --sidebar; --sidebar-foreground; --sidebar-primary;
  --sidebar-primary-foreground; --sidebar-accent;
  --sidebar-accent-foreground; --sidebar-border; --sidebar-ring;

  /* 字体 */
  --font-family-sans;

  /* 圆角 */
  --radius; --radius-sm; --radius-md; --radius-lg;
  --radius-xl; --radius-2xl; --radius-3xl; --radius-4xl;

  /* 布局 */
  --titlebar-h; --titlebar-leading; --titlebar-trailing;
  --traffic-light-w; --radius-control; --scrollbar-size; --density;
  --chat-col-max;
}
```

### 15.2 Tailwind 主题扩展

已在 `@theme inline` 中注册所有语义颜色变量，可通过 `bg-background`、`text-foreground`、`border-border` 等直接使用。

---

## 16. 参考来源

- Apple Human Interface Guidelines — 窗口管理、字体层级、内容区域布局参考 `[Research-backed]`
- shadcn/ui (Radix UI) — 组件原语与无障碍模式参考 `[Research-backed]`
- Tailwind CSS 4 — 样式方案与主题系统 `[Data-backed]`
- lucide-react — 图标库标准 `[Data-backed]`
- 8pt Grid System — 间距系统设计参考 `[Research-backed]`
- WCAG 2.1 Level AA — 无障碍对比度标准 `[Research-backed]`