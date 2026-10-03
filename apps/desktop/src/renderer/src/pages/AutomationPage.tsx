// ============================================================
// AutomationPage — 自动化功能页（定时任务）
// ============================================================
// 侧边栏选定「自动化」时的内容区：
//   - 顶部：定时任务 / 运行记录 两个 Tab
//   - 空态：闹钟图标 +「开启你的第一个定时任务吧」+ 添加定时任务按钮
//   - 已创建任务：简单列表（名称 / 内容 / 执行时间 / 启停 / 删除）
//   - 底部：定时任务模版（3 列 12 个卡片，点击预填创建弹窗）
// 当前为纯前端本地状态，不与后端调度系统联动。
// ============================================================

import { useState } from 'react'
import {
  AlarmClockCheck,
  CalendarDays,
  Clapperboard,
  ClipboardList as ClipboardListIcon,
  Clock3,
  History,
  Image as ImageIcon,
  Inbox,
  Languages,
  Lightbulb,
  ListChecks,
  MessageCircleQuestion,
  Moon,
  Newspaper,
  PhoneCall,
  Plus,
  Stethoscope,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import { useAtomValue } from 'jotai'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'
import { genId } from '@/lib/genId'
import { sidebarVisibleAtom } from '@/stores/atoms'

type TabKey = 'tasks' | 'records'
type RepeatKey = 'daily' | 'weekdays' | 'weekly' | 'once'

interface Template {
  id: string
  name: string
  description: string
  icon: LucideIcon
  time: string
  repeat: RepeatKey
  weekday: number // 0=周日 ... 6=周六（repeat=weekly 时生效）
  date: string // repeat=once 时生效（YYYY-MM-DD）
}

interface ScheduledTask {
  id: string
  name: string
  prompt: string
  icon: LucideIcon
  time: string
  repeat: RepeatKey
  weekday: number
  date: string
  enabled: boolean
}

// ============================================================
// 静态数据：定时任务模版（与产品图一致，共 12 个）
// ============================================================

const TEMPLATES: Template[] = [
  {
    id: 'ai-news',
    name: '每日 AI 新闻推送',
    description: '关注当天 AI 领域的重要动态，侧重 AI coding 与具身智能进展，筛...',
    icon: Newspaper,
    time: '09:00',
    repeat: 'daily',
    weekday: 1,
    date: ''
  },
  {
    id: 'english-words',
    name: '每日 5 个英语单词',
    description: '每天推荐 5 个高频实用英语单词，包含词义、音标、例句与记忆提示。',
    icon: Languages,
    time: '08:00',
    repeat: 'daily',
    weekday: 1,
    date: ''
  },
  {
    id: 'bedtime-story',
    name: '每日儿童睡前故事',
    description: '生成 3-5 分钟可读的温和睡前故事，情节完整并附简短寓意。',
    icon: Moon,
    time: '20:30',
    repeat: 'daily',
    weekday: 1,
    date: ''
  },
  {
    id: 'weekly-report',
    name: '每周工作周报',
    description: '每周五汇总仓库 PR 与 Issue 进展，输出关键变更与待关注事项。',
    icon: ListChecks,
    time: '18:00',
    repeat: 'weekly',
    weekday: 5,
    date: ''
  },
  {
    id: 'movie-recommend',
    name: '经典电影推荐',
    description: '推荐一部高分经典电影，简要介绍剧情梗概、亮点与推荐理由，全程...',
    icon: Clapperboard,
    time: '20:00',
    repeat: 'weekly',
    weekday: 6,
    date: ''
  },
  {
    id: 'today-in-history',
    name: '历史上的今天',
    description: '从科技、电影、音乐等领域挑选一件“今天发生过”的有趣事件，200-...',
    icon: CalendarDays,
    time: '08:30',
    repeat: 'daily',
    weekday: 1,
    date: ''
  },
  {
    id: 'daily-why',
    name: '每日一个为什么',
    description: '每天抛出一个有趣问题，先提问再解答，语气轻松、通俗易懂，答案...',
    icon: Lightbulb,
    time: '07:30',
    repeat: 'daily',
    weekday: 1,
    date: ''
  },
  {
    id: 'call-parents',
    name: '父母联系提醒',
    description: '每周日 10:00 提醒你给家人打电话或发消息，简单问候近况。',
    icon: PhoneCall,
    time: '10:00',
    repeat: 'weekly',
    weekday: 0,
    date: ''
  },
  {
    id: 'health-check',
    name: '体检预约提醒',
    description: '在 2026/04/08 07:00 提醒你确认体检时间、准备证件，并注意空腹...',
    icon: Stethoscope,
    time: '07:00',
    repeat: 'once',
    weekday: 1,
    date: '2026-04-08'
  },
  {
    id: 'interview-prep',
    name: '面试准备提醒',
    description: '工作日每 2 小时提醒你复习大模型面试内容，并生成 3 个模拟问题。',
    icon: MessageCircleQuestion,
    time: '09:00',
    repeat: 'weekdays',
    weekday: 1,
    date: ''
  },
  {
    id: 'meeting-prep',
    name: '会议前准备',
    description: '在会议开始前提醒你整理议题、目标、待确认问题和关键结论。',
    icon: ClipboardListIcon,
    time: '09:00',
    repeat: 'weekdays',
    weekday: 1,
    date: ''
  },
  {
    id: 'pet-wallpaper',
    name: '可爱萌宠手机壁纸',
    description: '随机从 7 种不同风格中挑选一种，为你生成一张 9:16 竖版高清萌宠...',
    icon: ImageIcon,
    time: '09:00',
    repeat: 'weekly',
    weekday: 1,
    date: ''
  }
]

const REPEAT_OPTIONS: { key: RepeatKey; label: string }[] = [
  { key: 'daily', label: '每天' },
  { key: 'weekdays', label: '工作日' },
  { key: 'weekly', label: '每周' },
  { key: 'once', label: '仅一次' }
]

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function formatSchedule(task: Pick<ScheduledTask, 'repeat' | 'time' | 'weekday' | 'date'>): string {
  switch (task.repeat) {
    case 'daily':
      return `每天 ${task.time}`
    case 'weekdays':
      return `工作日 ${task.time}`
    case 'weekly':
      // WEEKDAYS 形如「周日」，此处拼接为「每周日」而非「每周周日」
      return `每周${WEEKDAYS[task.weekday].replace('周', '')} ${task.time}`
    case 'once':
      return `${task.date} ${task.time}`
  }
}

/** 表单初始值 */
function emptyForm() {
  return { name: '', prompt: '', time: '09:00', repeat: 'daily' as RepeatKey, weekday: 1, date: '' }
}

function todayStr(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// ============================================================
// 页面
// ============================================================

export function AutomationPage() {
  const [tab, setTab] = useState<TabKey>('tasks')
  const [tasks, setTasks] = useState<ScheduledTask[]>([])

  // 创建弹窗
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [formIcon, setFormIcon] = useState<LucideIcon>(AlarmClockCheck)

  // 侧边栏折叠时，左上角会浮显「展开侧边栏 / 新建任务」按钮，
  // 顶栏需让出位置避免重叠（macOS 额外避让红绿灯）。
  const sidebarVisible = useAtomValue(sidebarVisibleAtom)

  const openCreateDialog = (template?: Template) => {
    if (template) {
      setForm({
        name: template.name,
        prompt: template.description.replace(/\.{2,}$/, ''),
        time: template.time,
        repeat: template.repeat,
        weekday: template.weekday,
        date: template.date || todayStr()
      })
      setFormIcon(() => template.icon)
    } else {
      setForm(emptyForm())
      setFormIcon(AlarmClockCheck)
    }
    setDialogOpen(true)
  }

  const handleConfirm = () => {
    const name = form.name.trim()
    const prompt = form.prompt.trim()
    if (!name || !prompt) return
    setTasks((prev) => [
      {
        id: genId('task'),
        name,
        prompt,
        icon: formIcon,
        time: form.time,
        repeat: form.repeat,
        weekday: form.weekday,
        date: form.repeat === 'once' ? form.date || todayStr() : '',
        enabled: true
      },
      ...prev
    ])
    setDialogOpen(false)
  }

  const toggleEnabled = (id: string) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)))

  const removeTask = (id: string) => setTasks((prev) => prev.filter((t) => t.id !== id))

  const canSubmit = form.name.trim().length > 0 && form.prompt.trim().length > 0

  return (
    <div className="h-full flex flex-col bg-background select-none">
      {/* ================================================ */}
      {/* 顶部 Tab 行：定时任务 / 运行记录 */}
      {/* ================================================ */}
      <div
        className={cn(
          'shrink-0 pt-6 pb-2 pr-8 flex items-center gap-1',
          sidebarVisible ? 'pl-6' : 'pl-[calc(var(--traffic-light-w)+76px)]'
        )}
      >
        <button
          onClick={() => setTab('tasks')}
          className={cn(
            'h-9 px-4 rounded-lg flex items-center gap-2 text-[14px] transition-colors',
            tab === 'tasks'
              ? 'bg-black/[0.06] dark:bg-white/10 text-foreground font-semibold'
              : 'text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5'
          )}
        >
          <AlarmClockCheck className="size-[18px]" strokeWidth={1.8} />
          定时任务
        </button>
        <button
          onClick={() => setTab('records')}
          className={cn(
            'h-9 px-4 rounded-lg flex items-center gap-2 text-[14px] transition-colors',
            tab === 'records'
              ? 'bg-black/[0.06] dark:bg-white/10 text-foreground font-semibold'
              : 'text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5'
          )}
        >
          <History className="size-[18px]" strokeWidth={1.8} />
          运行记录
        </button>
      </div>

      {tab === 'tasks' ? (
        /* ================================================ */
        /* 定时任务内容（可滚动） */
        /* ================================================ */
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-6 pb-14">
            {tasks.length === 0 ? (
              /* ---------- 空态 ---------- */
              <div className="py-24 flex flex-col items-center">
                <AlarmClockCheck
                  className="size-16 text-foreground/20"
                  strokeWidth={1.4}
                />
                <p className="mt-5 text-[15px] text-muted-foreground">开启你的第一个定时任务吧</p>
                <Button
                  onClick={() => openCreateDialog()}
                  className="mt-6 h-10 rounded-lg px-5 text-[14px] font-normal"
                >
                  <Plus className="size-4" strokeWidth={2.2} />
                  添加定时任务
                </Button>
              </div>
            ) : (
              /* ---------- 已创建任务列表 ---------- */
              <div className="pt-2">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-[17px] font-bold text-foreground">我的定时任务</h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openCreateDialog()}
                    className="h-8 rounded-full px-3.5 text-[13px] font-normal shadow-none"
                  >
                    <Plus className="size-4" strokeWidth={2} />
                    添加定时任务
                  </Button>
                </div>
                <div className="flex flex-col gap-2.5">
                  {tasks.map((task) => {
                    const Icon = task.icon
                    return (
                      <div
                        key={task.id}
                        className="flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4"
                      >
                        <div className="shrink-0 size-10 rounded-[10px] bg-muted flex items-center justify-center text-foreground/70">
                          <Icon className="size-5" strokeWidth={1.8} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className={cn(
                              'truncate text-[15px] font-semibold',
                              task.enabled ? 'text-foreground' : 'text-muted-foreground'
                            )}
                          >
                            {task.name}
                          </p>
                          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                            {task.prompt}
                          </p>
                        </div>
                        <span className="shrink-0 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                          <Clock3 className="size-4" strokeWidth={1.8} />
                          {formatSchedule(task)}
                        </span>
                        {/* 启停开关 */}
                        <button
                          role="switch"
                          aria-checked={task.enabled}
                          onClick={() => toggleEnabled(task.id)}
                          className={cn(
                            'relative shrink-0 h-6 w-11 rounded-full transition-colors',
                            task.enabled ? 'bg-foreground' : 'bg-black/15 dark:bg-white/20'
                          )}
                        >
                          <span
                            className={cn(
                              'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
                              task.enabled ? 'left-[22px]' : 'left-0.5'
                            )}
                          />
                        </button>
                        <button
                          onClick={() => removeTask(task.id)}
                          className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                          title="删除任务"
                        >
                          <Trash2 className="size-[18px]" strokeWidth={1.8} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ---------- 定时任务模版 ---------- */}
            <h2 className="mt-10 text-[17px] font-bold text-foreground">定时任务模版</h2>
            <div className="mt-4 grid grid-cols-3 gap-4">
              {TEMPLATES.map((template) => {
                const Icon = template.icon
                return (
                  <button
                    key={template.id}
                    onClick={() => openCreateDialog(template)}
                    className="text-left flex items-start gap-3.5 rounded-xl border border-border bg-card px-5 py-5 transition-all hover:border-foreground/20 hover:shadow-sm"
                  >
                    <Icon className="mt-0.5 size-5 shrink-0 text-foreground/80" strokeWidth={1.8} />
                    <div className="min-w-0">
                      <p className="text-[15px] font-bold text-foreground">{template.name}</p>
                      <p className="mt-1 text-[13px] leading-5 text-muted-foreground line-clamp-1">
                        {template.description}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        /* ================================================ */
        /* 运行记录：空态 */
        /* ================================================ */
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <Inbox className="size-14 text-foreground/20" strokeWidth={1.4} />
          <p className="mt-3 text-[15px] text-muted-foreground">暂无运行记录</p>
          <p className="text-[12px] text-muted-foreground/60">定时任务执行后可在此查看运行结果</p>
        </div>
      )}

      {/* ================================================ */}
      {/* 添加 / 从模版创建 定时任务弹窗 */}
      {/* ================================================ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[480px] max-w-[calc(100vw-32px)]">
          <DialogHeader>
            <DialogTitle className="text-[17px]">添加定时任务</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {/* 任务名称 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-foreground">任务名称</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="例如：每日 AI 新闻推送"
                className="h-9 w-full rounded-[var(--radius-control)] border border-input bg-transparent px-3 text-sm shadow-none transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            {/* 任务内容 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-foreground">任务内容</label>
              <textarea
                value={form.prompt}
                onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
                placeholder="描述任务到期时要执行的内容，例如：汇总今天的 AI 要闻..."
                rows={4}
                className="w-full rounded-[var(--radius-control)] border border-input bg-transparent px-3 py-2 text-sm leading-6 shadow-none transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              />
            </div>

            {/* 重复规则 */}
            <div className="flex flex-col gap-2">
              <label className="text-[13px] font-medium text-foreground">重复</label>
              <RadioGroup
                value={form.repeat}
                onValueChange={(v) => setForm((f) => ({ ...f, repeat: v as RepeatKey }))}
                className="flex items-center gap-4"
              >
                {REPEAT_OPTIONS.map((opt) => (
                  <label
                    key={opt.key}
                    className="flex items-center gap-1.5 text-[13px] text-foreground cursor-pointer"
                  >
                    <RadioGroupItem value={opt.key} className="size-4" />
                    {opt.label}
                  </label>
                ))}
              </RadioGroup>
            </div>

            {/* 执行时间 / 每周几 / 日期 */}
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-medium text-foreground">执行时间</label>
                <input
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                  className="h-9 rounded-[var(--radius-control)] border border-input bg-transparent px-3 text-sm shadow-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              {form.repeat === 'weekly' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[13px] font-medium text-foreground">星期</label>
                  <select
                    value={form.weekday}
                    onChange={(e) => setForm((f) => ({ ...f, weekday: Number(e.target.value) }))}
                    className="h-9 rounded-[var(--radius-control)] border border-input bg-transparent px-3 text-sm shadow-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {WEEKDAYS.map((w, i) => (
                      <option key={w} value={i}>
                        {w}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {form.repeat === 'once' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[13px] font-medium text-foreground">日期</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    className="h-9 rounded-[var(--radius-control)] border border-input bg-transparent px-3 text-sm shadow-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="mt-1 gap-2">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="h-9 rounded-lg text-[13px] font-normal shadow-none"
            >
              取消
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!canSubmit}
              className="h-9 rounded-lg px-5 text-[13px] font-normal"
            >
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
