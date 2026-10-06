# apps/marketing 深度代码审查报告

- **审查基线**：monorepo `pioneering`，HEAD `4ef2741`（V2.7 分支，工作树对 marketing 干净）；marketing 最近一次改动为 `143f880 fix(marketing): 技术审查 P0/P1 优化与 P3 死代码清理`
- **审查范围**：`git ls-files apps/marketing` 全部 115 个跟踪文件；TS/TSX/JS/CSS 源码约 7,028 行（含 docs 静态原型 CSS）；品牌站 6 页 + /trends 子站 + 数据层 + 样式层 + 构建/部署配置全部逐文件通读
- **实证门禁**：`tsc --noEmit` **0 错误**；`next build` **全绿**，14/14 路由纯静态预渲染，First Load JS 129–134 kB；关键疑点均以构建产物 HTML 或 grep 反查源码复核（详见各条证据）
- **严重度口径**：严重 = 阻断上线或存在实际业务/合规风险；中等 = 缺陷会在迭代中造成伤害或误导用户；轻微 = 打磨项

---

## 第一部分 · 架构与依赖关系

### 1.1 模块划分

应用内部实际并存**两代站点、两套样式体系**：

| 层 | 位置 | 说明 |
|---|---|---|
| 认知品牌站（新） | `app/(site)/*` 6 页 + `components/site/**`（33 个组件）+ `data/site/*.ts` | 纯 SSG 服务器组件为骨架，仅 chrome/表单/动效是 client 组件；样式走自研 `brand.css`（1,229 行，作用域 `.brand-site`） |
| AI Trends 子站（旧） | `app/trends/page.tsx` + `components/*.tsx`（7 个遗留组件）+ `data/{trends,metrics,polar,predictions,stats}.ts` | 初版 marketing 应用整体下沉为 /trends；样式走 Tailwind（`tailwind.config.ts` 深色令牌）+ `globals.css` |
| 原型备份 | `docs/site/*.html` + `assets/style.css` | 品牌站 6 页的 HTML 初稿 1:1 备份，与线上实现**同源双份** |
| SEO/兜底 | `app/{layout,not-found,error,global-error,robots,sitemap,opengraph-image}` | 组织完善 |

### 1.2 与主工程的关系（核心架构发现）

- **与 apps/web、apps/desktop、packages/modu-agent 零联动**：全仓 grep 证实 marketing 内没有任何指向产品入口的链接（无 localhost、无外链、无 app 路由）；反向 web 工程也不引用 marketing。marketing 是纯孤岛静态站。
- **无任何接口调用**：全站无 `fetch/axios/XMLHttpRequest/api` 调用（grep 0 命中），表单全部为前端模拟（见 S1）。
- 依赖经根 workspaces 提升安装（`package.json:7`），与 web 各自持有 react/next/framer-motion 副本，版本独立演进——对静态站可接受，但意味着设计令牌、组件无法与主站复用。

### 1.3 边界问题清单（详见第二部分对应条目）

1. 品牌站「数据层（data/site）承载全部文案」的边界被 `ArticleDetail.tsx` 破坏（正文硬编码在组件内）→ M2。
2. `InsightsList` 用文案字符串做数据 join → M1。
3. 两套样式体系无共享 token（zinc 色阶在 `tailwind.config.ts` 与 `brand.css` 各写一遍），`globals.css` 的全局 `html{bg:#161617}` 深色底也作用于浅色品牌站（回弹区域露黑底，属未明说的耦合）→ L9。
4. 死代码与双源备份：`DecorDiagram.tsx` 零引用（且其 `.img-zone` 类在 brand.css 中根本不存在，grep 0 命中）、`stats.ts:20 heroPillars` 零引用、`docs/site` 整目录双份 → M5。

---

## 第二部分 · 问题逐条清单

## 🔴 严重

### S1 · 全部转化路径是"假提交"，站点与产品之间没有任何通路

- **文件**：`components/site/forms/ContactForm.tsx:6,76`；`NewsletterForm.tsx:5,40`；`TryComposer.tsx:6,43`
- **描述**：三个表单（联系、订阅、体验留言）在校验通过后仅 `setTimeout(700~800ms)` 翻转成功态，不发任何请求、不落任何数据（代码注释自认"一期无后端"）。同时全站 CTA（导航"免费体验"、定价"开始使用"、企业版"索取企业方案"）终点都停留在演示锚点 `#try` / 占位卡上，无任何指向真实产品（apps/web）或注册流程的链接。
- **影响**：作为一个以"获客转化"为唯一目的的品牌站，漏斗在每一层都断裂——线索收集为零，流量无法导入产品。当前形态只能称为视觉原型，不具备上线运营价值。
- **建议**：最低成本方案：三个表单接入 `app/api/*` Route Handler（后端可先转发到邮箱/webhook/CRM），加 honeypot + 频控；`/agent#try` 与定价 CTA 指向真实产品入口（web 注册页）；若一期确无后端，应在发布计划中把此项列为 P0 阻断。

### S2 · ICP 备案号占位 + 隐私政策/用户协议死链，不具备上线合规条件

- **文件**：`components/site/chrome/SiteFooter.tsx:37`（`京ICP备XXXXXXXX号`）；`data/site/site.ts:143-147`（`FOOTER_BOTTOM` 三项 href 均为 `'#'`）
- **描述**：页脚备案号为占位符；隐私政策、用户协议、站点地图三个链接均指向 `#` 死链（全文件 grep `href="#"` 仅此处命中）。站点页面宣称"留下邮箱保存上下文""对话内容默认不用于训练"（`data/site/agent.ts` AGENT_FAQ），却不存在隐私政策文本。
- **影响**：面向中国大陆部署（部署脚本 `run.sh` 明确指向 Ubuntu Server 生产环境）时，无备案号无法通过 ICP 审查；涉及个人信息收集承诺而无隐私政策，违反《个人信息保护法》公示要求。
- **建议**：上线前必须替换真实备案号；补 `/privacy`、`/terms` 路由（Next 静态页即可）；"站点地图"链接改指 `/sitemap.xml`。当前 `'#'` 至少应替换为 disabled 态（同 `CogHeader.tsx:26-28` 的 PDF 占位处理方式，该处做得对）。

### S3 · 大量自认"占位"的业务数据与无出处可核验性的行业数据正在以正式口径发布

- **文件**：`data/site/home.ts:3-4`（注释："占位性质：数字与证言沿用原型稿，上线前需替换为真实内容"）但 `HERO.stats`（12,800 读者/92% 完课率）、`CASE_PROOF`、`TESTIMONIALS` 均以真实口吻渲染在首页；`data/site/insights.ts:23` 最新文章日期 `2026-10-12` 晚于当前日期（2026-10-05，未来日期）；`components/Footer.tsx:23` 宣称"数据更新至 2026 年 6 月"并通篇引用 "Stanford HAI 2026 AI Index / IDC 2026" 等报告的具体数字（`data/{trends,metrics,polar,predictions}.ts`），站内无任何原文链接可溯源。
- **影响**：虚构客户数、完课率、匿名案例结果（"决策返工率下降 34%"）用于商业获客页面构成虚假宣传风险（《广告法》《反不正当竞争法》）；未来日期的文章列表会直接暴露"站是搭的"；/trends 的行业数字若与真实报告不符则损害品牌最核心的"可核验"主张（cases 页 lead 原话："能核验的用数字"）。
- **建议**：发布前逐项替换真实数据或移除；日期类字段改为构建期校验（`date <= today`）；/trends 每个数字附报告原文链接与访问日期。

## 🟠 中等

### M1 · 文章详情链接靠"标题字符串相等"判定，改文案即静默断链

- **文件**：`components/site/sections/insights/InsightsList.tsx:12`
- **描述**：`const hasDetail = a.title === FEATURED_ARTICLE.title`，以中文标题全等做数据 join。`ARTICLES[0]` 与 `FEATURED_ARTICLE` 是两处独立定义，仅靠字符串保持一致。
- **影响**：任何人微调标题（改一个字、调一个空格），featured 卡的锚点跳转静默消失且无类型/构建报错；未来多篇文章时无法扩展。
- **建议**：`ArticleCard` 增加 `id: string`，`FEATURED_ARTICLE.id` 关联判定；或直接把 ARTICLES 与 FEATURED 合并为单一数据源派生。

### M2 · ArticleDetail 正文硬编码在组件内，数据层边界被破坏

- **文件**：`components/site/sections/insights/ArticleDetail.tsx:27-60`
- **描述**：`FEATURED_ARTICLE` 承载 tag/meta/toc/author，但文章正文六段与两个 inline-agent 文案写死在 JSX 里，是全项目唯一不遵循"文案进 data/site"约定的板块组件。
- **影响**：与全站内容分层约定不一致，运营改正文需要改组件代码；TOC 锚点 `#signals/#action` 与组件内 `h3 id` 靠手动同步，改一处漏一处。
- **建议**：正文建模为数据（`blocks: Array<{type:'p'|'h3'|'agent', id?, ...}>`），组件仅做映射渲染。

### M3 · 入场动画在 SSR HTML 中输出内联 `opacity:0`，无 JS/JS 失败环境下内容永久不可见

- **文件**：`components/site/ui/Reveal.tsx:29-36`、`components/animations/fade-up.ts:16-21`、`components/site/ui/MethodLayers.tsx:56-60`
- **描述**：`whileInView/initial` 组件的 SSR 产物带内联隐藏样式——已实证：构建产物 `.next/server/app/index.html` 含多处 `style="opacity:0;transform:translateY(12px)"`，`about.html` 9 处；页面无任何 `<noscript>` 兜底，`brand.css` 也无对应降级规则。
- **影响**：搜索引擎之外禁用 JS 的读者、部分 RSS/预览爬虫、以及 hydration 失败（脚本 404/报错）时，整页多个板块为空白。营销站恰恰是最需要"无 JS 也能读"的界面。
- **建议**：framer-motion 提供 `viewport={{ once: true }}` 之外的 SSR 安全模式：初始样式交给 CSS `@media (prefers-reduced-motion)` 与 `no-js` 类（`<html class="no-js">` + 水合后移除的经典方案），或 Reveal 改用 IntersectionObserver + CSS class（brand.css 本身就有 `.reveal` 体系可复用）。

### M4 · 伪造的实时状态文案与占位定价，误导程度超出"演示"边界

- **文件**：`data/site/agent.ts:75`（`note: '已免注册使用 2 / 3 轮 · 留下邮箱后可保存你的项目上下文'`）；`data/site/agent.ts` AGENT_PRICING（组件注释自认"价格为原型占位"，`AgentPricing.tsx:6`）
- **描述**：静态文案以完成时态向用户播报不存在的配额状态（"已使用 2/3 轮"），任何访客看到的都一样；"¥99/月·开始使用"按钮只锚回 `#try`。FAQ 还承诺"每个关键论断可点开溯源""记住你的项目上下文"等当前完全不存在的能力。
- **影响**：用户按提示理解自己的使用状态并做出"留邮箱"决策，属于对交互状态的虚构；定价页呈现"价格透明"标题下的占位价格有商业误导风险。
- **建议**：配额文案改为无状态表述（"免注册可体验 3 轮"）；定价与能力承诺在真实产品就绪前统一打"即将上线"标（参照 `CogHeader.tsx` disabled 按钮的处理）。

### M5 · 死代码与双源原型积累，仓库出现三份"同一站点"

- **文件**：`components/site/ui/DecorDiagram.tsx`（全仓零引用，且其唯一类名 `.img-zone` 在 brand.css 中无定义，grep 0 命中）；`data/stats.ts:20-25 heroPillars`（零引用）；`docs/site/`（6 个 HTML + style.css，与线上 React 实现内容级重复）；`components/SiteHeader.tsx` 头注释宣称"官网/趋势报告共用"，实际唯一消费者是 `/trends` 的 `Header.tsx`（注释过时）
- **影响**：`docs/site` 原型与实现已分叉（insights.ts 注释显示"6 篇 篇"笔误只改了实现侧），后续以哪份为准没有机制保证；死组件/死数据持续产生维护与审查噪音。上一轮 `143f880` 已做过一轮 P3 死代码清理，本项为残留。
- **建议**：删除 `DecorDiagram.tsx`、`heroPillars`；`docs/site` 移入 git 历史或在 README 声明"冻结快照，不再同步"；修正 SiteHeader 注释。

### M6 · `tsconfig.app.tsbuildinfo` 构建缓存被 git 跟踪

- **文件**：`apps/marketing/tsconfig.app.tsbuildinfo`（`git ls-files` 命中），而 `.gitignore` 已含 `*.tsbuildinfo`——先提交后加 ignore，文件仍在版本库
- **影响**：incremental 编译缓存每次 typecheck 都会产生脏 diff，污染 `git status`，且在 monorepo 多机间造成无意义冲突。
- **建议**：`git rm --cached tsconfig.app.tsbuildinfo`。

### M7 · 质量门禁缺失：lint 命令必然失败、零测试、无 CI 覆盖

- **文件**：`package.json:9`（`"lint": "next lint"`，但无 eslint 依赖、无 `.eslintrc*/eslint.config.*`，`next lint` 在无 TTY 的 CI 中直接失败）；全 app 无任何测试文件；根目录无 `.github/workflows`
- **影响**：tsc 之外该应用没有任何自动化防线；上面 M1（字符串 join）这类问题正是 lint 规则（如 `no-restricted-syntax`）或轻量测试能拦截的。`receiving-code-review` 式复审只能靠人工。
- **建议**：补 eslint 配置（`eslint-config-next` + 现有依赖即可）；对 validation.ts、isActive、sitemap 等纯函数补少量 vitest（根 workspace 已有 vitest 生态）；在 CI 加 `tsc --noEmit && next build`。

### M8 · 站点域名是单点环境变量，未配置时全站 SEO 元数据静默指向占位域名

- **文件**：`data/site/site.ts:12`（`process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cognilab.com'`）
- **描述**：metadataBase、canonical、sitemap.xml、robots.txt、BreadcrumbList JSON-LD 全部消费此值。注释说"预发/正式环境通过 NEXT_PUBLIC_SITE_URL 覆盖"，但仓库内无 `.env.example`、构建脚本（`run.sh --build`）也不校验该变量是否存在。
- **影响**：部署时忘配环境变量，产出的是"canonical 指向一个不存在/未持有的域名 cognilab.com"的完整站点，搜索引擎收录后纠正成本高，属于静默失败。
- **建议**：`next.config.js` 构建期断言（如生产构建缺 `NEXT_PUBLIC_SITE_URL` 则 throw），并提供 `.env.example`。

### M9 · 安全响应头缺少 CSP；JSON-LD 内联未做转义（低概率，规范项）

- **文件**：`next.config.js:3-20`（有 nosniff/XFO/HSTS/Referrer-Policy/Permissions-Policy，唯独无 Content-Security-Policy）；`components/site/ui/Breadcrumb.tsx:39-41`（`dangerouslySetInnerHTML: JSON.stringify(jsonLd)` 未做 `<` → `\u003c` 转义）
- **影响**：无 CSP 意味着一旦未来引入第三方脚本或表单接入后端出现注入点，缺少纵深防御；JSON-LD 数据源目前是站内静态文案，实际风险极低，但 Next 官方建议对 `</script>` 提前截断做转义。
- **建议**：为静态品牌站加一条只读 CSP（`default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'`——inline style 因 framer-motion 难以避免，可评估）；JSON-LD 用 `JSON.stringify(x).replace(/</g,'\\u003c')`。

## 🟡 轻微

### L1 · /trends 缺 canonical 与 OG 细化；品牌站页面标题 SEO 偏弱

- **文件**：`app/trends/page.tsx:20-24`（metadata 无 `alternates.canonical`，构建产物验证 `trends.html` 无 `og:url`/`canonical`）；`app/(site)/page.tsx:13`（首页 title 解析为"首页 | 知境 COGNILAB"，核心关键词"认知/判断力/智能体"未进 title）；`app/sitemap.ts:12-20`（除 /trends 外无 lastModified）
- **建议**：内页 title 用"知境认知陪练智能体｜不替你下判断"式表述；/trends 补 canonical。

### L2 · error / not-found 以相对路径跨进路由组引样式

- **文件**：`app/not-found.tsx:7`、`app/error.tsx:10`（`import './(site)/brand.css'`）
- **影响**：括号目录名硬编码进 app 根文件路径，路由组改名会连坐全局兜底页。建议将 brand.css 提升到 `app/` 级或以别名引用。

### L3 · SiteNav 与 MobileMenu 重复实现 ICONS 映射与 isActive

- **文件**：`components/site/chrome/SiteNav.tsx:40-56` vs `MobileMenu.tsx:33-49`（注释自认"保持同构"）；两处 `isActive` 完全相同
- **建议**：抽 `components/site/chrome/navShared.ts`；注释里"避免循环依赖"的理由不成立（纯数据映射不构成循环）。

### L4 · 演示消息渲染逻辑在 FloatingAgent 与 AgentTry 重复

- **文件**：`components/site/chrome/FloatingAgent.tsx:96-111` vs `sections/agent/AgentTry.tsx:34-49`（同一 DEMO_MESSAGES 的 map 结构逐字复制两份）
- **建议**：抽 `<DemoMessages/>` 组件。

### L5 · 三个表单的 setTimeout 未清理

- **文件**：`ContactForm.tsx:76`、`NewsletterForm.tsx:40`、`TryComposer.tsx:43`
- **影响**：loading 期间切页，定时器仍触发对已卸载组件的 setState（React 18 无警告、无实害，但接真实后端后要改 fetch + AbortSignal，建议现在统一清理模式）。

### L6 · run.sh 部署脚本细节

- **文件**：`run.sh:28-29`（脚本内直接 `sudo npm install -g pm2`，在无交互环境会卡住/失败）；`run.sh:47-52`（固定 `sleep 3` 健康检查，冷启动慢时误报）
- **建议**：pm2 检测失败时给出人工指引而非自动 sudo；健康检查改轮询（如 `until curl …; do sleep 1; done`，带超时）。

### L7 · OG 分享图全站一张且仅英文文案

- **文件**：`app/opengraph-image.tsx:7-9`（注释自认：next/og 内置字体无 CJK，中文会变豆腐块）
- **建议**：自托管一个子集化中文字体（~1MB 内）后为 6 页各生成页面级 og-image，分享卡片转化率对品牌站很重要。

### L8 · MobileCTA 初始态依赖首次滚动

- **文件**：`components/site/chrome/MobileCTA.tsx:15-29`（`show` 初始 false，仅 scroll 事件更新；页面停在首屏不滚动时常驻条永不出现，与"移动端常驻 CTA"的定位存疑）
- **建议**：effect 内先手动执行一次 `onScroll()` 对齐初始状态（SiteNav 的 `scrolled` 就做了，两处行为不一致）。

### L9 · 双样式体系无共享令牌 + 全局深色 html 底作用于浅色品牌站

- **文件**：`tailwind.config.ts:10-35` 与 `app/(site)/brand.css:11-27` 各自定义一套 zinc 色阶；`app/globals.css:12-14`（`html { @apply bg-bg }` → 品牌站浅色页的 overscroll 回弹区/移动端拉伸区露出 #161617 黑底）
- **影响**：均为已意识到的历史分层（注释多处说明避免类名碰撞），但色彩 token 双写已经出现细微分叉风险；黑底回弹对浅色站是可见的视觉瑕疵。
- **建议**：把 `html{bg}` 移入仅 /trends 生效的选择器（如 `body.trends`），色阶收敛为一份 CSS 自定义属性、Tailwind 通过 `rgb(var(--x))` 引用。

### L10 · heroStats 内部口径并存易误读

- **文件**：`data/stats.ts:9-10`（"企业 AI 采用率 72%"与"组织已采用 AI 88%"同屏并列，来源不同未解释差异）；同文件 `heroPillars` 为零引用死数据（并入 M5）
- **建议**：删除或注明统计口径差异。

---

## 第三部分 · 分维度小结

**架构与依赖**：应用自身结构清晰（页面薄壳 → sections → data 三层 + chrome 独立），SSG 产物极小、构建健壮。真正的问题不在代码耦合，而是**边界划成了孤岛**：与主工程 web/desktop 零链接、零共享、零数据回路（S1）；一个部署单元内两代站点、两套样式体系、三份"同一品牌站"（docs 原型、实现、备份注释）（M5/L9）。

**功能完整性**：6 页 + /trends 渲染路径完整，表单四态、空数据分支（starters/options 均判空）、锚点遮挡（scroll-padding-top）等边界处理相当细致。缺口集中在：转化终点全部是演示态（S1）、页脚死链与备案占位（S2）、伪造状态文案（M4）、标题字符串 join 的脆弱链路（M1）。

**性能**：构建实测 First Load 129–134 kB（其中 framer-motion 占大头，静态为主的 /cases /cognition 也全量承担），可接受但有裁剪空间；滚动监听均 passive 且 setState 有 bail-out；portal+inert 弹层实现正确；主要瑕疵是 SSR HTML 内联 opacity:0 的无 JS 可见性（M3）与极光背景 4 个无限动画（已有 reduced-motion 关闭，brand.css:679-680，合格）。

**安全性**：无 API、无用户输入上行、无密钥与 .env 入库（全仓 grep 证实 process.env 仅 site.ts 一处）、安全响应头配置优于多数营销站——整体风险面很小。缺口：无 CSP（M9）、域名占位静默发布（M8）、JSON-LD 未转义（理论项）。未发现 XSS/注入/越权实际可达路径。

**工程质量**：类型纪律好（strict 零错误、判别联合 BrandNavItem、无 any 滥用），注释文化优秀（大量自认边界），可访问性投入显著超出行业平均（焦点管理、inert、aria 全套、reduced-motion）。硬伤是**门禁真空**：lint 命令不可用、零测试、零 CI（M7），以及构建缓存入库（M6）。

---

## 第四部分 · 修复优先级清单

| 优先级 | 项 | 一句话行动 | 量级 |
|---|---|---|---|
| P0（上线阻断） | S1 | 表单接真实 API + CTA 打通产品入口 | 中（需后端配合） |
| P0 | S2 | 真实 ICP 号 + /privacy /terms 页面 | 小 |
| P0 | S3 | 替换占位业务数据 / 修未来日期 / 行业数据补出处 | 小-中（内容侧） |
| P1 | M8 | 构建期强制 NEXT_PUBLIC_SITE_URL + .env.example | 极小 |
| P1 | M4 | 伪造配额文案与占位定价加"即将上线"标注 | 极小 |
| P1 | M3 | Reveal/fadeUp 增加 no-js/reduced-motion 降级 | 小 |
| P1 | M7 | 补 eslint + 纯函数单测 + CI（tsc+build） | 小 |
| P2 | M1 M2 | 文章 id 关联取代标题匹配；ArticleDetail 正文入数据层 | 小 |
| P2 | M5 M6 | 删 DecorDiagram/heroPillars、冻结 docs/site 声明、tsbuildinfo 出库 | 极小 |
| P2 | M9 | CSP 头 + JSON-LD 转义 | 极小 |
| P3 | L1–L10 | SEO 细节、组件去重、脚本健壮性、视觉瑕疵打磨 | 逐项小 |

## 总体结论

apps/marketing 是一个**工程骨架相当健康、但业务闭环为零**的站点：静态渲染、类型、无障碍、安全头、动效降级这些"基本功"完成度显著高于典型营销站；但它目前本质上是"带导航的高保真原型"——三个表单假提交、CTA 无处可去、备案与隐私政策占位、核心业务数据自认虚构，任何一项都会阻断正式上线。代码层面没有发现可利用的安全漏洞或必崩的逻辑错误（tsc/build 全绿），最值得立即动手的除 P0 业务项外，是把"域名环境变量、未来日期、字符串 join"这类静默失败点变成构建期硬报错，并为这个零门禁的应用补上最小 CI。建议按上表 P0→P1 顺序在两周内完成上线前收敛，P2/P3 随下个迭代消化。
