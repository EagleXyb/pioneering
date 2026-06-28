# Marketing 代码现状分析

## 项目概览

- **技术栈**: Next.js 14 (App Router) + React 18 + TypeScript
- **UI 框架**: 纯 CSS（全局样式，无 CSS Modules / styled-components）
- **动画**: CSS + IntersectionObserver（`ScrollAnimationProvider`）
- **部署端口**: 9001
- **项目别名**: `@pioneering/marketing`

## 文件目录结构

```
apps/marketing/
├── package.json                    # 项目配置
├── next.config.js                  # Next.js 配置
├── tsconfig.json                   # TypeScript 配置 (路径别名 @/ → ./src/*)
├── next-env.d.ts
│
├── app/                            # Next.js App Router 页面目录
│   ├── layout.tsx                  # 根布局 (全局 HTML 结构)
│   ├── page.tsx                    # 首页 (唯一页面)
│   └── globals.css                 # 全局样式 (所有 CSS 都在此)
│
├── src/
│   ├── components/
│   │   ├── Header.tsx              # 顶部导航栏
│   │   ├── Hero.tsx                # 首屏 Hero 区
│   │   ├── TrendsSection.tsx       # 六大趋势 (双列卡片)
│   │   ├── DataSection.tsx         # 关键数据 (指标卡片 + 进度条)
│   │   ├── PolarSection.tsx        # 中美欧三极格局
│   │   ├── PredictionsSection.tsx  # 2026 关键预测
│   │   ├── Footer.tsx              # 底部版权信息
│   │   └── ScrollAnimationProvider.tsx  # 滚动动画控制器
│   ├── styles/                     # (空目录)
│   └── hooks/                      # (空目录)
│
├── dist/                           # (旧的 Vite 构建产物, 与本项目无关)
└── .next/                          # Next.js 构建缓存
```

## 路由与 URL 结构

使用 **Next.js App Router**，路由由文件系统决定：

| 路由路径 | 对应文件 | 说明 |
|----------|----------|------|
| `/` | `app/page.tsx` | 唯一页面，首页 |

**这是一个单页应用 (SPA)**，所有内容在一个页面上，通过锚点链接导航。

## 页面布局层次结构

```
RootLayout (app/layout.tsx)
│
├── <html lang="zh-CN">
│   └── <body>
│       └── HomePage (app/page.tsx)
│           │
│           ├── .page 容器 (max-width: 1440px, 居中, 弹性列布局)
│           │
│           ├── <Header />                          ── 粘性顶部导航
│           │   ├── .header (sticky, z-index:100)
│           │   │   ├── .logo → "AI TRENDS"
│           │   │   └── .nav
│           │   │       ├── <a href="#trends">       → 趋势
│           │   │       ├── <a href="#data">         → 数据
│           │   │       ├── <a href="#polar">        → 格局
│           │   │       └── <a href="#predictions">  → 预测
│           │   └── .divider (分隔线)
│           │
│           ├── <ScrollAnimationProvider>
│           │   │
│           │   ├── <Hero />                         ── Section 1: 首屏
│           │   │   ├── .badge (研究机构标签)
│           │   │   ├── .headline → "AI 发展趋势"
│           │   │   ├── .subheadline → "2025-2026 最新趋势分析报告"
│           │   │   ├── .hero-desc (说明文字)
│           │   │   └── .stats-bar (4 个统计数据)
│           │   │       ├── $301B / 全球 AI 支出 / IDC
│           │   │       ├── 72% / 企业 AI 采用率 / McKinsey
│           │   │       ├── 280× / 推理成本降幅 / Stanford HAI
│           │   │       └── 88% / 组织已采用 AI / McKinsey
│           │   │
│           │   ├── <TrendsSection />                 ── Section 2: #trends
│           │   │   ├── .section-title → "六大核心趋势"
│           │   │   ├── .section-subtitle
│           │   │   └── .trends-grid (双列布局)
│           │   │       ├── .trends-col (左列: 01, 02, 03)
│           │   │       │   ├── 01 Agent 化跃迁
│           │   │       │   ├── 02 推理成本崩塌
│           │   │       │   └── 03 多模态融合
│           │   │       └── .trends-col (右列: 04, 05, 06)
│           │   │           ├── 04 端侧智能爆发
│           │   │           ├── 05 垂直行业深耕
│           │   │           └── 06 治理与对齐
│           │   │
│           │   ├── <DataSection />                   ── Section 3: #data
│           │   │   ├── .section-title → "关键数据"
│           │   │   ├── .section-subtitle
│           │   │   └── .metrics-grid (3 列卡片)
│           │   │       ├── 全球 AI 支出 / $301B / 进度条 80%
│           │   │       ├── 企业 AI 采用率 / 72% / 进度条 60%
│           │   │       └── Token 价格年降幅 / 93% / 进度条 28%
│           │   │
│           │   ├── <PolarSection />                  ── Section 4: #polar
│           │   │   ├── .section-title → "中美欧三极格局"
│           │   │   ├── .section-subtitle
│           │   │   └── .polar-grid (3 列卡片)
│           │   │       ├── 🇺🇸 美国 / 38%
│           │   │       ├── 🇨🇳 中国 / 26%
│           │   │       └── 🇪🇺 欧盟 / 18%
│           │   │
│           │   └── <PredictionsSection />            ── Section 5: #predictions
│           │       ├── .section-title → "2026 关键预测"
│           │       ├── .section-subtitle
│           │       └── .pred-grid (纵向列表)
│           │           ├── ① AI Agent 规模化部署 / 高信度 🟢
│           │           ├── ② 推理成本断崖式下降 / 高信度 🟢
│           │           ├── ③ 多模态 AI 全面落地 / 中信度 🟡
│           │           ├── ④ 中美 AI 竞赛白热化 / 中信度 🟡
│           │           └── ⑤ 全球 AI 监管框架成型 / 低信度 🔴
│           │
│           └── <Footer />                            ── 底部
│               ├── .footer-divider
│               ├── "数据来源"
│               ├── 来源列表 (Stanford HAI, McKinsey, a16z, Gartner, IDC)
│               └── 版权声明
```

## 布局关键特征

### 1. 全局布局 (`app/layout.tsx`)
- 字体: Inter (变量 `--font-inter`) + Noto Sans SC (变量 `--font-noto-sans-sc`)
- HTML `lang="zh-CN"`
- 元数据: 标题 "AI 发展趋势 · 2025-2026 最新趋势分析"
- 仅提供 HTML 骨架 + 字体

### 2. 页面容器 (`.page` in `globals.css`)
- `max-width: 1440px`, 水平居中
- `flex-direction: column`, `align-items: center`
- 所有内容纵向排列

### 3. Section 标准化样式 (`.section` in `globals.css`)
- `width: 100%`, `padding: 80px 120px`
- `flex-direction: column`, `align-items: center`, `gap: 48px`
- 标准化的标题 (`.section-title`) 36px 加粗
- 标准化的副标题 (`.section-subtitle`) 16px 灰色

### 4. 粘性导航栏
- 固定高度 72px, 水平 flex 布局
- 左右 padding 48px
- `position: sticky; top: 0; z-index: 100`
- 背景色与页面相同 (纯黑 `#0B0B10`)

### 5. 配色方案 (暗色主题)

| 用途 | 色值 |
|------|------|
| 背景色 | `#0B0B10` (深黑) |
| 卡片色 | `#1E1E23` (深灰) |
| 主文字 | `#F8FAFC` (亮白) |
| 次要文字 | `#94A3B8` (灰蓝) |
| 强调色 | `#5E6AD2` (紫色) |
| 进度条/状态 | 绿色(高)、琥珀色(中)、红色(低) |

### 6. 动画系统
- `ScrollAnimationProvider`: 使用 `IntersectionObserver` 监测滚动
- CSS 类 `animate-fade-up`: 元素初始透明，进入视口后触发 `fadeUp` 动画 (上移 + 淡入)
- 错开延迟: `stagger-1` ~ `stagger-6` (0.1s ~ 0.6s)
- 首屏 Hero 使用 `animate-fade-in` (直接淡入，无需滚动触发)

### 7. 响应式断点

| 断点 | 变化 |
|------|------|
| **1024px** | section padding 缩小、头部字号减小、网格布局变单列 |
| **640px** | 移动端优化，进一步缩小 padding 和字号 |

## 页面汇总

该应用只有 **1 个页面**，包含 **5 个内容区块**：

| 区块 | ID 锚点 | 组件 | 布局方式 |
|------|---------|------|----------|
| Hero | (无) | `Hero.tsx` | 纵向居中，文字居中对齐 |
| 六大核心趋势 | `#trends` | `TrendsSection.tsx` | CSS Grid 双列布局 |
| 关键数据 | `#data` | `DataSection.tsx` | CSS Grid 三列卡片 + 进度条 |
| 中美欧三极格局 | `#polar` | `PolarSection.tsx` | CSS Grid 三列卡片 |
| 2026 关键预测 | `#predictions` | `PredictionsSection.tsx` | 纵向列表，带信度标签 |

## 补充说明

- 无 Python 文件：该项目是纯前端 Next.js 应用。
- 无子页面：纯单页落地页 (landing page)，所有导航为锚点跳转。
- 所有样式集中在 `globals.css` 中。
- `dist/` 目录是旧 Vite 构建产物，与本项目无关。
