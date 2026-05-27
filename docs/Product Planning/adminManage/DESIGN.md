# DESIGN.md — 智能体后台管理端设计系统

> 设计系统参考：[TDesign](https://tdesign.tencent.com) 企业级设计系统，完全对齐 [TDesign React Starter Dashboard](https://tdesign.tencent.com/starter/react/dashboard/base) 模板
> 技术栈：React 18+ + TypeScript 5+ + TDesign React（前端） / NestJS（后端） / 前后端分离
> 版本：2.0.0 | 更新日期：2026-05-27

---

## 1. Visual Theme & Atmosphere（视觉主题与氛围）

### 品牌设计哲学

本平台面向 AI 应用开发者与运维团队，提供专业、高效、可信赖的智能体管理体验。设计语言完全对齐 [TDesign React Starter](https://github.com/Tencent/tdesign-react-starter) 的 Dashboard 模板风格——经典的企业级中后台设计。

### 视觉基调

- **专业高效**：TDesign Starter 风格的经典后台布局，适合开发者日常高频操作
- **清晰有序**：侧边导航 + 内容区的经典结构，复杂信息层级通过卡片化分隔清晰呈现
- **克制稳重**：低饱和度配色，避免对开发工作造成视觉干扰

### 核心视觉特征

1. **经典 Starter 布局** — 232px 侧边栏 + 自适应内容区，顶部无 Header（侧边栏即主导航）
2. **卡片化数据展示** — Dashboard 首页采用 Row/Col 网格卡片布局，统计卡片 + 图表卡片 + 表格卡片
3. **高信息密度** — 后台系统特有的紧凑但有序的信息呈现
4. **一致的交互语言** — 完全遵循 TDesign 组件行为模式，降低学习成本

### 光影与质感

- 纯扁平风格，通过 TDesign 官方 `--td-shadow-1/2/3` 营造层级
- 避免毛玻璃等重特效，保证大数据量表格和日志页面的渲染性能
- 边框统一使用 `var(--td-border-level-1-color)`

---

## 2. Color Palette & Roles（调色板与角色）

### Brand Color 品牌色色阶（完整 10 级）

| Token | HEX | 使用场景 |
|-------|-----|----------|
| `--td-brand-color-1` | `#F2F3FF` | 最浅品牌背景 |
| `--td-brand-color-2` | `#D9E1FF` | 悬停背景 |
| `--td-brand-color-3` | `#B5C7FF` | 边框/禁用 |
| `--td-brand-color-4` | `#8EABFF` | 辅助 |
| `--td-brand-color-5` | `#618DFF` | 辅助 |
| `--td-brand-color-6` | `#366EF4` | 悬浮态 |
| `--td-brand-color-7` | `#0052D9` | **主色（默认）** |
| `--td-brand-color-8` | `#003CAB` | 点击态 |
| `--td-brand-color-9` | `#002A7A` | 深色 |
| `--td-brand-color-10` | `#001A57` | 最深 |

### Neutral Gray Scale（中性灰阶 — 完整 14 级）

| Token | HEX | 使用场景 |
|-------|-----|----------|
| `--td-gray-color-1` | `#F3F3F3` | 页面背景、交替行 |
| `--td-gray-color-2` | `#EEEEEE` | 表头背景、分隔 |
| `--td-gray-color-3` | `#E7E7E7` | 一级边框 |
| `--td-gray-color-4` | `#DCDCDC` | 二级边框、占位/禁用边框 |
| `--td-gray-color-5` | `#C5C5C5` | 禁用文字 |
| `--td-gray-color-6` | `#A6A6A6` | 辅助文字 |
| `--td-gray-color-7` | `#8B8B8B` | 次要文字 |
| `--td-gray-color-8` | `#777777` | 文字 |
| `--td-gray-color-9` | `#5E5E5E` | 主要文字 |
| `--td-gray-color-10` | `#4B4B4B` | 标题 |
| `--td-gray-color-11` | `#383838` | 重要标题 |
| `--td-gray-color-12` | `#2C2C2C` | 强调 |
| `--td-gray-color-13` | `#242424` | 强强调 |
| `--td-gray-color-14` | `#181818` | 最深文字 |

### Text Color（文本色）

| Token | 值 | 使用场景 |
|-------|-----|----------|
| `--td-text-color-primary` | `rgba(0,0,0,0.9)` | 主要正文 |
| `--td-text-color-secondary` | `rgba(0,0,0,0.6)` | 次要文字 |
| `--td-text-color-placeholder` | `rgba(0,0,0,0.4)` | 占位符文字 |
| `--td-text-color-disabled` | `rgba(0,0,0,0.26)` | 禁用文字 |
| `--td-text-color-anti` | `#FFFFFF` | 反色文字（深色背景上） |
| `--td-text-color-brand` | `#0052D9` | 品牌色文字 |

### Background Color（背景色）

| Token | 值 | 使用场景 |
|-------|-----|----------|
| `--td-bg-color-page` | `#F5F5F5` | 页面底色 |
| `--td-bg-color-container` | `#FFFFFF` | 卡片、弹窗背景 |
| `--td-bg-color-component` | `#EEEEEE` | 组件背景 |
| `--td-bg-color-component-disabled` | `#EEEEEE` | 禁用组件背景 |
| `--td-bg-color-specialcomponent` | `rgba(0,0,0,0.05)` | 特殊组件（如表头）背景 |

### Border Color（边框色）

| Token | 值 | 使用场景 |
|-------|-----|----------|
| `--td-border-level-1-color` | `#E7E7E7` | 一级边框（卡片、面板） |
| `--td-border-level-2-color` | `#DCDCDC` | 二级边框（输入框、组件边框） |

### Semantic Color（语义色 — 完整色阶）

#### Success（成功 — 绿色系）

| Token | HEX | 使用场景 |
|-------|-----|----------|
| `--td-success-color-1` | `#E8F8F2` | 浅色背景 |
| `--td-success-color-2` | `#BCEBDC` | 悬停背景 |
| `--td-success-color-3` | `#85DBBE` | 边框 |
| `--td-success-color-4` | `#48C79C` | 辅助 |
| `--td-success-color-5` | `#00A870` | **成功主色** |
| `--td-success-color-6` | `#078D5C` | 悬浮 |
| `--td-success-color-7` | `#067945` | 点击 |

#### Warning（警告 — 橙色系）

| Token | HEX | 使用场景 |
|-------|-----|----------|
| `--td-warning-color-1` | `#FDF3E7` | 浅色背景 |
| `--td-warning-color-2` | `#F9D6AB` | 悬停背景 |
| `--td-warning-color-3` | `#F5B76E` | 边框 |
| `--td-warning-color-4` | `#F0982E` | 辅助 |
| `--td-warning-color-5` | `#ED7B2F` | **警告主色** |
| `--td-warning-color-6` | `#D25A00` | 悬浮 |
| `--td-warning-color-7` | `#B84B00` | 点击 |

#### Error（错误 — 红色系）

| Token | HEX | 使用场景 |
|-------|-----|----------|
| `--td-error-color-1` | `#FDECE8` | 浅色背景 |
| `--td-error-color-2` | `#F9C4B8` | 悬停背景 |
| `--td-error-color-3` | `#F59983` | 边框 |
| `--td-error-color-4` | `#ED6B4E` | 辅助 |
| `--td-error-color-5` | `#E34D59` | **错误主色** |
| `--td-error-color-6` | `#C9353F` | 悬浮 |
| `--td-error-color-7` | `#B11F26` | 点击 |

---

## 3. Typography Rules（排版规则）

### Font Family（字体族）

```css
--td-font-family: "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
--td-font-family-medium: "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
```

### Type Scale（完整字体层级表）

#### Link 链接字

| Token | 字号 | 行高 | 使用场景 |
|-------|------|------|----------|
| `--td-font-size-link-small` | 12px | 20px | 小号链接、表格内链接 |
| `--td-font-size-link-medium` | 14px | 22px | 中号链接（默认） |
| `--td-font-size-link-large` | 16px | 24px | 大号链接 |

#### Body 正文字

| Token | 字号 | 行高 | 字重 | 使用场景 |
|-------|------|------|------|----------|
| `--td-font-size-body-small` | 12px | 20px | 400 | 辅助说明、标签、脚注 |
| `--td-font-size-body-medium` | 14px | 22px | 400 | **正文（默认）**、表格内容、表单 |
| `--td-font-size-body-large` | 16px | 24px | 400 | 大段正文 |

#### Title 标题字

| Token | 字号 | 行高 | 字重 | 使用场景 |
|-------|------|------|------|----------|
| `--td-font-size-title-small` | 14px | 22px | 600 | 小标题、表格列头 |
| `--td-font-size-title-medium` | 16px | 24px | 600 | **卡片标题（默认）** |
| `--td-font-size-title-large` | 20px | 28px | 600 | 区块标题、弹窗标题 |

#### Headline 头条字

| Token | 字号 | 行高 | 字重 | 使用场景 |
|-------|------|------|------|----------|
| `--td-font-size-headline-small` | 24px | 32px | 600 | 页面标题 |
| `--td-font-size-headline-medium` | 28px | 36px | 600 | 重要页面标题 |
| `--td-font-size-headline-large` | 36px | 44px | 600 | 主标题 |

#### Display 展示字

| Token | 字号 | 行高 | 字重 | 使用场景 |
|-------|------|------|------|----------|
| `--td-font-size-display-medium` | 48px | 56px | 600 | Dashboard 大数字 |

#### Mark 标记字

| Token | 字号 | 行高 | 使用场景 |
|-------|------|------|----------|
| `--td-font-size-mark-small` | 12px | 20px | 小标记/徽章 |
| `--td-font-size-mark-medium` | 14px | 22px | 中标记/徽章 |

### Font Weight（字重）

| Token | 值 | 使用场景 |
|-------|-----|----------|
| `--td-font-weight-regular` | 400 | 正文、表格内容 |
| `--td-font-weight-medium` | 500 | 按钮、导航、表头 |
| `--td-font-weight-bold` | 600 | 标题、卡片标题 |
| `--td-font-weight-link` | 400 | 链接（默认不加粗） |

### 等宽字体

```css
--td-font-family-mono: "SF Mono", "Menlo", "Monaco", "Consolas", 
                        "Liberation Mono", "Courier New", monospace;
```
使用场景：代码、Token、JSON、日志输出、API 响应。

### 排版设计哲学

- **字重克制**：最大字重 `600`，不使用全粗体（700），避免笨重感
- **层级通过字号区分**：12 → 14 → 16 → 20 → 24 → 28 → 36 → 48，清晰的信息层级
- **后台系统正文基准 14px**：比 C 端产品（16px）小一号，适合高信息密度场景

---

## 4. Component Stylings（组件样式）

### 4.1 Buttons（按钮）

使用 TDesign Button 组件，通过 `variant` 和 `theme` 属性控制样式：

```css
/* TDesign 按钮高度体系：--td-comp-size-m = 36px（默认中号） */

/* Primary（主要按钮） */
.t-button--variant-base.t-button--theme-primary {
  background: var(--td-brand-color-7);           /* #0052D9 */
  color: var(--td-text-color-anti);              /* #FFFFFF */
  border: 1px solid transparent;
  border-radius: var(--td-radius-default);       /* 6px */
  height: var(--td-comp-size-m);                 /* 36px */
  padding: 0 var(--td-comp-paddingLR-l);         /* 0 24px */
  font: var(--td-font-body-medium);              /* 14px/22px */
  font-weight: var(--td-font-weight-medium);     /* 500 */
  transition: all 0.2s var(--td-ease-in-out);
}
/* Primary Hover */
.t-button--variant-base.t-button--theme-primary:hover {
  background: var(--td-brand-color-6);           /* #366EF4 */
}
/* Primary Active */
.t-button--variant-base.t-button--theme-primary:active {
  background: var(--td-brand-color-8);           /* #003CAB */
}
```

#### 按钮变体速查表

| 变体 | 背景 | 文字色 | 边框 | Hover |
|------|------|--------|------|-------|
| Primary | `--td-brand-color-7` | `#FFF` | transparent | `--td-brand-color-6` |
| Default | `--td-bg-color-container` | `--td-text-color-primary` | `--td-border-level-2-color` | `--td-brand-color-7` 边框 |
| Danger | `--td-error-color-5` | `#FFF` | transparent | `--td-error-color-6` |
| Ghost | transparent | `--td-text-color-primary` | transparent | `--td-bg-color-component` |
| Text | transparent | `--td-brand-color-7` | transparent | `--td-brand-color-1` 背景 |

#### 按钮尺寸

| Size | height | padding | 字号 |
|------|--------|---------|------|
| small (`s`) | `--td-comp-size-s` (32px) | 0 16px | 12px |
| medium (`m`) | `--td-comp-size-m` (36px) | 0 24px | 14px |
| large (`l`) | `--td-comp-size-l` (40px) | 0 32px | 14px |

### 4.2 Cards（卡片）

完全对齐 TDesign Card 组件样式：

```css
.t-card {
  background: var(--td-bg-color-container);        /* #FFFFFF */
  border: 1px solid var(--td-border-level-1-color); /* #E7E7E7 */
  border-radius: var(--td-radius-default);          /* 6px */
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl); /* 24px 32px */
}

/* 统计卡片专用（Dashboard 首页） */
.stat-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.stat-card__label {
  font-size: var(--td-font-size-body-medium);       /* 14px */
  color: var(--td-text-color-secondary);            /* rgba(0,0,0,0.6) */
}
.stat-card__value {
  font-size: var(--td-font-size-headline-medium);   /* 28px */
  font-weight: var(--td-font-weight-bold);          /* 600 */
  color: var(--td-text-color-primary);              /* rgba(0,0,0,0.9) */
}
.stat-card__trend {
  font-size: var(--td-font-size-body-small);        /* 12px */
  display: flex;
  align-items: center;
  gap: 4px;
}
```

### 4.3 Tables（表格）

```css
.t-table {
  background: var(--td-bg-color-container);
  border-radius: var(--td-radius-default);          /* 6px */
  font-size: var(--td-font-size-body-medium);       /* 14px */
}
.t-table th {
  background: var(--td-bg-color-specialcomponent); /* rgba(0,0,0,0.05) */
  color: var(--td-text-color-primary);             /* rgba(0,0,0,0.9) */
  font-weight: var(--td-font-weight-bold);         /* 600 */
  height: 48px;
  padding: 0 var(--td-comp-paddingLR-m);           /* 0 16px */
  border-bottom: 1px solid var(--td-border-level-1-color);
}
.t-table td {
  height: 48px;
  padding: 0 var(--td-comp-paddingLR-m);           /* 0 16px */
  color: var(--td-text-color-primary);
  border-bottom: 1px solid var(--td-border-level-1-color);
}
.t-table tr:hover td {
  background: var(--td-bg-color-component);        /* #EEEEEE */
}
```

### 4.4 Inputs（输入框）

```css
.t-input {
  height: var(--td-comp-size-m);                   /* 36px */
  padding: 0 var(--td-comp-paddingLR-s);           /* 0 12px */
  border: 1px solid var(--td-border-level-2-color); /* #DCDCDC */
  border-radius: var(--td-radius-default);          /* 6px */
  font-size: var(--td-font-size-body-medium);       /* 14px */
  line-height: 22px;
  background: var(--td-bg-color-container);
  color: var(--td-text-color-primary);
  transition: border-color 0.2s var(--td-ease-in-out);
}
.t-input:hover {
  border-color: var(--td-brand-color-7);           /* #0052D9 */
}
.t-input:focus,
.t-is-focused {
  border-color: var(--td-brand-color-7);
  box-shadow: 0 0 0 2px var(--td-brand-color-1);  /* #F2F3FF 光晕 */
  outline: none;
}
.t-input::placeholder {
  color: var(--td-text-color-placeholder);         /* rgba(0,0,0,0.4) */
}
```

### 4.5 Navigation / Sidebar（侧边导航）

基于 TDesign Menu 组件 + TDesign Starter 布局：

```css
/* 侧边栏容器 */
.t-layout__sider {
  width: 232px;
  min-height: 100vh;
  background: var(--td-bg-color-container);        /* #FFFFFF */
  border-right: 1px solid var(--td-border-level-1-color);
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 100;
}

/* Logo 区域 */
.sidebar-logo {
  height: 64px;
  display: flex;
  align-items: center;
  padding: 0 var(--td-comp-paddingLR-l);           /* 0 24px */
  border-bottom: 1px solid var(--td-border-level-1-color);
}

/* 菜单项 */
.t-menu__item {
  height: 40px;
  padding: 0 var(--td-comp-paddingLR-m);           /* 0 16px */
  margin: 2px var(--td-comp-margin-s);             /* 2px 12px */
  border-radius: var(--td-radius-default);          /* 6px */
  font-size: var(--td-font-size-body-medium);       /* 14px */
  color: var(--td-text-color-secondary);           /* rgba(0,0,0,0.6) */
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.2s var(--td-ease-in-out);
}
.t-menu__item:hover {
  background: var(--td-bg-color-component);        /* #EEEEEE */
  color: var(--td-text-color-primary);
}
.t-is-active {
  background: var(--td-brand-color-1) !important;  /* #F2F3FF */
  color: var(--td-brand-color-7) !important;        /* #0052D9 */
  font-weight: var(--td-font-weight-medium);        /* 500 */
}

/* 折叠态：64px */
.t-layout__sider--collapsed {
  width: 64px;
}
```

### 4.6 Badges / Tags（标签）

```css
.t-tag {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 var(--td-comp-paddingLR-xs);          /* 0 8px */
  border-radius: var(--td-radius-small);            /* 3px */
  font-size: var(--td-font-size-body-small);        /* 12px */
  line-height: 20px;
  font-weight: var(--td-font-weight-regular);
}
.t-tag--primary {
  background: var(--td-brand-color-1);              /* #F2F3FF */
  color: var(--td-brand-color-7);                   /* #0052D9 */
}
.t-tag--success {
  background: var(--td-success-color-1);            /* #E8F8F2 */
  color: var(--td-success-color-5);                 /* #00A870 */
}
.t-tag--warning {
  background: var(--td-warning-color-1);            /* #FDF3E7 */
  color: var(--td-warning-color-5);                 /* #ED7B2F */
}
.t-tag--danger {
  background: var(--td-error-color-1);              /* #FDECE8 */
  color: var(--td-error-color-5);                   /* #E34D59 */
}
```

### 4.7 Modals / Dialogs（对话框）

```css
/* 背景遮罩 */
.t-dialog__mask {
  background: rgba(0, 0, 0, 0.6);
  position: fixed;
  inset: 0;
}

/* 对话框主体 */
.t-dialog {
  background: var(--td-bg-color-container);
  border-radius: var(--td-radius-large);            /* 12px */
  box-shadow: var(--td-shadow-2);
  padding: var(--td-comp-paddingTB-xxl) var(--td-comp-paddingLR-xxl); /* 32px */
  min-width: 480px;
  max-width: 640px;
}

/* 对话框标题 */
.t-dialog__header {
  font-size: var(--td-font-size-title-large);       /* 20px */
  font-weight: var(--td-font-weight-bold);          /* 600 */
  color: var(--td-text-color-primary);
  margin-bottom: var(--td-comp-margin-l);           /* 24px */
}
```

### 4.8 Breadcrumb & Page Header（面包屑与页面标题）

```css
/* 面包屑 */
.t-breadcrumb {
  font-size: var(--td-font-size-body-medium);       /* 14px */
  color: var(--td-text-color-secondary);
  margin-bottom: var(--td-comp-margin-s);           /* 12px */
}
.t-breadcrumb__separator {
  margin: 0 var(--td-comp-margin-xs);              /* 0 8px */
  color: var(--td-text-color-placeholder);
}

/* 页面标题区 */
.page-header {
  padding-bottom: var(--td-comp-paddingTB-xl);      /* 24px */
  margin-bottom: var(--td-comp-margin-l);           /* 24px */
  border-bottom: 1px solid var(--td-border-level-1-color);
}
.page-header__title {
  font-size: var(--td-font-size-headline-small);    /* 24px */
  font-weight: var(--td-font-weight-bold);          /* 600 */
  color: var(--td-text-color-primary);
}
```

---

## 5. Layout Principles（布局原则）

### Dashboard Starter 整体布局

参照 TDesign React Starter，采用 **侧边导航布局**（Side Navigation Layout）：

```
┌──────────────────────────────────────────────┐
│  Sidebar (232px, fixed)  │  Content (自适应)   │
│                          │                    │
│  ┌─────────────────────┐ │  面包屑导航         │
│  │    Logo (64px)      │ │  页面标题           │
│  ├─────────────────────┤ │  ─────────────────  │
│  │    Menu Item 1      │ │                    │
│  │    Menu Item 2 ●    │ │  卡片区 (Row/Col)   │
│  │    Menu Item 3      │ │  ┌───┐ ┌───┐ ┌───┐ │
│  │    ...              │ │  └───┘ └───┘ └───┘ │
│  │                     │ │                    │
│  │                     │ │  图表/表格区        │
│  │                     │ │  ┌───────────────┐ │
│  │                     │ │  │               │ │
│  │                     │ │  └───────────────┘ │
│  └─────────────────────┘ │                    │
└──────────────────────────────┘
   232px                          剩余宽度
```

### Spacing System（间距系统 — 4px 基数）

#### Padding 体系

| Token | 值 | 使用场景 |
|-------|-----|----------|
| `--td-comp-paddingTB-xxs` | 2px | 极小上下内边距 |
| `--td-comp-paddingTB-xs` | 4px | 微小上下内边距 |
| `--td-comp-paddingTB-s` | 8px | 小上下内边距 |
| `--td-comp-paddingTB-m` | 12px | 中上下内边距 |
| `--td-comp-paddingTB-l` | 16px | 大上下内边距 |
| `--td-comp-paddingTB-xl` | 24px | 特大上下内边距 |
| `--td-comp-paddingTB-xxl` | 32px | 超大上下内边距 |
| `--td-comp-paddingLR-xxs` | 4px | 极小左右内边距 |
| `--td-comp-paddingLR-xs` | 8px | 微小左右内边距 |
| `--td-comp-paddingLR-s` | 12px | 小左右内边距 |
| `--td-comp-paddingLR-m` | 16px | 中左右内边距 |
| `--td-comp-paddingLR-l` | 24px | 大左右内边距 |
| `--td-comp-paddingLR-xl` | 32px | 特大左右内边距 |

#### Margin 体系

| Token | 值 | 使用场景 |
|-------|-----|----------|
| `--td-comp-margin-xxs` | 4px | 极小间距 |
| `--td-comp-margin-xs` | 8px | 微小间距（icon-label gap） |
| `--td-comp-margin-s` | 12px | 小间距（表单项间距） |
| `--td-comp-margin-m` | 16px | 中间距（卡片间距） |
| `--td-comp-margin-l` | 24px | 大间距（区块间距） |
| `--td-comp-margin-xl` | 32px | 特大间距（Section 间距） |
| `--td-comp-margin-xxl` | 40px | 超大间距 |
| `--td-comp-margin-xxxl` | 48px | 极大间距 |

### Grid System / Dashboard 卡片布局

使用 TDesign Row/Col 栅格实现 Dashboard 首页卡片布局：

```css
/* 统计卡片行：4 列等宽 */
.dashboard-stats .t-col { 
  flex: 0 0 25%; 
  max-width: 25%; 
}

/* 图表区：左 67% + 右 33% */
.chart-area-left .t-col { flex: 0 0 66.66%; }
.chart-area-right .t-col { flex: 0 0 33.33%; }
```

### Container（容器）

- 内容区内边距：`--td-comp-paddingLR-xl`（32px）
- 无最大宽度限制，内容区自适应侧边栏剩余空间
- 卡片内边距：`--td-comp-paddingTB-xl` `--td-comp-paddingLR-xl`（24px 32px）

### 留白哲学

作为专业后台系统，采用「紧凑但透气」的留白策略：
- 信息密度高于 C 端产品
- 卡片间距 16px，区块间距 24px，Section 间距 32px
- 表格行高 48px，紧凑但不拥挤

---

## 6. Depth & Elevation（深度与层级）

### Shadow System（阴影系统 — TDesign 官方 3 级）

| Token | box-shadow（完整多层阴影） | 使用场景 |
|-------|---------------------------|----------|
| `--td-shadow-1` | `0 1px 10px rgba(0,0,0,0.05), 0 4px 5px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.12)` | 下拉菜单、Tooltip、Popover |
| `--td-shadow-2` | `0 3px 14px 2px rgba(0,0,0,0.05), 0 8px 10px 1px rgba(0,0,0,0.06), 0 5px 5px -3px rgba(0,0,0,0.1)` | 对话框、Drawer、弹窗 |
| `--td-shadow-3` | `0 6px 30px 5px rgba(0,0,0,0.05), 0 16px 24px 2px rgba(0,0,0,0.04), 0 8px 10px -5px rgba(0,0,0,0.08)` | 全局通知、引导浮层 |

> ⚠️ TDesign 的阴影为多层叠加，不要使用单层简化阴影。

### Surface Layers（表面层级系统）

```
page bg (#F5F5F5)                   ← --td-bg-color-page
  └── container (#FFFFFF)           ← --td-bg-color-container
        ├── card (无额外阴影，仅 1px border)
        └── table (扁平，hover 行变色)
              └── dropdown          ← --td-shadow-1
                    └── dialog      ← --td-shadow-2
                          └── notification ← --td-shadow-3
```

### Z-index Scale

| 层级 | z-index | 对应组件 |
|------|---------|----------|
| Base | 0 | 页面内容 |
| Sidebar | 100 | 固定侧边栏 |
| Sticky Header | 500 | 粘性标题 |
| Dropdown | 1000 | 下拉菜单、Tooltip |
| Popup | 1500 | Popover、弹出卡片 |
| Drawer | 2000 | 抽屉面板 |
| Modal Mask | 2400 | 对话框遮罩 |
| Dialog | 2500 | 对话框 |
| Notification | 3000 | 全局通知 |
| Guide | 3500 | 引导浮层 |

### Border Radius（圆角系统 — 完整 7 级）

| Token | 值 | 使用场景 |
|-------|-----|----------|
| `--td-radius-small` | 3px | 标签（Tag）、徽章（Badge） |
| `--td-radius-default` | 6px | **默认** — 按钮、输入框、卡片 |
| `--td-radius-medium` | 9px | 面板、弹出卡片 |
| `--td-radius-large` | 12px | 对话框（Dialog） |
| `--td-radius-extraLarge` | 24px | 超大圆角 |
| `--td-radius-round` | 999px | 胶囊按钮 |
| `--td-radius-circle` | 50% | 圆形（头像） |

### Transition（过渡动画）

| Token | 值 | 使用场景 |
|-------|-----|----------|
| `--td-ease-in-out` | `cubic-bezier(0.38, 0, 0.24, 1)` | 标准过渡（按钮 hover、输入框 focus） |
| `--td-ease-out` | `cubic-bezier(0, 0, 0.15, 1)` | 元素出现（dropdown 展开） |
| `--td-ease-in` | `cubic-bezier(0.82, 0, 1, 0.9)` | 元素消失（dropdown 收起） |
| `--td-ease-linear` | `cubic-bezier(0, 0, 1, 1)` | 线性过渡（进度条） |

---

## 7. Do's and Don'ts（设计规范与禁忌）

### Do's（推荐实践）

1. **使用 TDesign 官方 CSS 变量** — 所有颜色、字号、间距通过 `var(--td-*)` 引用，不写硬编码值
2. **遵循 TDesign Starter 页面结构** — 页面标题区（面包屑 + 标题）→ 内容区（卡片 Row/Col 布局），保持结构一致性
3. **使用语义化颜色** — 成功/警告/错误使用对应的语义色色阶变量，不混用
4. **所有间距使用 4px 倍数** — 硬编码间距值必须为 4/8/12/16/24/32/40/48 之一
5. **表格提供操作列 + 分页** — 数据表格必须有操作列（宽度 120-200px）和底部分页器
6. **代码/Token/日志使用等宽字体** — 所有技术数据展示使用 `--td-font-family-mono`
7. **表单提供实时校验** — 输入框失焦即校验，而非仅提交时校验
8. **侧边栏菜单使用图标** — 每个一级菜单项必须有 TDesign Icon 图标

### Don'ts（应避免的反模式）

1. **不要硬编码色值** — 禁止使用 `#0052D9` 直接写在样式中，必须用 `var(--td-brand-color-7)`
2. **不要使用 TDesign 阴影系统外的自定义阴影** — 只使用 `--td-shadow-1/2/3`
3. **不要在小屏幕上挤压表格** — 移动端表格应横向滚动或卡片化，而非压缩列宽至不可读
4. **不要使用非标准圆角** — 只使用 `3px / 6px / 9px / 12px / 999px / 50%`
5. **不要省略 Loading/Empty/Error 状态** — 所有数据区必须有三种状态的处理
6. **不要使用全粗体 font-weight: 700** — 最大字重 600
7. **不要在侧边栏使用超过 2 级菜单嵌套** — 保持菜单层级扁平
8. **不要使用过大的图表** — Dashboard 图表卡片高度不超过 400px

---

## 8. Responsive Behavior（响应式行为）

### Breakpoints（断点）

| 断点名 | 宽度范围 | 适配策略 |
|--------|----------|----------|
| 移动端 | < 768px | 侧边栏隐藏（汉堡菜单触发），内容全宽，表格卡片化 |
| 平板 | 768–1024px | 侧边栏可折叠（64px mini 态），内容自适应 |
| 桌面 | > 1024px | 侧边栏固定展开 232px，内容区完整布局 |

### 侧边栏响应式策略

| 断点 | 侧边栏状态 | 触发方式 |
|------|-----------|----------|
| 桌面 (≥1024px) | 展开 232px，默认可见 | — |
| 平板 (768–1023px) | 折叠 64px（mini 态），hover 可展开 | 自动折叠 |
| 移动 (<768px) | 完全隐藏，Drawer 浮层展示 | 汉堡菜单按钮 |

### Touch Targets

- 移动端最小触摸目标：`44px × 44px`
- 菜单项高度：桌面 `40px`，移动端 `48px`
- 按钮最小尺寸：32px（s）、36px（m）、40px（l）

### 表格响应式

| 断点 | 表格策略 |
|------|----------|
| 桌面 (>1024px) | 完整表格，带横向滚动（列多时） |
| 平板 (768–1024px) | 横向滚动 |
| 手机 (<768px) | 卡片化展示（每行数据渲染为一张卡片） |

### Font Scaling

- 正文基准：**桌面/平板/移动端统一 14px**（后台系统不需要缩放）
- 页面标题：桌面 24px，平板 20px，移动端 20px
- 统计大数字：桌面 28px，移动端 24px

### 浏览器兼容性

| 浏览器 | 最低版本 |
|--------|----------|
| Chrome | 90+ |
| Firefox | 88+ |
| Safari | 14+ |
| Edge | 90+ |

---

## 9. Agent Prompt Guide（AI 代理提示指南）

### Quick Reference（快速参考卡）

```
智能体后台管理端 — TDesign React Starter 风格
├── 设计系统: TDesign（腾讯企业级）
├── 布局: 侧边导航（232px sidebar + 自适应 content）
├── 主色: var(--td-brand-color-7) = #0052D9
├── 页面背景: var(--td-bg-color-page) = #F5F5F5
├── 卡片背景: var(--td-bg-color-container) = #FFFFFF
├── 正文字号: var(--td-font-size-body-medium) = 14px/22px
├── 标题字号: var(--td-font-size-title-medium) = 16px/24px
├── 字体: PingFang SC, Microsoft YaHei, Arial, sans-serif
├── 间距基数: 4px
├── 圆角: --td-radius-default = 6px
├── 阴影: --td-shadow-1/2/3 (3 级多层)
├── 前端: React 18+ + TypeScript 5+ + TDesign React
├── 后端: NestJS
└── 架构: 前后端分离 RESTful API
```

### Component Prompts（可直接使用的组件生成 Prompt）

#### Prompt 1: Dashboard 首页
```
生成 TDesign React Starter 风格的 Dashboard 首页。
整体布局：
- 面包屑：首页 > 仪表盘
- 页面标题 "系统概览"
- 第一行：4 个统计卡片（智能体总数、今日调用量、Token 消耗、活跃用户），
  使用 Row gutter={16}，每个 Col span={6}
  卡片内：标签（灰色14px）+ 大数字（28px 粗体）+ 趋势（12px + 箭头图标）
- 第二行：左 2/3 面积图（ECharts）+ 右 1/3 排行榜列表
- 第三行：全宽表格卡片（最近智能体调用记录）
所有卡片使用 TDesign Card 组件包裹。
```

#### Prompt 2: 智能体管理列表页
```
生成智能体管理列表页面。
页面结构：面包屑 + 页面标题 "智能体管理" + 操作栏（搜索框 + 创建按钮）
表格列：名称、描述、状态（Tag：启用绿/禁用灰）、组件数、创建时间、操作（编辑/删除/测试）
使用 TDesign Table，支持服务端分页（pageSize=20），操作列宽度 180px。
顶部搜索框使用 Input + SearchIcon，右侧 "创建智能体" 使用 Primary Button。
```

#### Prompt 3: 工作流编排编辑器
```
生成智能体工作流可视化编排页面。
三栏布局：
- 左侧面板（260px，TDesign Drawer 内）：组件列表（感知/推理/记忆/行动），
  每类一个 Collapse Panel，内为可拖拽的组件项
- 中间画布（flex: 1）：使用 React Flow 渲染节点和连线，
  节点为圆角矩形（6px），品牌色边框
- 右侧面板（320px）：选中节点的属性编辑，使用 TDesign Form + Input/Select/Textarea
底部状态栏显示工作流名称、版本号、保存时间。
```

#### Prompt 4: 知识库管理表格
```
生成知识库管理页面。
页面结构：面包屑 + 标题 "知识库管理" + 操作栏
表格列：名称、类型（标签：文档/FAQ/图谱）、文档数、向量维度、创建时间、状态（启用/索引中/禁用）、操作
使用 TDesign Table，支持列筛选（type、status）、关键词搜索。
操作列：查看详情（Link）、编辑（Button）、删除（Danger Button 带确认弹窗）。
分页使用 TDesign Pagination。
```

#### Prompt 5: Token 消耗统计
```
生成 Token 消耗统计页面，TDesign Starter 风格。
顶部：日期范围选择器（DateRangePicker）+ 智能体筛选（Select）
第一行：3 个统计卡片（总消耗、今日消耗、预估月消耗）
第二行：左侧折线图（30 天消耗趋势）+ 右侧饼图（按智能体分类占比）
第三行：Token 消耗明细表格（日期、智能体、模型、输入Token、输出Token、费用）
使用 TDesign Card 包裹每个区块，ECharts 渲染图表。
```

#### Prompt 6: 系统设置表单页
```
生成系统设置页面。
使用 TDesign Tabs 组件分标签：
- 基本设置：系统名称（Input）、Logo 上传（Upload）、描述（Textarea）
- 模型设置：默认模型（Select）、温度参数（Slider 0-2）、最大 Token（InputNumber）
- 安全设置：API Key 管理（Table + 生成/删除按钮）、IP 白名单（TagInput）、
  请求频率限制（InputNumber）
- 通知设置：邮件通知开关（Switch）、Webhook URL（Input）、
  告警阈值（InputNumber）
每个标签页内容使用 Form 组件，底部固定保存按钮。
```

### Iteration Guide（AI 生成 UI 时的迭代建议）

1. **CSS 变量优先** — 所有样式使用 `var(--td-*)` 引用，绝不硬编码色值/字号/间距
2. **组件优先** — 先查阅 [TDesign React 组件库](https://tdesign.tencent.com/react/components/button)，优先使用现有组件而非自建
3. **Starter 模板对齐** — 页面结构参考 [TDesign Starter](https://github.com/Tencent/tdesign-react-starter) 的目录和组件组织方式
4. **状态全覆盖** — 每个数据区域必须实现 Loading / Empty / Error / Normal 四种状态
5. **TypeScript 严格模式** — 所有组件 Props 使用 interface 定义，不写 any
6. **后端 Mock** — 开发初期使用 MSW 或 json-server mock NestJS API，数据结构与后端接口文档对齐
7. **无障碍** — 表格添加 caption/aria-label，表单 label 与 input 正确关联
8. **代码展示** — Token、日志、JSON 承载在 TDesign Textarea（readonly）内，使用等宽字体
9. **暗色模式预留** — 虽然当前是亮色主题，但通过 CSS 变量引用，后续可无缝切换暗色模式
10. **API 请求统一管理** — 使用 Axios + React Query（TanStack Query）管理所有请求的 loading/caching/error

---

## Appendix A: 技术栈与项目结构

### 前端

```bash
React 18+ / TypeScript 5+ / Vite
TDesign React / tdesign-icons-react
React Router v6 / TanStack Query (React Query)
Axios / ECharts / React Flow (工作流编排)
```

### 后端

```bash
NestJS / TypeScript
TypeORM / Prisma (数据库)
Swagger (API 文档)
JWT + Passport (认证)
```

### 项目目录结构

```
agent-admin-platform/
├── client/                       # 前端（React + TDesign）
│   ├── src/
│   │   ├── assets/              # 静态资源
│   │   ├── components/          # 业务组件
│   │   ├── layouts/             # 布局组件（SidebarLayout）
│   │   ├── pages/               # 页面组件
│   │   │   ├── Dashboard/       # 仪表盘/概览
│   │   │   ├── Agent/           # 智能体管理
│   │   │   ├── Component/       # 组件管理
│   │   │   ├── Workflow/        # 工作流编排
│   │   │   ├── Model/           # 模型管理
│   │   │   ├── Prompt/          # Prompt管理
│   │   │   ├── Knowledge/       # 知识库/知识图谱
│   │   │   ├── Memory/          # 智能体记忆
│   │   │   ├── Data/            # 数据管理
│   │   │   ├── Monitor/         # 监控与日志
│   │   │   ├── Test/            # 测试与评估
│   │   │   ├── Account/         # 账户与计费
│   │   │   ├── User/            # 用户管理
│   │   │   └── Settings/        # 系统设置
│   │   ├── router/              # 路由配置
│   │   ├── services/            # API 请求封装
│   │   ├── hooks/               # 自定义 Hooks
│   │   ├── types/               # TypeScript 类型定义
│   │   ├── styles/              # 全局样式/主题覆盖
│   │   └── utils/               # 工具函数
│   ├── vite.config.ts
│   └── package.json
│
├── server/                       # 后端（NestJS）
│   ├── src/
│   │   ├── modules/
│   │   │   ├── agent/           # 智能体模块
│   │   │   ├── auth/            # 认证模块
│   │   │   ├── user/            # 用户模块
│   │   │   ├── model/           # 模型模块
│   │   │   ├── prompt/          # Prompt模块
│   │   │   ├── knowledge/       # 知识库模块
│   │   │   ├── memory/          # 记忆模块
│   │   │   ├── workflow/        # 工作流模块
│   │   │   ├── monitor/         # 监控模块
│   │   │   ├── billing/         # 计费模块
│   │   │   └── settings/        # 设置模块
│   │   ├── common/              # 公共模块（守卫、拦截器、装饰器）
│   │   └── config/              # 配置
│   └── package.json
│
└── DESIGN.md                     # 本文件
```

---

## Appendix B: CSS 变量快速参考（设计令牌速查表）

```css
/* ===== 品牌色 ===== */
--td-brand-color-1:   #F2F3FF;   /* 最浅 */
--td-brand-color-2:   #D9E1FF;
--td-brand-color-3:   #B5C7FF;
--td-brand-color-4:   #8EABFF;
--td-brand-color-5:   #618DFF;
--td-brand-color-6:   #366EF4;   /* Hover */
--td-brand-color-7:   #0052D9;   /* 主色 DEFAULT */
--td-brand-color-8:   #003CAB;   /* Active */
--td-brand-color-9:   #002A7A;
--td-brand-color-10:  #001A57;   /* 最深 */

/* ===== 文本色 ===== */
--td-text-color-primary:     rgba(0,0,0,0.9);
--td-text-color-secondary:   rgba(0,0,0,0.6);
--td-text-color-placeholder: rgba(0,0,0,0.4);
--td-text-color-disabled:    rgba(0,0,0,0.26);
--td-text-color-anti:        #FFFFFF;
--td-text-color-brand:       #0052D9;

/* ===== 背景色 ===== */
--td-bg-color-page:                 #F5F5F5;
--td-bg-color-container:            #FFFFFF;
--td-bg-color-component:            #EEEEEE;
--td-bg-color-specialcomponent:     rgba(0,0,0,0.05);

/* ===== 边框色 ===== */
--td-border-level-1-color:  #E7E7E7;   /* 卡片/面板 */
--td-border-level-2-color:  #DCDCDC;   /* 输入框/组件 */

/* ===== 字号 ===== */
--td-font-size-body-medium:    14px;   /* 正文默认 */
--td-font-size-body-small:     12px;
--td-font-size-body-large:     16px;
--td-font-size-title-medium:   16px;   /* 卡片标题 */
--td-font-size-title-large:    20px;   /* 弹窗标题 */
--td-font-size-headline-small: 24px;   /* 页面标题 */

/* ===== 间距 ===== */
--td-comp-margin-s:   12px;
--td-comp-margin-m:   16px;
--td-comp-margin-l:   24px;
--td-comp-margin-xl:  32px;
--td-comp-paddingLR-m: 16px;
--td-comp-paddingLR-l: 24px;
--td-comp-paddingLR-xl: 32px;
--td-comp-paddingTB-l: 16px;
--td-comp-paddingTB-xl: 24px;

/* ===== 圆角 ===== */
--td-radius-small:     3px;    /* Tag */
--td-radius-default:   6px;    /* Button, Input, Card */
--td-radius-medium:    9px;    /* Panel */
--td-radius-large:    12px;    /* Dialog */

/* ===== 阴影 ===== */
--td-shadow-1: 0 1px 10px rgba(0,0,0,0.05), 0 4px 5px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.12);
--td-shadow-2: 0 3px 14px 2px rgba(0,0,0,0.05), 0 8px 10px 1px rgba(0,0,0,0.06), 0 5px 5px -3px rgba(0,0,0,0.1);
--td-shadow-3: 0 6px 30px 5px rgba(0,0,0,0.05), 0 16px 24px 2px rgba(0,0,0,0.04), 0 8px 10px -5px rgba(0,0,0,0.08);

/* ===== 过渡 ===== */
--td-ease-in-out: cubic-bezier(0.38, 0, 0.24, 1);
--td-ease-out:    cubic-bezier(0, 0, 0.15, 1);
--td-ease-in:     cubic-bezier(0.82, 0, 1, 0.9);

/* ===== 组件尺寸 ===== */
--td-comp-size-s:  32px;   /* 小按钮 */
--td-comp-size-m:  36px;   /* 中按钮/输入框(默认) */
--td-comp-size-l:  40px;   /* 大按钮 */
--td-comp-size-xl: 48px;
```

---

*本文档完全对齐 [TDesign](https://tdesign.tencent.com) 官方设计令牌体系和 [TDesign React Starter](https://github.com/Tencent/tdesign-react-starter) Dashboard 模板。*
*遵循 [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) 规范，可被 Cursor、Claude Code、Google Stitch 等 AI 编程代理直接消费。*
