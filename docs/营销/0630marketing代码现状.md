# Marketing 代码现状分析

---

# V1.2 版本代码现状分析

> **说明**：以下为 V1.2 分支的最新代码分析。相比旧版本，目录结构和动画系统发生了较大变化。

## 项目概览

- **技术栈**: Next.js 14 (App Router) + React 18 + TypeScript
- **UI 框架**: Tailwind CSS 3.4（自定义深色主题设计系统）
- **动画**: framer-motion 11.11（滚动触发入场动画）
- **部署端口**: 9001
- **项目别名**: `@pioneering/marketing`

## 文件目录结构

```
apps/marketing/
├── package.json                     # 项目配置
├── next.config.js                   # Next.js 配置（开启严格模式）
├── tsconfig.json                     # TypeScript 配置 (路径别名 @/* → 根目录)
├── tailwind.config.ts               # Tailwind 自定义主题（深色设计系统）
├── postcss.config.mjs               # PostCSS 插件（Tailwind + Autoprefixer）
├── next-env.d.ts
├── .gitignore
│
├── app/                             # Next.js App Router 页面目录
│   ├── layout.tsx                   # 根布局（字体 + OG/Twitter 元数据）
│   ├── page.tsx                     # 首页组装（串联所有 Section 组件）
│   ├── globals.css                  # Tailwind 指令 + 自定义组件类
│   ├── robots.ts                    # SEO robots.txt 生成
│   └── sitemap.ts                   # SEO sitemap.xml 生成
│
├── components/                       # React 组件（从 src/components/ 搬移至根目录）
│   ├── Header.tsx                   # 顶部导航栏（服务端组件）
│   ├── Hero.tsx                     # 首屏 Hero 区（客户端组件，framer-motion）
│   ├── TrendsSection.tsx            # 六大趋势（客户端组件，交错延迟动画）
│   ├── DataSection.tsx              # 关键数据（客户端组件，进度条动画）
│   ├── PolarSection.tsx             # 中美欧三极格局（客户端组件）
│   ├── PredictionsSection.tsx       # 2026 关键预测（客户端组件）
│   ├── Footer.tsx                   # 底部版权信息（服务端组件）
│   └── animations/
│       ├── fade-up.ts               # framer-motion Variants 定义
│       └── stagger-container.tsx    # 通用交错延迟动画容器
│
├── data/                            # 静态数据/内容层
│   ├── stats.ts                     # Hero 区 4 个统计数据
│   ├── trends.ts                    # 6 个趋势（左 3 + 右 3）
│   ├── metrics.ts                   # 3 个关键数据指标（含进度条宽度）
│   ├── polar.ts                     # 中美欧三极数据
│   └── predictions.ts              # 5 条预测（含信度分级）
│
├── lib/
│   └── constants.ts                 # 站点常量（SITE、NAV_ITEMS、DATA_SOURCES）
│
├── src/
│   ├── hooks/                       # (空目录，预留扩展)
│   └── styles/                      # (空目录，预留扩展)
│
├── dist/                            # 旧的构建产物（非 Next.js 输出）
└── .next/                           # Next.js 构建缓存
```

### V1.2 目录结构关键变化

| 变化项 | 旧版本 | V1.2 版本 |
|--------|--------|-----------|
| 组件目录 | `src/components/` | `components/`（提升至根目录） |
| 动画系统 | CSS + IntersectionObserver（`ScrollAnimationProvider`） | framer-motion（`StaggerContainer` + `fade-up`） |
| 数据管理 | 数据内联在组件中 | 独立 `data/` 目录，按模块分离 |
| 常量管理 | 内联或分散 | 集中到 `lib/constants.ts` |
| 样式方案 | 纯 CSS（globals.css 全部样式） | Tailwind CSS + globals.css 自定义类 |
| 配置文件 | 无 Tailwind 配置 | 新增 `tailwind.config.ts`、`postcss.config.mjs` |
| SEO | 无独立文件 | 新增 `robots.ts`、`sitemap.ts` |

## 路由与 URL 结构

使用 **Next.js App Router**，路由由文件系统决定：

| 路由路径 | 对应文件 | 说明 |
|----------|----------|------|
| `/` | `app/page.tsx` | 唯一页面，首页 |
| `/robots.txt` | `app/robots.ts` | SEO 爬虫规则 |
| `/sitemap.xml` | `app/sitemap.ts` | SEO 站点地图 |

**这是一个单页应用 (SPA)**，所有内容在一个页面上，通过锚点链接导航。

## 页面布局层次结构

```
RootLayout (app/layout.tsx)
│
├── <html lang="zh-CN">
│   └── <body className="bg-[#0B0B10] text-[#F8FAFC]">
│       └── HomePage (app/page.tsx)
│           │
│           ├── .page 容器 (max-width: 1440px, 居中)
│           │
│           ├── <Header />                              ── 粘性顶部导航
│           │   ├── Logo → "AI TRENDS"
│           │   └── 导航链接 (NAV_ITEMS from constants.ts)
│           │       ├── <a href="#trends">       → 趋势
│           │       ├── <a href="#data">         → 数据
│           │       ├── <a href="#polar">        → 格局
│           │       └── <a href="#predictions">  → 预测
│           │
│           ├── <Hero />                               ── Section 1: 首屏
│           │   ├── .badge (研究机构标签)
│           │   ├── .headline → "AI 发展趋势"
│           │   ├── .subheadline → "2025-2026 最新趋势分析报告"
│           │   ├── .hero-desc (说明文字)
│           │   └── stats-bar（4 个统计数据，framer-motion 动画）
│           │       ├── $301B / 全球 AI 支出 / IDC
│           │       ├── 72% / 企业 AI 采用率 / McKinsey
│           │       ├── 280× / 推理成本降幅 / Stanford HAI
│           │       └── 88% / 组织已采用 AI / McKinsey
│           │
│           ├── <TrendsSection />                       ── Section 2: #trends
│           │   ├── .section-title → "六大核心趋势"
│           │   ├── .section-subtitle
│           │   └── .trends-grid (双列布局, framer-motion 交错动画)
│           │       ├── 左列（01-03）: Agent化跃迁、推理成本崩塌、多模态融合
│           │       └── 右列（04-06）: 端侧智能爆发、垂直行业深耕、治理与对齐
│           │
│           ├── <DataSection />                         ── Section 3: #data
│           │   ├── .section-title → "关键数据"
│           │   ├── .section-subtitle
│           │   └── .metrics-grid (3 列卡片 + 进度条，framer-motion)
│           │       ├── 全球 AI 支出 / $301B / 进度条 80%
│           │       ├── 企业 AI 采用率 / 72% / 进度条 60%
│           │       └── Token 价格年降幅 / 93% / 进度条 28%
│           │
│           ├── <PolarSection />                        ── Section 4: #polar
│           │   ├── .section-title → "中美欧三极格局"
│           │   ├── .section-subtitle
│           │   └── .polar-grid (3 列卡片，framer-motion)
│           │       ├── 🇺🇸 美国 / 38%
│           │       ├── 🇨🇳 中国 / 26%
│           │       └── 🇪🇺 欧盟 / 18%
│           │
│           ├── <PredictionsSection />                  ── Section 5: #predictions
│           │   ├── .section-title → "2026 关键预测"
│           │   ├── .section-subtitle
│           │   └── .pred-grid (纵向列表，framer-motion)
│           │       ├── ① AI Agent 规模化部署 / 高信度 🟢
│           │       ├── ② 推理成本断崖式下降 / 高信度 🟢
│           │       ├── ③ 多模态 AI 全面落地 / 中信度 🟡
│           │       ├── ④ 中美 AI 竞赛白热化 / 中信度 🟡
│           │       └── ⑤ 全球 AI 监管框架成型 / 低信度 🔴
│           │
│           └── <Footer />                              ── 底部
│               ├── .footer-divider
│               ├── 数据来源列表 (DATA_SOURCES from constants.ts)
│               └── 版权声明
```

## 布局关键特征

### 1. 全局布局 (`app/layout.tsx`)
- 字体：Inter + Noto Sans SC（通过 Google Fonts 加载）
- HTML `lang="zh-CN"`
- 元数据：完整的 OG 和 Twitter Card 标签
- 背景色 `#0B0B10`，文字色 `#F8FAFC`（Tailwind 类）

### 2. 页面容器 (`.page` in `globals.css`)
- `max-width: 1440px`，水平居中
- `flex-direction: column`，`align-items: center`
- 所有内容纵向排列

### 3. Section 标准化样式 (`.section` in `globals.css`)
- `width: 100%`，`padding: 80px 120px`
- `flex-direction: column`，`align-items: center`，`gap: 48px`
- 标准化的标题 (`.section-title`) 36px 加粗
- 标准化的副标题 (`.section-subtitle`) 16px 灰色

### 4. 粘性导航栏
- 固定高度 72px，水平 flex 布局
- `position: sticky; top: 0; z-index: 100`
- 导航项从 `lib/constants.ts` 中的 `NAV_ITEMS` 集中管理

### 5. 配色方案（暗色主题，Tailwind 自定义）

| 用途 | Tailwind 类/色值 |
|------|-------------------|
| 背景色 | `bg-[#0B0B10]` (深黑) |
| 卡片色 | `bg-[#1E1E23]` (深灰) |
| 主文字 | `text-[#F8FAFC]` (亮白) |
| 次要文字 | `text-[#94A3B8]` (灰蓝) |
| 强调色 | `text-[#5E6AD2]` / `border-[#5E6AD2]` (紫蓝) |
| 进度条/状态 | 绿色(高信度)、琥珀色(中信度)、红色(低信度) |

### 6. 动画系统（V1.2 重大变更）

| 对比项 | 旧版本 | V1.2 版本 |
|--------|--------|-----------|
| 动画库 | CSS 自定义动画 | **framer-motion** 11.11 |
| 触发方式 | `IntersectionObserver`（`ScrollAnimationProvider`） | framer-motion `whileInView` |
| 容器组件 | `ScrollAnimationProvider.tsx` | `StaggerContainer` (`stagger-container.tsx`) |
| 动画定义 | 全局 CSS `@keyframes fadeUp` | `fadeUpVariants` (`fade-up.ts`) |
| 错开延迟 | CSS 类 `stagger-1` ~ `stagger-6` | framer-motion `transition.delay` 计算 |
| 无障碍 | 无 | 支持 `prefers-reduced-motion` 媒体查询 |

### 7. 响应式断点

| 断点 | 变化 |
|------|------|
| **1024px** | section padding 缩小、头部字号减小、网格布局变单列 |
| **640px** | 移动端优化，进一步缩小 padding 和字号 |

## 数据层架构

V1.2 将数据从组件中分离到独立的 `data/` 目录，形成清晰的数据层：

```
data/
├── stats.ts          → Hero.tsx           (heroStats: HeroStat[])
├── trends.ts         → TrendsSection.tsx  (leftTrends + rightTrends: Trend[])
├── metrics.ts        → DataSection.tsx    (metrics: Metric[])
├── polar.ts          → PolarSection.tsx   (polars: Polar[])
└── predictions.ts    → PredictionsSection.tsx (predictions: Prediction[])
```

每个数据文件导出类型安全的 TypeScript 接口数组。`lib/constants.ts` 提供跨组件共享的站点级常量（`SITE`、`NAV_ITEMS`、`DATA_SOURCES`）。

## 组件分类

| 组件 | 渲染类型 | 是否使用动画 | 数据来源 |
|------|----------|-------------|----------|
| Header | 服务端组件（Server） | 否 | `lib/constants.ts` → `NAV_ITEMS` |
| Hero | 客户端组件（Client） | framer-motion `whileInView` | `data/stats.ts` |
| TrendsSection | 客户端组件（Client） | framer-motion 交错延迟 | `data/trends.ts` |
| DataSection | 客户端组件（Client） | framer-motion `whileInView` | `data/metrics.ts` |
| PolarSection | 客户端组件（Client） | framer-motion `whileInView` | `data/polar.ts` |
| PredictionsSection | 客户端组件（Client） | framer-motion `whileInView` | `data/predictions.ts` |
| Footer | 服务端组件（Server） | 否 | `lib/constants.ts` → `DATA_SOURCES` |
| StaggerContainer | 客户端组件（Client） | 容器级动画控制 | 无（通用组件） |

## 第三方依赖

**运行时依赖**：

| 包名 | 版本 | 用途 |
|------|------|------|
| next | ^14.2.35 | React 全栈框架 |
| react | ^18.3.1 | UI 库 |
| react-dom | ^18.3.1 | React DOM 渲染 |
| framer-motion | ^11.11.0 | 声明式动画库 |

**开发依赖**：

| 包名 | 版本 | 用途 |
|------|------|------|
| typescript | ^5.6.3 | 类型检查 |
| @types/node | ^20.17.0 | Node.js 类型定义 |
| @types/react | ^18.3.12 | React 类型定义 |
| @types/react-dom | ^18.3.1 | React DOM 类型定义 |
| tailwindcss | ^3.4.19 | CSS 工具框架 |
| postcss | ^8.5.16 | CSS 后处理器 |
| autoprefixer | ^10.5.2 | 自动添加浏览器前缀 |

## 页面汇总

该应用只有 **1 个页面**，包含 **5 个内容区块**：

| 区块 | ID 锚点 | 组件 | 布局方式 | 动画方式 |
|------|---------|------|----------|----------|
| Hero | (无) | `Hero.tsx` | 纵向居中，文字居中对齐 | `motion.div` + `whileInView` |
| 六大核心趋势 | `#trends` | `TrendsSection.tsx` | CSS Grid 双列 + TrendCard 子组件 | `motion.div` + 交错延迟 0.1s |
| 关键数据 | `#data` | `DataSection.tsx` | CSS Grid 三列 + 进度条 | `motion.div` + `whileInView` |
| 中美欧三极格局 | `#polar` | `PolarSection.tsx` | CSS Grid 三列卡片 | `motion.div` + `whileInView` |
| 2026 关键预测 | `#predictions` | `PredictionsSection.tsx` | 纵向列表，带信度徽章 | `motion.div` + `whileInView` |

## 补充说明

- 无 Python 文件：该项目是纯前端 Next.js 应用。
- 无子页面：纯单页落地页 (landing page)，所有导航为锚点跳转。
- 无数据库/API：不包含任何服务端逻辑、API 路由或数据库操作，所有内容均为硬编码静态数据。
- 样式方案：采用 Tailwind CSS 为主，`globals.css` 中定义 Section 标准化类（`.section`、`.section-title` 等）作为补充。
- `src/hooks/` 和 `src/styles/` 为空目录，可能是为后续扩展预留。
- `dist/` 目录是旧版本其他构建工具的产物，与当前 Next.js 项目无关。
- SEO 增强：V1.2 新增 `robots.ts` 和 `sitemap.ts`，提供基础 SEO 支持。
- 数据分离：内容数据从组件中抽取到独立的 `data/` 目录，便于维护和内容更新。
