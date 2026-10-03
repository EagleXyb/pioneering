// ============================================================
// PluginsPage — 插件功能页（插件市场）
// ============================================================
// 侧边栏选定「插件」时的内容区：
//   - 顶部：插件 / 技能 / 工作伙伴 三个 Tab + 搜索框 + 管理 / 添加
//   - 分类：精选 / 办公 / 金融 / 财税支付 ... 分类胶囊
//   - 推荐位：必备精选（操作浏览器）/ 新功能推荐（操作电脑）
//   - 特别推荐：插件卡片网格（图标 / 名称 / 简介 / 在用人数 / 安装）
// 当前为纯前端静态数据，安装与管理状态仅维护在本页本地。
// ============================================================

import { useMemo, useState } from 'react'
import {
  Activity,
  AppWindow,
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  Bell,
  Bot,
  Cloud,
  Coins,
  CreditCard,
  DollarSign,
  Droplets,
  Eye,
  FileText,
  GraduationCap,
  Landmark,
  LayoutGrid,
  LineChart,
  MessageCircleQuestion,
  MessagesSquare,
  MonitorSmartphone,
  Music2,
  Plus,
  Scale,
  Search,
  SearchCheck,
  Send,
  SlidersHorizontal,
  Smile,
  Sprout,
  TrendingUp,
  Users,
  Video,
  type LucideIcon
} from 'lucide-react'
import { useAtomValue } from 'jotai'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { sidebarVisibleAtom } from '@/stores/atoms'

type TabKey = 'plugins' | 'skills' | 'partners'

interface PluginItem {
  name: string
  description: string
  users: string
  category: string
  icon: LucideIcon
  color: string
}

interface FeaturedItem {
  tag: string
  name: string
  description: string
  icon: LucideIcon
  gradient: string
}

// ============================================================
// 静态数据
// ============================================================

const CATEGORIES = [
  '精选',
  '办公',
  '金融',
  '财税支付',
  '多媒体创作',
  '内容创作',
  '营销销售',
  '电商',
  '企业管理',
  '效率工具',
  '数据分析',
  '医疗',
  '法律政务',
  '生活出行',
  '教育科研',
  '工程',
  '研发运维'
]

const FEATURED: FeaturedItem[] = [
  {
    tag: '必备精选',
    name: '操作浏览器',
    description: '通过操作浏览器完成网页导航、读取、填表、下载等任务。',
    icon: AppWindow,
    gradient: 'from-sky-300 to-cyan-500'
  },
  {
    tag: '新功能推荐',
    name: '操作电脑',
    description: '让 AI 直接操控你的 Mac，完成文件管理、应用操作等本地电脑任务。',
    icon: MonitorSmartphone,
    gradient: 'from-indigo-300 to-blue-500'
  }
]

const PLUGINS: PluginItem[] = [
  {
    name: '飞书',
    description: '豆包直接完成飞书文档、日历、消息、...',
    users: '15.2 万人在用',
    category: '办公',
    icon: Send,
    color: '#3370FF'
  },
  {
    name: '企业微信',
    description: '通过企业微信 CLI 使用企业...',
    users: '42.5 万人在用',
    category: '办公',
    icon: MessagesSquare,
    color: '#2F80ED'
  },
  {
    name: '钉钉',
    description: '通过钉钉 CLI 使用钉钉相关...',
    users: '34.1 万人在用',
    category: '办公',
    icon: Bell,
    color: '#1677FF'
  },
  {
    name: '腾讯会议',
    description: '预约和管理会议，查询参会...',
    users: '11.7 万人在用',
    category: '办公',
    icon: Video,
    color: '#2D7DF2'
  },
  {
    name: 'Notion',
    description: '连接 Notion 进行查找资料、...',
    users: '2.1 万人在用',
    category: '效率工具',
    icon: FileText,
    color: '#111111'
  },
  {
    name: '百度网盘',
    description: '搜索、上传、下载和移动网...',
    users: '6.6 万人在用',
    category: '效率工具',
    icon: Cloud,
    color: '#06A7FF'
  },
  {
    name: 'Wind Alice 万得金融数据',
    description: '查询股票、基金、指数、债...',
    users: '2.8 万人在用',
    category: '金融',
    icon: TrendingUp,
    color: '#E64340'
  },
  {
    name: '同花顺 iFinD 金融数据',
    description: '查询股票、基金、债券及宏...',
    users: '6.7 万人在用',
    category: '金融',
    icon: LineChart,
    color: '#D6322C'
  },
  {
    name: '通达信',
    description: '金融AI的数据底座，支持全...',
    users: '4.1 万人在用',
    category: '金融',
    icon: Activity,
    color: '#E2231A'
  },
  {
    name: '东方财富妙想',
    description: '查询东方财富提供的金融市...',
    users: '2.6 万人在用',
    category: '金融',
    icon: BarChart3,
    color: '#2F7FF0'
  },
  {
    name: 'Tushare 金融数据',
    description: '获取股票、基金、公告、债...',
    users: '7129 人在用',
    category: '金融',
    icon: Sprout,
    color: '#F2820C'
  },
  {
    name: '进门投研',
    description: '覆盖券商研究所、上市公司...',
    users: '1842 人在用',
    category: '金融',
    icon: Smile,
    color: '#F26B21'
  },
  {
    name: '盈米基金',
    description: '基金筛选、诊断、组合分析...',
    users: '3250 人在用',
    category: '金融',
    icon: Coins,
    color: '#1F3FA8'
  },
  {
    name: 'Financial Datasets',
    description: '查询股票财报、价格和新闻...',
    users: '2523 人在用',
    category: '金融',
    icon: DollarSign,
    color: '#111111'
  },
  {
    name: '企查查',
    description: '企业信息搜索、工商信息与...',
    users: '5 万人在用',
    category: '企业管理',
    icon: SearchCheck,
    color: '#1C79D4'
  },
  {
    name: '启信慧眼',
    description: '企业数据查询及尽调、核验...',
    users: '4004 人在用',
    category: '企业管理',
    icon: Eye,
    color: '#2B5BEF'
  },
  {
    name: '水滴信用 企业尽调',
    description: '水滴信用企业大数据全维度...',
    users: '1848 人在用',
    category: '企业管理',
    icon: Droplets,
    color: '#1BA0E2'
  },
  {
    name: 'TikTok for Business',
    description: '在 TikTok 上创建、管理与分...',
    users: '1.1 万人在用',
    category: '营销销售',
    icon: Music2,
    color: '#111111'
  },
  {
    name: '北大法宝·法律智能检索',
    description: '面向 AI 应用的专业法律数据...',
    users: '2.4 万人在用',
    category: '法律政务',
    icon: Scale,
    color: '#B4292C'
  },
  {
    name: '威科先行',
    description: '检索威科收录的法律法规和...',
    users: '6087 人在用',
    category: '法律政务',
    icon: LayoutGrid,
    color: '#2E9B6F'
  },
  {
    name: '摩知轮',
    description: '检索和分析商标信息，支持...',
    users: '847 人在用',
    category: '法律政务',
    icon: BadgeCheck,
    color: '#2A7FD4'
  },
  {
    name: '华宇元典法律数据',
    description: '检索法律法规、案例文书及...',
    users: '8658 人在用',
    category: '法律政务',
    icon: Landmark,
    color: '#0E7C86'
  },
  {
    name: 'Consensus',
    description: '检索同行评审论文，并生成...',
    users: '1.3 万人在用',
    category: '教育科研',
    icon: MessageCircleQuestion,
    color: '#15A98B'
  },
  {
    name: '博查搜索',
    description: 'AI 用的搜索引擎，包含近百...',
    users: '1.3 万人在用',
    category: '效率工具',
    icon: Search,
    color: '#3A7BFE'
  },
  {
    name: '纷享销客 CRM',
    description: '查询客户、推进商机、记录...',
    users: '1420 人在用',
    category: '营销销售',
    icon: Bot,
    color: '#F5A623'
  },
  {
    name: '销售易CRM',
    description: '用自然语言查询和管理客户...',
    users: '2144 人在用',
    category: '营销销售',
    icon: ArrowUpRight,
    color: '#1C6FE8'
  },
  {
    name: 'Stripe',
    description: '通过 Stripe 管理客户与账户...',
    users: '515 人在用',
    category: '财税支付',
    icon: CreditCard,
    color: '#635BFF'
  },
  {
    name: '八爪鱼 RPA',
    description: '零代码数据采集与 RPA 自动...',
    users: '1 万人在用',
    category: '研发运维',
    icon: Bot,
    color: '#1E6FE8'
  }
]

const TABS: { key: TabKey; label: string; icon: LucideIcon; placeholder: string }[] = [
  { key: 'plugins', label: '插件', icon: AppWindow, placeholder: '' },
  { key: 'skills', label: '技能', icon: GraduationCap, placeholder: '开发中，即将上线' },
  { key: 'partners', label: '工作伙伴', icon: Users, placeholder: '开发中，即将上线' }
]

// ============================================================
// 页面
// ============================================================

export function PluginsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('plugins')
  const [category, setCategory] = useState('精选')
  const [keyword, setKeyword] = useState('')
  const [manageMode, setManageMode] = useState(false)
  const [installedNames, setInstalledNames] = useState<Set<string>>(
    () => new Set(['飞书'])
  )

  // 侧边栏折叠时，左上角会浮显「展开侧边栏 / 新建任务」按钮，
  // 顶栏内容需让出位置避免重叠（macOS 额外避让红绿灯）。
  const sidebarVisible = useAtomValue(sidebarVisibleAtom)

  const filteredPlugins = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return PLUGINS.filter((p) => {
      const matchCategory = category === '精选' || p.category === category
      const matchKeyword =
        !kw || p.name.toLowerCase().includes(kw) || p.description.toLowerCase().includes(kw)
      return matchCategory && matchKeyword
    })
  }, [category, keyword])

  const toggleInstalled = (name: string) => {
    setInstalledNames((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <div className="h-full flex flex-col bg-background select-none">
      {/* ================================================ */}
      {/* 顶部行：Tab（左）+ 搜索 / 管理 / 添加（右） */}
      {/* ================================================ */}
      <div
        className={cn(
          'shrink-0 pr-8 pt-6 pb-3 flex items-center justify-between gap-6',
          sidebarVisible ? 'pl-8' : 'pl-[calc(var(--traffic-light-w)+76px)]'
        )}
      >
        <div className="flex items-center gap-9">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'relative pb-2 text-[18px] font-bold transition-colors',
                activeTab === tab.key
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground/70'
              )}
            >
              {tab.label}
              {activeTab === tab.key && (
                <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-foreground rounded-full" />
              )}
            </button>
          ))}
        </div>

        {activeTab === 'plugins' && (
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索插件"
                className="h-8 w-[218px] rounded-full bg-muted/70 border border-transparent pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:bg-muted focus-visible:border-input transition-colors"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setManageMode((v) => !v)}
              className={cn(
                'h-8 rounded-full px-3.5 text-[13px] font-normal shadow-none',
                manageMode && 'bg-black/5 dark:bg-white/10'
              )}
            >
              <SlidersHorizontal className="size-3.5" strokeWidth={1.8} />
              管理
            </Button>
            <Button
              size="sm"
              className="h-8 rounded-full px-3.5 text-[13px] font-normal"
            >
              <Plus className="size-4" strokeWidth={2} />
              添加
            </Button>
          </div>
        )}
      </div>

      {activeTab === 'plugins' ? (
        /* ================================================ */
        /* 插件市场内容（可滚动） */
        /* ================================================ */
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-8 pb-12">
            {/* 分类胶囊行 */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {CATEGORIES.map((c) => {
                const active = category === c
                return (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={cn(
                      'shrink-0 h-[30px] px-3.5 rounded-full text-[13px] transition-colors',
                      active
                        ? 'bg-foreground text-background font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5'
                    )}
                  >
                    {c}
                  </button>
                )
              })}
            </div>

            {/* 推荐位 */}
            <div className="grid grid-cols-2 gap-5 mt-4">
              {FEATURED.map((item) => {
                const Icon = item.icon
                return (
                  <div
                    key={item.name}
                    className="relative overflow-hidden h-[132px] rounded-xl bg-[#f4f5f8] dark:bg-white/[0.05] px-7 py-6"
                  >
                    <p className="text-[13px] font-semibold text-foreground/70">{item.tag}</p>
                    <p className="mt-1 text-[21px] font-bold text-foreground">{item.name}</p>
                    <p className="mt-1.5 max-w-[56%] text-[13px] leading-5 text-muted-foreground">
                      {item.description}
                    </p>
                    <div
                      className={cn(
                        'absolute right-8 top-1/2 -translate-y-1/2 size-24 rounded-full',
                        'bg-gradient-to-br flex items-center justify-center text-white/95',
                        item.gradient
                      )}
                    >
                      <Icon className="size-9" strokeWidth={1.5} />
                    </div>
                  </div>
                )
              })}
            </div>

            {/* 特别推荐 */}
            <h2 className="mt-7 text-[17px] font-bold text-foreground">特别推荐</h2>
            {filteredPlugins.length === 0 ? (
              <div className="mt-16 flex flex-col items-center gap-2">
                <Search className="size-8 text-muted-foreground/30" strokeWidth={1.5} />
                <p className="text-[13px] text-muted-foreground/60">未找到相关插件</p>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-x-5 gap-y-1 mt-2">
                {filteredPlugins.map((plugin) => {
                  const Icon = plugin.icon
                  const installed = installedNames.has(plugin.name)
                  return (
                    <div
                      key={plugin.name}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-xl transition-colors',
                        installed
                          ? 'bg-black/[0.045] dark:bg-white/[0.07]'
                          : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
                      )}
                    >
                      <div
                        className="shrink-0 size-11 rounded-[10px] flex items-center justify-center text-white"
                        style={{ backgroundColor: plugin.color }}
                      >
                        <Icon className="size-[22px]" strokeWidth={1.8} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-[14px] font-semibold leading-5 text-foreground">
                          {plugin.name}
                        </p>
                        <p className="mt-0.5 truncate text-[12px] leading-4 text-muted-foreground">
                          {plugin.description}
                        </p>
                        <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
                          {plugin.users}
                        </p>
                      </div>
                      {/* 已安装且非管理态：不显示按钮（与截图中飞书一致） */}
                      {(!installed || manageMode) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleInstalled(plugin.name)}
                          className={cn(
                            'shrink-0 h-[30px] rounded-md px-3 text-[13px] font-normal shadow-none',
                            manageMode &&
                              installed &&
                              'text-destructive border-destructive/40 hover:bg-destructive/5 hover:text-destructive'
                          )}
                        >
                          {manageMode && installed ? '移除' : '安装'}
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ================================================ */
        /* 技能 / 工作伙伴：占位 */
        /* ================================================ */
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          {(() => {
            const tab = TABS.find((t) => t.key === activeTab)
            const Icon = tab?.icon ?? GraduationCap
            return (
              <>
                <Icon className="size-10 text-muted-foreground/30" strokeWidth={1.5} />
                <p className="text-sm font-medium text-foreground/80">{tab?.label}</p>
                <p className="text-[11px] text-muted-foreground/50">{tab?.placeholder}</p>
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
