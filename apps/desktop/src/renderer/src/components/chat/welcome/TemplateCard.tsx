// ============================================================
// TemplateCard — 单个模板卡片（对齐参考图极简风格）
// ============================================================
// 视觉对齐 TRAE 参考图：
//   - 外层：无阴影，仅 1px 细边框，圆角 ~12px
//   - 上方：4:3 缩略图区域（柔和渐变背景 + 场景化 SVG 图案）
//   - 下方：标题文字（左对齐，小字，1~2 行省略）
//   - hover：边框颜色略加深 + 背景 5% 强调色，不做放大
// ============================================================

import { cn } from '@/lib/utils'
import type { TemplateItem, TemplateScene } from '@/lib/welcome/templates'

interface TemplateCardProps {
  template: TemplateItem
  onSelect?: (prompt: string) => void
}

export function TemplateCard({ template, onSelect }: TemplateCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(template.prompt)}
      className="group flex flex-col gap-2 text-left w-full"
    >
      {/* ===== 缩略图：圆角矩形 + 细边框 + 渐变背景 ===== */}
      <div
        className={cn(
          'relative w-full aspect-[4/3] overflow-hidden rounded-[12px] bg-gradient-to-br',
          template.gradient,
          'ring-1 ring-black/10 dark:ring-white/10',
          'transition-colors duration-200',
          'group-hover:ring-black/20 dark:group-hover:ring-white/20'
        )}
      >
        <SceneThumbnail scene={template.scene} />
      </div>

      {/* ===== 标题：左对齐，单行兜底，过长省略 ===== */}
      <span
        className="text-[13px] font-normal text-foreground/90 leading-5 text-left w-full"
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden'
        }}
      >
        {template.title}
      </span>
    </button>
  )
}

// ============================================================
// SceneThumbnail — 按场景渲染不同的缩略图图案
// 所有图案居中、尺寸自适应容器，风格偏「浅色工作稿」
// ============================================================
function SceneThumbnail({ scene }: { scene: TemplateScene }) {
  const wrapperCls = 'absolute inset-0 flex items-center justify-center p-4'
  const svgBase = 'w-full h-full'
  switch (scene) {
    // —— 案例 1：习惯打卡台历（桌面俯视）——
    case 'habit':
      return (
        <div className={wrapperCls}>
          <svg viewBox="0 0 320 240" className={svgBase} preserveAspectRatio="xMidYMid meet">
            {/* 木纹桌面底色 */}
            <defs>
              <linearGradient id="habit-wood" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#FAF3E4" stopOpacity="0.95" />
                <stop offset="1" stopColor="#EADFC9" stopOpacity="0.95" />
              </linearGradient>
              <linearGradient id="habit-book" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="1" stopColor="#F4EFE5" />
              </linearGradient>
            </defs>
            <rect width="320" height="240" fill="url(#habit-wood)" />
            {/* 书本/台历本体 */}
            <g transform="translate(70 40)">
              <rect width="180" height="160" rx="8" fill="url(#habit-book)" stroke="#E6D9C3" strokeWidth="1" />
              {/* 顶部装订 */}
              <rect x="0" y="0" width="180" height="14" rx="8" fill="#CFA978" opacity="0.85" />
              <rect x="0" y="8" width="180" height="8" fill="#ffffff" />
              {/* 月份标题 */}
              <text x="90" y="40" textAnchor="middle" fontSize="13" fill="#8a7a5c" fontFamily="serif">September</text>
              {/* 星期表头 */}
              <g fill="#b8a683" fontSize="6.5">
                <text x="22"  y="58" textAnchor="middle">一</text>
                <text x="46"  y="58" textAnchor="middle">二</text>
                <text x="70"  y="58" textAnchor="middle">三</text>
                <text x="94"  y="58" textAnchor="middle">四</text>
                <text x="118" y="58" textAnchor="middle">五</text>
                <text x="142" y="58" textAnchor="middle">六</text>
                <text x="166" y="58" textAnchor="middle">日</text>
              </g>
              {/* 日历格子 5×7 */}
              <g stroke="#E6D9C3" strokeWidth="0.6" fill="none">
                {[0,1,2,3,4].map(r =>
                  [0,1,2,3,4,5,6].map(c => (
                    <rect key={`${r}-${c}`} x={14 + c*22} y={66 + r*18} width="18" height="14" rx="2" />
                  ))
                )}
              </g>
              {/* 已完成打卡圆点 */}
              <g fill="#CFA978">
                <circle cx="23" cy="73" r="2.2" />
                <circle cx="47" cy="73" r="2.2" />
                <circle cx="71" cy="73" r="2.2" />
                <circle cx="95" cy="91" r="2.2" />
                <circle cx="119" cy="91" r="2.2" />
                <circle cx="143" cy="109" r="2.2" />
                <circle cx="23"  cy="109" r="2.2" />
              </g>
              {/* 今日方块 */}
              <rect x={14 + 3*22} y={66 + 2*18} width="18" height="14" rx="2" fill="#D98C5F" opacity="0.75" />
              <text x={14 + 3*22 + 9} y={66 + 2*18 + 10} textAnchor="middle" fontSize="7" fill="#ffffff" fontWeight="600">17</text>
            </g>
            {/* 桌面装饰：咖啡杯 */}
            <g transform="translate(30 170)">
              <ellipse cx="26" cy="36" rx="26" ry="4" fill="#000" opacity="0.06" />
              <rect x="8" y="8" width="34" height="26" rx="5" fill="#ffffff" stroke="#E6D9C3" />
              <path d="M42 12 q12 0 12 10 t-12 10" fill="none" stroke="#E6D9C3" strokeWidth="2" />
              <path d="M20 4 q-2 6 0 10 M28 2 q-2 8 0 12 M36 4 q-2 6 0 10" stroke="#C9B996" strokeWidth="1.2" fill="none" opacity="0.7" />
            </g>
            {/* 绿叶 */}
            <g transform="translate(270 180)">
              <path d="M0 0 C-4 -16, 14 -22, 22 -6 C18 6, 4 8, 0 0 Z" fill="#9DB98B" />
            </g>
          </svg>
        </div>
      )

    // —— 案例 2：客户投诉处理流程（极简流程图）——
    case 'flow':
      return (
        <div className={wrapperCls}>
          <svg viewBox="0 0 320 240" className={svgBase} preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="flow-bg" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
                <stop offset="1" stopColor="#F1F1F3" stopOpacity="0.95" />
              </linearGradient>
            </defs>
            <rect width="320" height="240" fill="url(#flow-bg)" />
            {/* 模拟画布外框 */}
            <rect x="18" y="18" width="284" height="204" rx="10" fill="#ffffff" stroke="#E5E6EA" />
            {/* 流程节点 */}
            {[
              { x: 40,  y: 60,  w: 60, h: 30, label: '受理',   color: '#CFE3F5' },
              { x: 130, y: 60,  w: 60, h: 30, label: '记录',   color: '#CFE3F5' },
              { x: 220, y: 60,  w: 60, h: 30, label: '分级',   color: '#CFE3F5' },
              { x: 85,  y: 130, w: 60, h: 30, label: '分派处理', color: '#E3D5F5' },
              { x: 175, y: 130, w: 60, h: 30, label: '客情沟通', color: '#F5DCD5' },
              { x: 130, y: 195, w: 60, h: 30, label: '回访闭环', color: '#D5F5DB' }
            ].map((n, i) => (
              <g key={i}>
                <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="5" fill={n.color} opacity="0.85" stroke="#00000018" />
                <text x={n.x + n.w/2} y={n.y + n.h/2 + 4} textAnchor="middle" fontSize="10" fill="#2d2d2f">{n.label}</text>
              </g>
            ))}
            {/* 箭头 */}
            <g stroke="#BFC2C9" strokeWidth="1.4" fill="none" markerEnd="url(#arr)">
              <line x1="100" y1="75" x2="130" y2="75" />
              <line x1="190" y1="75" x2="220" y2="75" />
              <line x1="70"  y1="90" x2="100" y2="115" />
              <path d="M 160 90 L 160 105 L 115 105 L 115 130" />
              <path d="M 250 90 L 250 105 L 205 105 L 205 130" />
              <path d="M 115 160 L 115 180 L 160 180 L 160 195" />
              <path d="M 205 160 L 205 180 L 190 180 L 190 195" />
            </g>
            <defs>
              <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 8 4 L 0 8 z" fill="#BFC2C9" />
              </marker>
            </defs>
            {/* 判断菱形 */}
            <g transform="translate(160 98)">
              <polygon points="0,-12 16,0 0,12 -16,0" fill="#FFF2CF" stroke="#E9D9A0" />
              <text x="0" y="3" textAnchor="middle" fontSize="7" fill="#7a6c3b">分级判断</text>
            </g>
          </svg>
        </div>
      )

    // —— 案例 3：模型测评（六边形 + 柱状图）——
    case 'benchmark':
      return (
        <div className={wrapperCls}>
          <svg viewBox="0 0 320 240" className={svgBase} preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="bm-bg" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stopColor="#EEF1FB" />
                <stop offset="1" stopColor="#E2E5F4" />
              </linearGradient>
            </defs>
            <rect width="320" height="240" fill="url(#bm-bg)" />
            {/* 左半：六边形雷达 */}
            <g transform="translate(100 120)">
              <polygon points={hexPts(80)}  fill="#ffffff" fillOpacity="0.6" stroke="#C8CCE2" />
              <polygon points={hexPts(60)}  fill="none"              stroke="#C8CCE2" strokeOpacity="0.8" />
              <polygon points={hexPts(40)}  fill="none"              stroke="#C8CCE2" strokeOpacity="0.6" />
              <polygon points={hexPts(20)}  fill="none"              stroke="#C8CCE2" strokeOpacity="0.5" />
              {/* 数据多边形 A */}
              <polygon points={hexPtsData([72, 86, 68, 78, 60, 82])} fill="#7C88D8" fillOpacity="0.55" stroke="#5E6BB7" strokeWidth="1.2" />
              {/* 数据多边形 B */}
              <polygon points={hexPtsData([60, 58, 82, 54, 88, 66])} fill="#D2B6E8" fillOpacity="0.45" stroke="#9A7BC5" strokeWidth="1.2" strokeDasharray="3 2" />
              {/* 轴标签 */}
              <g fontSize="8" fill="#555a75">
                <text x="0"   y="-92" textAnchor="middle">推理</text>
                <text x="82"  y="-44" textAnchor="start">代码</text>
                <text x="82"  y="52"  textAnchor="start">数学</text>
                <text x="0"   y="100" textAnchor="middle">多语言</text>
                <text x="-82" y="52"  textAnchor="end">知识</text>
                <text x="-82" y="-44" textAnchor="end">指令</text>
              </g>
            </g>
            {/* 右半：标题 + 柱状 */}
            <g transform="translate(200 18)">
              <rect x="0" y="0" width="104" height="204" rx="8" fill="#ffffff" fillOpacity="0.85" stroke="#C8CCE2" />
              <text x="12" y="22" fontSize="11" fontWeight="700" fill="#3c4266">顶尖大模型</text>
              <text x="12" y="36" fontSize="11" fontWeight="700" fill="#3c4266">全景测评</text>
              <g fontSize="6" fill="#6a6f8a" transform="translate(12 46)">
                <text x="0" y="0">5.6M open-bench</text>
                <text x="0" y="9">3×12 轮 pairwise</text>
                <text x="0" y="18">36× real-task LLMb</text>
              </g>
              {/* 柱状图 */}
              <g transform="translate(12 96)">
                {[
                  { h: 78, c: '#7C88D8', l: 'Model-A' },
                  { h: 64, c: '#A78CD1', l: 'Model-B' },
                  { h: 52, c: '#C9B9E5', l: 'Model-C' }
                ].map((b, i) => (
                  <g key={i} transform={`translate(${i*30} 0)`}>
                    <rect width="18" height={b.h} x="0" y={88 - b.h} rx="3" fill={b.c} />
                    <text x="9" y="100" textAnchor="middle" fontSize="6" fill="#4a4f68">{b.l}</text>
                  </g>
                ))}
                <line x1="-2" y1="88" x2="92" y2="88" stroke="#C8CCE2" strokeWidth="0.8" />
              </g>
            </g>
          </svg>
        </div>
      )

    // —— 案例 4：基金健康诊断（雷达 + 柱状）——
    case 'portfolio':
      return (
        <div className={wrapperCls}>
          <svg viewBox="0 0 320 240" className={svgBase} preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="pf-bg" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stopColor="#EFF3F8" />
                <stop offset="1" stopColor="#E0E6EF" />
              </linearGradient>
            </defs>
            <rect width="320" height="240" fill="url(#pf-bg)" />
            {/* 左：雷达图 5 维 */}
            <g transform="translate(100 125)">
              {[80, 60, 40, 20].map(r => (
                <polygon key={r} points={radarPts(r, 5)} fill="#ffffff" fillOpacity={r === 80 ? 0.7 : 0} stroke="#BDC7D5" />
              ))}
              {/* 轴 */}
              <g stroke="#BDC7D5" strokeWidth="0.8">
                {radarAxes(80, 5).map(([x,y], i) => (
                  <line key={i} x1="0" y1="0" x2={x} y2={y} />
                ))}
              </g>
              {/* 数据 */}
              <polygon points={radarPtsData([0.8, 0.65, 0.9, 0.55, 0.72], 80, 5)}
                fill="#6E8FB7" fillOpacity="0.55" stroke="#4f719a" strokeWidth="1.2" />
              {/* 标签 */}
              <g fontSize="8" fill="#424c5e">
                <text x="0" y="-90" textAnchor="middle">收益</text>
                <text x="82" y="-28" textAnchor="start">夏普</text>
                <text x="52" y="80"  textAnchor="start">分散度</text>
                <text x="-52" y="80" textAnchor="end">回撤</text>
                <text x="-82" y="-28" textAnchor="end">久期</text>
              </g>
            </g>
            {/* 右：组合柱状 */}
            <g transform="translate(190 30)">
              <rect width="114" height="180" rx="8" fill="#ffffff" fillOpacity="0.9" stroke="#C5CEDB" />
              <text x="14" y="22" fontSize="10" fontWeight="700" fill="#334055">组合诊断</text>
              <g transform="translate(14 40)">
                {/* 柱状：股票/债券/现金/黄金/其他 */}
                {[
                  { l: '股票',  v: 58, c: '#5f7ea4' },
                  { l: '债券',  v: 72, c: '#7893b4' },
                  { l: '现金',  v: 30, c: '#94aac5' },
                  { l: '黄金',  v: 44, c: '#b0c0d4' },
                  { l: '另类',  v: 20, c: '#cdd7e3' }
                ].map((b, i) => (
                  <g key={i} transform={`translate(0 ${i*22})`}>
                    <text x="0" y="9" fontSize="7" fill="#535f74">{b.l}</text>
                    <rect x="30" y="2" width="60" height="10" rx="3" fill="#ECEFF3" />
                    <rect x="30" y="2" width={b.v*0.6} height="10" rx="3" fill={b.c} />
                    <text x="94" y="9" fontSize="6.5" fill="#424c5e">{b.v}%</text>
                  </g>
                ))}
              </g>
              {/* 健康度 */}
              <g transform="translate(14 150)">
                <text x="0" y="0" fontSize="8" fill="#535f74">综合健康度</text>
                <rect x="0" y="6" width="86" height="6" rx="3" fill="#ECEFF3" />
                <rect x="0" y="6" width="66" height="6" rx="3" fill="#78b37b" />
                <text x="92" y="11" fontSize="7" fontWeight="600" fill="#3a7a3e">良好</text>
              </g>
            </g>
          </svg>
        </div>
      )

    // —— 简历 ——
    case 'resume':
      return (
        <div className={wrapperCls}>
          <svg viewBox="0 0 320 240" className={svgBase} preserveAspectRatio="xMidYMid meet">
            <rect width="320" height="240" fill="#F7F8F5" />
            <rect x="30" y="20" width="260" height="200" rx="6" fill="#ffffff" stroke="#E1E5DC" />
            {/* 头像 */}
            <circle cx="68" cy="60" r="22" fill="#CFE0CF" />
            <text x="68" y="64" textAnchor="middle" fontSize="16" fontWeight="600" fill="#6a8a6a">求</text>
            {/* 姓名 + 职位 */}
            <text x="108" y="54" fontSize="13" fontWeight="700" fill="#2c3a2c">求职者 · 高级产品经理</text>
            <text x="108" y="72" fontSize="8" fill="#5a6a5a">5 年经验 · 互联网 SaaS · 上海</text>
            <line x1="108" y1="82" x2="276" y2="82" stroke="#E1E5DC" />
            {/* 工作经历 */}
            <g transform="translate(40 100)" fontSize="7.5" fill="#3b483b">
              <text x="0" y="0" fontWeight="700" fill="#2c3a2c">工作经历</text>
              {['2022.03 — 至今  某科技公司  高级产品经理',
                '2020.05 — 2022.02  某互联网公司  产品经理',
                '2018.07 — 2020.04  某创业公司  产品助理'
              ].map((t, i) => (
                <text key={i} x="4" y={14 + i*12} fill="#4a594a">{t}</text>
              ))}
            </g>
            {/* 项目亮点 */}
            <g transform="translate(40 162)" fontSize="7.5" fill="#3b483b">
              <text x="0" y="0" fontWeight="700" fill="#2c3a2c">项目亮点</text>
              {['主导 XX 平台从 0 到 1，MAU 达 120w',
                '推动效率工具线 NPS 提升 32 分'
              ].map((t, i) => (
                <text key={i} x="4" y={14 + i*12} fill="#4a594a">{t}</text>
              ))}
            </g>
          </svg>
        </div>
      )

    // —— 活动策划（便签 + 照片拼贴）——
    case 'event':
      return (
        <div className={wrapperCls}>
          <svg viewBox="0 0 320 240" className={svgBase} preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="ev-bg" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stopColor="#FBF4EA" />
                <stop offset="1" stopColor="#F0E1CA" />
              </linearGradient>
            </defs>
            <rect width="320" height="240" fill="url(#ev-bg)" />
            {/* 三张照片 */}
            <g transform="translate(38 30) rotate(-3)">
              <rect width="84" height="62" rx="2" fill="#fff" stroke="#D9C8AC" />
              <rect x="4" y="4" width="76" height="48" rx="1" fill="#E8CFA6" />
              <circle cx="30" cy="28" r="10" fill="#fff" opacity="0.4"/>
              <path d="M42 20 l12 14 l8 -8 l20 22 H6 z" fill="#DDB177" />
              <text x="42" y="60" textAnchor="middle" fontSize="5" fill="#8a7a5c">现场布置</text>
            </g>
            <g transform="translate(124 24) rotate(1.2)">
              <rect width="84" height="62" rx="2" fill="#fff" stroke="#D9C8AC" />
              <rect x="4" y="4" width="76" height="48" rx="1" fill="#B7D6C5" />
              <circle cx="40" cy="30" r="16" fill="#fff" opacity="0.3" />
              <rect x="16" y="30" width="52" height="14" rx="2" fill="#8ABAA3" />
              <text x="42" y="60" textAnchor="middle" fontSize="5" fill="#4d6a5a">嘉宾分享</text>
            </g>
            <g transform="translate(210 32) rotate(4)">
              <rect width="84" height="62" rx="2" fill="#fff" stroke="#D9C8AC" />
              <rect x="4" y="4" width="76" height="48" rx="1" fill="#E5B3B3" />
              <circle cx="40" cy="28" r="10" fill="#fff"/>
              <circle cx="40" cy="24" r="4" fill="#F2D2A8"/>
              <path d="M26 42 q14 -16 28 0 z" fill="#F2D2A8"/>
              <text x="42" y="60" textAnchor="middle" fontSize="5" fill="#8a5a5a">社交茶歇</text>
            </g>
            {/* 便签 流程 */}
            <g transform="translate(30 112) rotate(-2)">
              <rect width="120" height="98" rx="3" fill="#FFF7C9" stroke="#F0E4A0" />
              <text x="10" y="16" fontSize="9" fontWeight="700" fill="#7a6b2e">活动流程</text>
              <g fontSize="7" fill="#5a4f22">
                <text x="12" y="34">13:30  签到入场</text>
                <text x="12" y="46">14:00  主题分享</text>
                <text x="12" y="58">15:10  圆桌讨论</text>
                <text x="12" y="70">16:00  茶歇交流</text>
                <text x="12" y="82">17:00  自由 networking</text>
              </g>
            </g>
            {/* 便签 预算 */}
            <g transform="translate(170 118) rotate(2)">
              <rect width="120" height="92" rx="3" fill="#D9ECFA" stroke="#A9CFEB" />
              <text x="10" y="16" fontSize="9" fontWeight="700" fill="#2c5476">预算 & 分工</text>
              <g fontSize="7" fill="#2c5476">
                <text x="12" y="32">场地 40%  物料 20%</text>
                <text x="12" y="44">餐饮 25%  宣传 15%</text>
                <line x1="12" y1="52" x2="108" y2="52" stroke="#9cc2de" />
                <text x="12" y="66">项目统筹 · 小王</text>
                <text x="12" y="78">宣传设计 · 小李 & 小张</text>
              </g>
            </g>
          </svg>
        </div>
      )

    // —— 品牌方案（情绪板）——
    case 'brand':
      return (
        <div className={wrapperCls}>
          <svg viewBox="0 0 320 240" className={svgBase} preserveAspectRatio="xMidYMid meet">
            <rect width="320" height="240" fill="#FBF8FC" />
            <rect x="20" y="20" width="280" height="200" rx="8" fill="#ffffff" stroke="#E8DEF0" />
            {/* Logo/名称 */}
            <g transform="translate(34 36)">
              <rect width="110" height="26" rx="5" fill="#E8DEF0" />
              <text x="55" y="17" textAnchor="middle" fontSize="10" fontWeight="700" fill="#5e447a">BRAND · 品牌名</text>
            </g>
            {/* 色块 */}
            <g transform="translate(34 80)">
              {['#5e447a', '#9a7bc5', '#D5B9E6', '#F1E6F7'].map((c, i) => (
                <g key={i} transform={`translate(${i*36} 0)`}>
                  <rect width="28" height="28" rx="4" fill={c} />
                  <text x="14" y="42" textAnchor="middle" fontSize="5" fill="#4a385e">色{i+1}</text>
                </g>
              ))}
            </g>
            {/* 情绪图 */}
            <g transform="translate(164 34)">
              <rect width="124" height="76" rx="5" fill="#F3E4F5" />
              <circle cx="40" cy="38" r="18" fill="#fff" opacity="0.5" />
              <path d="M70 20 q24 14 0 40 q-24 -14 0 -40 z" fill="#D7B5E2" />
              <circle cx="100" cy="50" r="14" fill="#B593CE" />
            </g>
            {/* 定位文案 */}
            <g transform="translate(34 138)">
              <text x="0" y="0" fontSize="9" fontWeight="700" fill="#3e2c52">核心定位</text>
              <rect x="0" y="10" width="256" height="22" rx="3" fill="#FBF6FC" stroke="#E8DEF0" />
              <text x="8" y="24" fontSize="7" fill="#5e447a">面向 Z 世代的「轻治愈」生活方式品牌 · 主打...</text>
              <text x="0" y="54" fontSize="9" fontWeight="700" fill="#3e2c52">传播关键词</text>
              <g fontSize="7.5" fill="#5e447a">
                {['#治愈', '#松弛感', '#小确幸', '#日常美学'].map((t, i) => (
                  <tspan key={i} x={i*72} y="72">{t}</tspan>
                ))}
              </g>
            </g>
          </svg>
        </div>
      )

    // —— 文章撰写（文档编辑器）——
    case 'article':
      return (
        <div className={wrapperCls}>
          <svg viewBox="0 0 320 240" className={svgBase} preserveAspectRatio="xMidYMid meet">
            <rect width="320" height="240" fill="#FBF7F7" />
            {/* 编辑器窗口 */}
            <rect x="24" y="22" width="272" height="196" rx="6" fill="#ffffff" stroke="#F0DAD9" />
            {/* 窗口交通灯 */}
            <g transform="translate(34 32)">
              <circle cx="0" cy="0" r="4" fill="#F4B3B3" />
              <circle cx="12" cy="0" r="4" fill="#F7DFA0" />
              <circle cx="24" cy="0" r="4" fill="#B7E0B3" />
            </g>
            {/* 工具栏条 */}
            <rect x="34" y="46" width="252" height="14" rx="3" fill="#FBEFEF" />
            {/* 标题 */}
            <text x="34" y="86" fontSize="13" fontWeight="700" fill="#4a2e2e">深度行业观察：AI 时代的</text>
            <text x="34" y="104" fontSize="13" fontWeight="700" fill="#4a2e2e">内容创作如何进化？</text>
            <line x1="34" y1="114" x2="286" y2="114" stroke="#F0DAD9" />
            {/* 正文段落（线条） */}
            <g transform="translate(34 126)" fill="#D9B7B5">
              <rect width="252" height="5" rx="2" />
              <rect y="12"  width="252" height="5" rx="2" />
              <rect y="24"  width="200" height="5" rx="2" />
              <rect y="40"  width="252" height="5" rx="2" />
              <rect y="52"  width="220" height="5" rx="2" />
              {/* 引用块 */}
              <rect x="0" y="66" width="252" height="18" rx="3" fill="#F8E9E8" />
              <rect x="0" y="66" width="2"   height="18" rx="1" fill="#D98985" />
            </g>
          </svg>
        </div>
      )

    // —— 汇报看板 ——
    case 'report':
      return (
        <div className={wrapperCls}>
          <svg viewBox="0 0 320 240" className={svgBase} preserveAspectRatio="xMidYMid meet">
            <rect width="320" height="240" fill="#F3F5F8" />
            <rect x="20" y="20" width="280" height="200" rx="8" fill="#ffffff" stroke="#D9E0EA" />
            {/* 标题 */}
            <text x="34" y="42" fontSize="11" fontWeight="700" fill="#2f3b4d">Q3 业务数据总览</text>
            {/* 四个 KPIs */}
            <g transform="translate(34 56)">
              {[
                { l: '收入',   v: '+32%', c: '#7CA1D8' },
                { l: '用户量', v: '+18%', c: '#8FBB91' },
                { l: '留存',   v: '76%',  c: '#D6B177' },
                { l: 'NPS',    v: '54',   c: '#C88DAE' }
              ].map((k, i) => (
                <g key={i} transform={`translate(${i*64} 0)`}>
                  <rect width="58" height="36" rx="4" fill="#F3F6FA" />
                  <text x="6" y="14" fontSize="7" fill="#68778c">{k.l}</text>
                  <text x="6" y="30" fontSize="13" fontWeight="700" fill={k.c}>{k.v}</text>
                </g>
              ))}
            </g>
            {/* 折线图 */}
            <g transform="translate(34 108)">
              <rect width="168" height="96" rx="4" fill="#F7F9FC" stroke="#E1E7F0" />
              <g stroke="#D0D8E4" strokeWidth="0.6">
                <line x1="10" y1="20"  x2="158" y2="20" />
                <line x1="10" y1="44"  x2="158" y2="44" />
                <line x1="10" y1="68"  x2="158" y2="68" />
              </g>
              <polyline
                fill="none" stroke="#6A91C8" strokeWidth="1.6"
                points="10,70 30,60 50,64 70,42 90,48 110,30 130,34 150,16"
              />
              <g fill="#6A91C8">
                {[[10,70],[30,60],[50,64],[70,42],[90,48],[110,30],[130,34],[150,16]].map(([x,y], i) => (
                  <circle key={i} cx={x} cy={y} r="1.8" />
                ))}
              </g>
              <text x="10" y="90" fontSize="7" fill="#68778c">7月   8月   9月   趋势</text>
            </g>
            {/* 右侧渠道构成 */}
            <g transform="translate(210 108)">
              <rect width="78" height="96" rx="4" fill="#F7F9FC" stroke="#E1E7F0" />
              <text x="8" y="14" fontSize="7.5" fontWeight="700" fill="#2f3b4d">渠道构成</text>
              <g transform="translate(8 24)">
                {/* 甜甜圈 */}
                <circle cx="30" cy="30" r="22" fill="none" stroke="#E1E7F0" strokeWidth="8"/>
                <circle cx="30" cy="30" r="22" fill="none" stroke="#6A91C8" strokeWidth="8"
                  strokeDasharray="60 138" transform="rotate(-90 30 30)"/>
                <circle cx="30" cy="30" r="22" fill="none" stroke="#8FBB91" strokeWidth="8"
                  strokeDasharray="42 138" strokeDashoffset="-60" transform="rotate(-90 30 30)"/>
                <circle cx="30" cy="30" r="22" fill="none" stroke="#D6B177" strokeWidth="8"
                  strokeDasharray="36 138" strokeDashoffset="-102" transform="rotate(-90 30 30)"/>
              </g>
              <g fontSize="5.5" transform="translate(8 76)" fill="#4a5970">
                <text><tspan fill="#6A91C8">■ </tspan>自然 43%</text>
                <text x="40"><tspan fill="#8FBB91">■ </tspan>付费 30%</text>
                <text x="0" y="10"><tspan fill="#D6B177">■ </tspan>推荐 27%</text>
              </g>
            </g>
          </svg>
        </div>
      )

    // —— 路演幻灯片 ——
    case 'pitch':
      return (
        <div className={wrapperCls}>
          <svg viewBox="0 0 320 240" className={svgBase} preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="pt-bg" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stopColor="#FAF1E8" />
                <stop offset="1" stopColor="#F0DDBF" />
              </linearGradient>
            </defs>
            <rect width="320" height="240" fill="url(#pt-bg)" />
            {/* Slide 窗口 */}
            <rect x="30" y="26" width="260" height="188" rx="8" fill="#ffffff" stroke="#E4D0B0" />
            {/* 顶部色条 */}
            <rect x="30" y="26" width="260" height="10" rx="8" fill="#C78C58" />
            <rect x="30" y="32" width="260" height="4" fill="#C78C58" />
            {/* 标题大字 */}
            <text x="52" y="78" fontSize="15" fontWeight="700" fill="#3a2a1a">
              让每个团队都拥有
            </text>
            <text x="52" y="100" fontSize="15" fontWeight="700" fill="#3a2a1a">
              专属的 AI 效率伙伴
            </text>
            <line x1="52" y1="112" x2="120" y2="112" stroke="#C78C58" strokeWidth="2" />
            {/* 三卖点 */}
            <g transform="translate(52 130)" fontSize="8.5" fill="#5a4428">
              <g transform="translate(0 0)">
                <circle cx="6" cy="6" r="6" fill="#F2D9B7"/>
                <text x="6" y="9" textAnchor="middle" fontSize="7" fill="#7a5a34" fontWeight="700">1</text>
                <text x="20" y="10">3 分钟接入 · 开箱即用</text>
              </g>
              <g transform="translate(0 22)">
                <circle cx="6" cy="6" r="6" fill="#F2D9B7"/>
                <text x="6" y="9" textAnchor="middle" fontSize="7" fill="#7a5a34" fontWeight="700">2</text>
                <text x="20" y="10">私有化部署 · 数据安全</text>
              </g>
              <g transform="translate(0 44)">
                <circle cx="6" cy="6" r="6" fill="#F2D9B7"/>
                <text x="6" y="9" textAnchor="middle" fontSize="7" fill="#7a5a34" fontWeight="700">3</text>
                <text x="20" y="10">ROI 提升 · 典型客户 3 倍</text>
              </g>
            </g>
            {/* 右侧 LOGO 块 */}
            <g transform="translate(212 130)">
              <rect width="62" height="62" rx="6" fill="#FAF1E8" stroke="#E4D0B0" />
              <text x="31" y="34" textAnchor="middle" fontSize="18" fontWeight="800" fill="#C78C58">P</text>
              <text x="31" y="50" textAnchor="middle" fontSize="6" fill="#7a5a34">PRODUCT</text>
            </g>
          </svg>
        </div>
      )

    // —— 培训课件 ——
    case 'training':
      return (
        <div className={wrapperCls}>
          <svg viewBox="0 0 320 240" className={svgBase} preserveAspectRatio="xMidYMid meet">
            <rect width="320" height="240" fill="#F2F8F1" />
            <rect x="22" y="20" width="276" height="200" rx="8" fill="#fff" stroke="#CDE0CB" />
            {/* 章节编号 */}
            <g transform="translate(36 36)">
              <rect width="40" height="20" rx="4" fill="#DDEBDC" />
              <text x="20" y="14" textAnchor="middle" fontSize="10" fontWeight="700" fill="#3e5c3c">Ch.03</text>
            </g>
            <text x="36" y="84" fontSize="14" fontWeight="700" fill="#2a4028">新员工入职：</text>
            <text x="36" y="104" fontSize="14" fontWeight="700" fill="#2a4028">业务全景与核心流程</text>
            {/* 章节列表 */}
            <g transform="translate(36 124)" fontSize="8.5" fill="#3e5c3c">
              {[
                '01  公司文化与价值观 · 10 min',
                '02  业务架构与产品矩阵 · 18 min',
                '03  核心流程与协作规范 · 22 min',
                '04  工具与环境配置 · 15 min',
                '05  互动：案例讨论 + 小测 · 20 min'
              ].map((t, i) => (
                <g key={i} transform={`translate(0 ${i*14})`}>
                  <rect width="252" height="11" rx="3" fill={i === 2 ? '#E6F2E5' : '#F5F9F5'} />
                  <text x="8" y="8.5" fill={i === 2 ? '#2a4028' : '#536c51'}>{t}</text>
                </g>
              ))}
            </g>
          </svg>
        </div>
      )

    // —— 数据洞察 ——
    case 'insight':
      return (
        <div className={wrapperCls}>
          <svg viewBox="0 0 320 240" className={svgBase} preserveAspectRatio="xMidYMid meet">
            <rect width="320" height="240" fill="#FBF7EC" />
            <rect x="20" y="20" width="280" height="200" rx="8" fill="#fff" stroke="#E9DDC1" />
            <text x="34" y="42" fontSize="11" fontWeight="700" fill="#5c4a22">销售数据洞察</text>
            {/* 左：双柱状对比 */}
            <g transform="translate(34 56)">
              <rect width="150" height="148" rx="5" fill="#FDF8EC" stroke="#E9DDC1" />
              <g transform="translate(14 20)">
                {/* x 轴基线 */}
                <line x1="0" y1="100" x2="122" y2="100" stroke="#d8cab0" />
                {[0,1,2,3,4,5].map(i => {
                  const h1 = [58, 72, 40, 86, 62, 94][i]
                  const h2 = [50, 60, 52, 70, 68, 80][i]
                  const x = i*20
                  return (
                    <g key={i}>
                      <rect x={x}    y={100 - h1} width="8" height={h1} rx="1.5" fill="#E7B65C" />
                      <rect x={x+9}  y={100 - h2} width="8" height={h2} rx="1.5" fill="#D89A39" />
                      <text x={x+4} y="112" textAnchor="middle" fontSize="5" fill="#78622b">{['1月','2月','3月','4月','5月','6月'][i]}</text>
                    </g>
                  )
                })}
              </g>
              <g transform="translate(14 132)" fontSize="5.5" fill="#78622b">
                <text><tspan fill="#E7B65C">■ </tspan>本期</text>
                <text x="38"><tspan fill="#D89A39">■ </tspan>上期</text>
              </g>
            </g>
            {/* 右：洞察卡片 */}
            <g transform="translate(196 56)" fontSize="7">
              <rect width="92" height="148" rx="5" fill="#FFF7E1" stroke="#E9DDC1" />
              <text x="10" y="14" fontWeight="700" fill="#5c4a22">关键洞察</text>
              <g fill="#6b5528">
                <g transform="translate(10 28)">
                  <circle cx="0" cy="0" r="2.5" fill="#E7B65C"/>
                  <text x="7" y="2.5">4 月同比增速最亮眼</text>
                  <text x="7" y="12" fill="#8a7238">同比 +36%，华东区贡献最大</text>
                </g>
                <g transform="translate(10 64)">
                  <circle cx="0" cy="0" r="2.5" fill="#D89A39"/>
                  <text x="7" y="2.5">华南 A 品类连续下滑</text>
                  <text x="7" y="12" fill="#8a7238">建议开展专项促销与调研</text>
                </g>
                <g transform="translate(10 100)">
                  <circle cx="0" cy="0" r="2.5" fill="#B97C28"/>
                  <text x="7" y="2.5">建议：聚焦 Q3 旺季备货</text>
                </g>
              </g>
            </g>
          </svg>
        </div>
      )

    // —— 预测建模 ——
    case 'forecast':
      return (
        <div className={wrapperCls}>
          <svg viewBox="0 0 320 240" className={svgBase} preserveAspectRatio="xMidYMid meet">
            <rect width="320" height="240" fill="#FAF2F6" />
            <rect x="22" y="20" width="276" height="200" rx="8" fill="#fff" stroke="#E9CFDD" />
            <text x="36" y="42" fontSize="11" fontWeight="700" fill="#5e2c46">销量预测建模方案</text>
            {/* 主图：历史 + 预测折线 */}
            <g transform="translate(36 54)">
              <rect width="248" height="128" rx="4" fill="#FDF5F9" stroke="#E9CFDD" />
              <g stroke="#e4c9d8" strokeWidth="0.6">
                <line x1="14" y1="20"  x2="234" y2="20" />
                <line x1="14" y1="50"  x2="234" y2="50" />
                <line x1="14" y1="80"  x2="234" y2="80" />
                <line x1="14" y1="110" x2="234" y2="110" />
              </g>
              {/* 历史实线 */}
              <polyline fill="none" stroke="#C56E9A" strokeWidth="1.6"
                points="14,90 34,82 54,76 74,84 94,60 114,68 134,46 154,56 164,50" />
              {/* 分割线 */}
              <line x1="164" y1="10" x2="164" y2="118" stroke="#C56E9A" strokeDasharray="2 3" strokeWidth="1" />
              <text x="150" y="8" fontSize="5" fill="#C56E9A">预测起点</text>
              {/* 预测虚线 */}
              <polyline fill="none" stroke="#C56E9A" strokeWidth="1.6" strokeDasharray="4 3"
                points="164,50 184,58 204,42 224,50 234,38" />
              {/* 置信区间 */}
              <polygon
                points="164,40 184,48 204,32 224,40 234,28 234,54 224,60 204,56 184,70 164,62"
                fill="#E89AB8" fillOpacity="0.22" />
              <g fill="#C56E9A">
                {[[14,90],[54,76],[94,60],[134,46],[164,50],[204,42],[234,38]].map(([x,y], i) => (
                  <circle key={i} cx={x} cy={y} r="1.8" />
                ))}
              </g>
            </g>
            {/* 底部标签 */}
            <g transform="translate(36 194)" fontSize="6.5" fill="#6e3d56">
              <text>■ Inputs: 历史销量 / 节假日 / 促销 / 天气</text>
              <text x="0" y="12">■ Metrics: MAPE 5.8% · WAPE 4.2%</text>
            </g>
          </svg>
        </div>
      )

    // —— 技术调研 ——
    case 'tech':
      return (
        <div className={wrapperCls}>
          <svg viewBox="0 0 320 240" className={svgBase} preserveAspectRatio="xMidYMid meet">
            <rect width="320" height="240" fill="#F3F4F9" />
            <rect x="20" y="20" width="280" height="200" rx="8" fill="#fff" stroke="#D3D6EC" />
            <text x="34" y="42" fontSize="11" fontWeight="700" fill="#303763">技术选型调研</text>
            {/* 列头 */}
            <g transform="translate(34 56)" fontSize="7">
              <rect width="256" height="150" rx="4" fill="#F7F8FC" stroke="#D3D6EC" />
              {/* 表头 */}
              <g transform="translate(0 0)">
                <rect width="256" height="22" rx="4" fill="#E9EBF8" />
                <text x="12" y="15" fontWeight="700" fill="#303763">方案</text>
                <text x="90" y="15" textAnchor="middle" fontWeight="700" fill="#303763">性能</text>
                <text x="148" y="15" textAnchor="middle" fontWeight="700" fill="#303763">生态</text>
                <text x="206" y="15" textAnchor="middle" fontWeight="700" fill="#303763">成本</text>
              </g>
              {/* 三行数据 */}
              {[
                { n: '方案 A · Xxx-v2', p: 92, e: 78, c: 65, rec: false },
                { n: '方案 B · Yyy-ng', p: 76, e: 94, c: 88, rec: true },
                { n: '方案 C · ZzzLite', p: 68, e: 60, c: 95, rec: false }
              ].map((r, i) => (
                <g key={i} transform={`translate(0 ${28 + i*38})`}>
                  <text x="12" y="14" fill="#303763" fontWeight={r.rec ? 700 : 500}>{r.n}{r.rec && ' ★推荐'}</text>
                  {[r.p, r.e, r.c].map((v, j) => (
                    <g key={j} transform={`translate(${84 + j*58} 10)`}>
                      <rect width="48" height="8" rx="3" fill="#E2E5F3" />
                      <rect width={v*0.48} height="8" rx="3"
                        fill={v >= 85 ? '#7581CE' : v >= 70 ? '#A2ADE0' : '#C4CBEC'} />
                    </g>
                  ))}
                </g>
              ))}
            </g>
          </svg>
        </div>
      )

    // —— 市场研究 ——
    case 'market':
      return (
        <div className={wrapperCls}>
          <svg viewBox="0 0 320 240" className={svgBase} preserveAspectRatio="xMidYMid meet">
            <rect width="320" height="240" fill="#FBF3EE" />
            <rect x="22" y="20" width="276" height="200" rx="8" fill="#fff" stroke="#EAD1C0" />
            <text x="36" y="42" fontSize="11" fontWeight="700" fill="#633b26">智能眼镜行业全景</text>
            {/* 市场规模堆叠面积 */}
            <g transform="translate(36 54)">
              <rect width="170" height="130" rx="4" fill="#FDF6F0" stroke="#EAD1C0" />
              <g transform="translate(14 14)">
                <polygon
                  points="0,100 24,88 48,78 72,64 96,50 120,38 144,26 144,102 0,102"
                  fill="#E9C6AE" fillOpacity="0.65" />
                <polygon
                  points="0,100 24,96 48,92 72,84 96,76 120,66 144,58 144,102 0,102"
                  fill="#D9A37F" fillOpacity="0.55" />
                <polyline
                  points="0,100 24,88 48,78 72,64 96,50 120,38 144,26"
                  fill="none" stroke="#B67349" strokeWidth="1.5" />
                <polyline
                  points="0,100 24,96 48,92 72,84 96,76 120,66 144,58"
                  fill="none" stroke="#8f562f" strokeWidth="1.2" strokeDasharray="3 2" />
                <g fontSize="5.5" fill="#633b26">
                  <text x="0"   y="116">2023</text>
                  <text x="120" y="116">2027E</text>
                  <text x="80" y="8">2023—2027E CAGR ≈ 47%</text>
                </g>
              </g>
            </g>
            {/* 右侧竞争格局 */}
            <g transform="translate(216 54)" fontSize="6.5" fill="#633b26">
              <rect width="74" height="130" rx="4" fill="#FDF6F0" stroke="#EAD1C0" />
              <text x="8" y="12" fontWeight="700">竞争格局</text>
              {[
                { n: '国际大厂', v: 90, c: '#C08060' },
                { n: '国内头部', v: 72, c: '#D9A37F' },
                { n: '垂直新锐', v: 48, c: '#E9C6AE' },
                { n: '配件方案', v: 28, c: '#F2DFCD' }
              ].map((r, i) => (
                <g key={i} transform={`translate(8 ${26 + i*24})`}>
                  <text y="4">{r.n}</text>
                  <rect x="0" y="10" width="58" height="6" rx="2" fill="#F5E6DA" />
                  <rect x="0" y="10" width={r.v*0.58} height="6" rx="2" fill={r.c} />
                </g>
              ))}
            </g>
          </svg>
        </div>
      )

    // —— 学术综述 ——
    case 'academic':
    default:
      return (
        <div className={wrapperCls}>
          <svg viewBox="0 0 320 240" className={svgBase} preserveAspectRatio="xMidYMid meet">
            <rect width="320" height="240" fill="#F2F8F1" />
            <rect x="22" y="20" width="276" height="200" rx="8" fill="#fff" stroke="#CCE0CC" />
            {/* 论文卡片堆叠 */}
            <g transform="translate(36 40)">
              {/* 背景论文 1 */}
              <g transform="translate(6 6) rotate(2)">
                <rect width="200" height="136" rx="4" fill="#F3F8F3" stroke="#CCE0CC" />
                <text x="12" y="20" fontSize="8" fill="#445c44" fontWeight="600">[NeurIPS 2024] Multimodal...</text>
                <rect x="12" y="28" width="176" height="3" rx="1.5" fill="#D8E8D8" />
                <rect x="12" y="36" width="160" height="3" rx="1.5" fill="#D8E8D8" />
                <rect x="12" y="44" width="140" height="3" rx="1.5" fill="#D8E8D8" />
              </g>
              {/* 背景论文 2 */}
              <g transform="translate(-4 2) rotate(-3)">
                <rect width="200" height="136" rx="4" fill="#EFF6EF" stroke="#CCE0CC" />
                <text x="12" y="20" fontSize="8" fill="#445c44" fontWeight="600">[ICML 2024] Scaling Laws ...</text>
                <rect x="12" y="28" width="180" height="3" rx="1.5" fill="#D8E8D8" />
                <rect x="12" y="36" width="156" height="3" rx="1.5" fill="#D8E8D8" />
                <rect x="12" y="44" width="132" height="3" rx="1.5" fill="#D8E8D8" />
              </g>
              {/* 最上面主论文 */}
              <g>
                <rect width="200" height="136" rx="4" fill="#fff" stroke="#A9C9AA" />
                <text x="12" y="20" fontSize="9" fill="#2c442c" fontWeight="700">[ACL 2025] 多模态大模型综述</text>
                {/* 作者 */}
                <g fontSize="6" fill="#688168">
                  <text x="12" y="34">X. Wang, Y. Zhang, L. Chen ...  清华大学 · 北大</text>
                </g>
                <line x1="12" y1="42" x2="188" y2="42" stroke="#A9C9AA" strokeWidth="0.6" />
                {/* 摘要占位 */}
                <g transform="translate(12 52)" fill="#C3D5C3">
                  <rect width="176" height="3" rx="1.5" />
                  <rect y="7"   width="176" height="3" rx="1.5" />
                  <rect y="14"  width="160" height="3" rx="1.5" />
                  <rect y="21"  width="168" height="3" rx="1.5" />
                  <rect y="28"  width="148" height="3" rx="1.5" />
                </g>
                {/* 标签 */}
                <g transform="translate(12 96)" fontSize="6" fill="#3d553d">
                  <rect x="0"  y="0" width="54" height="14" rx="3" fill="#E3EFDC" />
                  <text x="6" y="9.5">survey · 89 refs</text>
                  <rect x="60" y="0" width="64" height="14" rx="3" fill="#E3EFDC" />
                  <text x="66" y="9.5">multimodal · LMM</text>
                </g>
              </g>
            </g>
            {/* 底部：发展脉络时间轴 */}
            <g transform="translate(36 188)" stroke="#8AB18B" strokeWidth="1" fill="none">
              <line x1="0" y1="6" x2="252" y2="6" />
              {[0, 60, 120, 180, 252].map((x, i) => (
                <g key={i}>
                  <circle cx={x} cy="6" r="2.5" fill="#8AB18B" />
                  <text x={x} y="20" fontSize="5.5" textAnchor={i === 4 ? 'end' : 'start'} fill="#3d553d" stroke="none">
                    {['2020 DALL·E','2022 Gato','2023 GPT-4V','2024 Gemini','2025 统一多模态'][i]}
                  </text>
                </g>
              ))}
            </g>
          </svg>
        </div>
      )
  }
}

// ————— 辅助函数：多边形点串生成 —————
function hexPts(r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2
    pts.push(`${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`)
  }
  return pts.join(' ')
}
function hexPtsData(values: number[]): string {
  return values
    .map((v, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 2
      return `${(Math.cos(a) * v).toFixed(2)},${(Math.sin(a) * v).toFixed(2)}`
    })
    .join(' ')
}
function radarAxes(r: number, n: number): [number, number][] {
  const arr: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2
    arr.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  return arr
}
function radarPts(r: number, n: number): string {
  return radarAxes(r, n).map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
}
function radarPtsData(norm: number[], r: number, n: number): string {
  const arr: string[] = []
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2
    const v = (norm[i] ?? 0) * r
    arr.push(`${(Math.cos(a) * v).toFixed(2)},${(Math.sin(a) * v).toFixed(2)}`)
  }
  return arr.join(' ')
}
