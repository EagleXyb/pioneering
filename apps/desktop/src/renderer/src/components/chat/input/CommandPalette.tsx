// ============================================================
// CommandPalette — 统一命令面板（豆包工作式全宽面板）
//
// 「+」按钮与「/」触发共用同一套样式与同一份命令注册表：
//   - mode='slash'：查询词来自编辑器中 `/` 之后的文本（只读），
//     键盘导航由 InputArea 在 textarea 的 keydown 中统一处理；
//     底部不显示搜索框。
//   - mode='plus'：底部展示内置搜索框并自动聚焦，查询词由
//     面板内部输入框驱动，键盘事件同样上抛 InputArea 协调。
//
// 组件保持受控：只负责渲染与事件回调，open / query / activeIndex
// 全部由 InputArea 持有（与旧 SlashCommandPopover 的受控约定一致）。
//
// a11y：沿用 listbox + option + aria-activedescendant 模式。
// ============================================================

import {
  ClipboardCheck,
  Eraser,
  HelpCircle,
  ListChecks,
  Paperclip,
  Search,
  Sparkles,
  Terminal,
  Zap,
  type LucideIcon
} from 'lucide-react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { cn } from '@/lib/utils'

// ============================================================
// 命令注册表（单一数据源，「+」与「/」共用）
// ============================================================

export type PaletteGroupId = 'add' | 'command'

/** 动作型命令的行为标识（insert 型直接插入 token，无需 actionId） */
export type PaletteActionId =
  | 'attach-file'
  | 'toggle-agent'
  // dev-only：在当前会话模拟一次 plan_confirm 方案确认门（UI 预览，生产构建不注册）
  | 'mock-plan-confirm'

export interface PaletteCommand {
  id: string
  group: PaletteGroupId
  icon: LucideIcon
  /** 主名称（添加组为中文，指令组为 /token） */
  label: string
  /** 名称右侧弱化说明 */
  hint?: string
  /** insert 型命令插入编辑器的 token，如 '/clear' */
  slashName?: string
  /** 搜索辅助词（中文描述等，参与评分） */
  keywords: string[]
  /** insert=插入 token；action=立即执行动作 */
  kind: 'insert' | 'action'
  actionId?: PaletteActionId
}

export interface PaletteGroupDef {
  id: PaletteGroupId
  title: string
}

export const PALETTE_GROUPS: PaletteGroupDef[] = [
  { id: 'add', title: '添加' },
  { id: 'command', title: '指令' }
]

/**
 * 统一命令集：仅收录当前已落地的能力，不引入未实现的功能入口。
 *  - 添加组：来自原「+」菜单的真实动作（上传附件 / Agent 模式）
 *  - 指令组：原 BUILTIN_SLASH_COMMANDS 的 5 个 token
 */
export const PALETTE_COMMANDS: PaletteCommand[] = [
  {
    id: 'attach-file',
    group: 'add',
    icon: Paperclip,
    label: '上传文件或图片',
    hint: '选择本地文件或图片',
    keywords: ['文件', '图片', '附件', '上传', 'file', 'attach'],
    kind: 'action',
    actionId: 'attach-file'
  },
  {
    id: 'toggle-agent',
    group: 'add',
    icon: Zap,
    label: '模式',
    hint: '切换 Agent 模式',
    keywords: ['agent', '模式', 'agentmode'],
    kind: 'action',
    actionId: 'toggle-agent'
  },
  {
    id: 'clear',
    group: 'command',
    icon: Eraser,
    label: '/clear',
    hint: '清空当前对话',
    slashName: '/clear',
    keywords: ['清空', '清除', 'clear', '重置对话'],
    kind: 'insert'
  },
  {
    id: 'plan',
    group: 'command',
    icon: ListChecks,
    label: '/plan',
    hint: '进入计划模式',
    slashName: '/plan',
    keywords: ['计划', 'plan', '计划模式'],
    kind: 'insert'
  },
  {
    id: 'agent',
    group: 'command',
    icon: Terminal,
    label: '/agent',
    hint: '切换 Agent 模式',
    slashName: '/agent',
    keywords: ['agent', '智能体', '技能'],
    kind: 'insert'
  },
  {
    id: 'help',
    group: 'command',
    icon: HelpCircle,
    label: '/help',
    hint: '查看使用帮助',
    slashName: '/help',
    keywords: ['帮助', 'help', '使用说明'],
    kind: 'insert'
  },
  {
    id: 'optimize',
    group: 'command',
    icon: Sparkles,
    label: '/optimize',
    hint: '优化当前提示词',
    slashName: '/optimize',
    keywords: ['优化', '提示词', 'optimize', '润色'],
    kind: 'insert'
  }
]

// dev-only：plan_confirm 方案确认门 UI 预览入口。
// 生产构建中 import.meta.env.DEV 为 false，该命令不会注册；
// 触发后仅在前端入队一个 mock 暂停项（不经后端），用于预览内嵌卡形态。
if (import.meta.env.DEV) {
  PALETTE_COMMANDS.push({
    id: 'dev-mock-plan-confirm',
    group: 'command',
    icon: ClipboardCheck,
    label: '/mock-plan',
    hint: '模拟方案确认门（仅开发预览）',
    keywords: ['模拟', 'mock', '方案确认', 'plan_confirm', 'spec', 'tasks', 'checklist'],
    kind: 'action',
    actionId: 'mock-plan-confirm'
  })
}

// ============================================================
// 过滤与评分（纯函数）
// 规则沿用旧 scoreSlashCommand：完全匹配 < 前缀 < 包含 < 模糊 < 不匹配；
// 评分对象从单一 name 扩展为 label / slashName / keywords / hint。
// ============================================================

function scoreAgainst(text: string, q: string): number {
  const t = text.toLowerCase()
  if (t === q) return 0
  if (t.startsWith(q)) return 1
  const idx = t.indexOf(q)
  if (idx >= 0) return 10 + idx
  // 模糊匹配：字符顺序出现
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++
  }
  if (qi === q.length) return 100 + (t.length - q.length)
  return Infinity
}

export function scorePaletteCommand(cmd: PaletteCommand, rawQuery: string): number {
  const q = rawQuery.trim().toLowerCase().replace(/^\//, '')
  if (!q) return 1
  const haystacks = [
    cmd.label,
    cmd.slashName ?? '',
    cmd.hint ?? '',
    ...cmd.keywords
  ].map((s) => s.toLowerCase())
  let best = Infinity
  for (const h of haystacks) {
    if (!h) continue
    const s = scoreAgainst(h, q)
    if (s < best) best = s
  }
  return best
}

/** 过滤 + 排序；query 为空时返回原顺序 */
export function filterPaletteCommands(
  commands: PaletteCommand[],
  query: string
): PaletteCommand[] {
  const q = query.trim()
  if (!q) return commands
  return commands
    .map((c) => ({ c, s: scorePaletteCommand(c, q) }))
    .filter((x) => x.s !== Infinity)
    .sort((a, b) => a.s - b.s || PALETTE_COMMANDS.indexOf(a.c) - PALETTE_COMMANDS.indexOf(b.c))
    .map((x) => x.c)
}

export interface PaletteVisibleGroup {
  id: PaletteGroupId
  title: string
  items: PaletteCommand[]
}

/** 按注册表顺序分组并丢弃空组（过滤后组标题自动隐藏） */
export function groupPaletteCommands(commands: PaletteCommand[]): PaletteVisibleGroup[] {
  return PALETTE_GROUPS.map((g) => ({
    id: g.id,
    title: g.title,
    items: commands.filter((c) => c.group === g.id)
  })).filter((g) => g.items.length > 0)
}

/** 拍平后的可见条目（跨组连续索引，供键盘导航与 ⌘N 使用） */
export function flattenPaletteGroups(groups: PaletteVisibleGroup[]): PaletteCommand[] {
  return groups.flatMap((g) => g.items)
}

// ============================================================
// 面板组件（受控渲染）
// ====================================================

export interface CommandPaletteProps {
  /** 任一触发模式打开时才渲染 */
  open: boolean
  /** slash=「/」触发（查询来自编辑器，无搜索框）；plus=「+」触发（内置搜索框） */
  mode: 'slash' | 'plus'
  /** 已按当前 query 过滤分组的可见数据 */
  groups: PaletteVisibleGroup[]
  /** 拍平列表中的高亮索引 */
  activeIndex: number
  /** plus 模式下搜索框的值（slash 模式忽略） */
  query: string
  onQueryChange: (q: string) => void
  onQueryKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void
  onHover: (flatIndex: number) => void
  onSelect: (cmd: PaletteCommand) => void
  /** plus 模式点击遮罩/Esc 关闭 */
  onClose: () => void
}

export function CommandPalette({
  open,
  mode,
  groups,
  activeIndex,
  query,
  onQueryChange,
  onQueryKeyDown,
  onHover,
  onSelect,
  onClose
}: CommandPaletteProps) {
  const flat = flattenPaletteGroups(groups)
  if (!open) return null
  // slash 模式无匹配时沿用旧行为（面板隐藏，输入继续留在编辑器）；
  // plus 模式必须保留搜索框，仅列表区切换为空态，否则输入会中断。
  if (mode === 'slash' && flat.length === 0) return null

  // 组内偏移 → 跨组拍平索引
  let flatCursor = 0
  const optionId = (i: number) => `command-palette-option-${i}`
  const activeId = activeIndex < flat.length ? optionId(activeIndex) : undefined

  return (
    <>
      {/* plus 模式提供透明遮罩捕获外部点击（slash 模式不打断输入流） */}
      {mode === 'plus' && (
        <div className="fixed inset-0 z-40" aria-hidden onMouseDown={onClose} />
      )}

      <div
        className="absolute bottom-full left-0 right-0 z-50 mb-2 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-[0_8px_40px_rgba(0,0,0,0.12)]"
        role="listbox"
        aria-label={mode === 'slash' ? '斜杠命令列表' : '添加与命令列表'}
        aria-activedescendant={activeId}
        tabIndex={-1}
      >
        {/* 可滚动的分组列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {flat.length === 0 ? (
            <div className="px-3 py-8 text-center text-[13px] text-muted-foreground">
              未找到匹配的命令
            </div>
          ) : groups.map((group) => {
            const groupStart = flatCursor
            flatCursor += group.items.length
            return (
              <div key={group.id}>
                <div
                  className="px-3 pb-1 pt-2 text-[12px] font-medium text-muted-foreground"
                  aria-hidden
                >
                  {group.title}
                </div>
                {group.items.map((cmd, i) => {
                  const flatIndex = groupStart + i
                  const isActive = flatIndex === activeIndex
                  const Icon = cmd.icon
                  // ⌘N：按当前可见顺序编号，最多 9 项
                  const shortcut = flatIndex < 9 ? `⌘${flatIndex + 1}` : null
                  return (
                    <button
                      key={cmd.id}
                      id={optionId(flatIndex)}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      aria-label={[cmd.label, cmd.hint].filter(Boolean).join('，')}
                      onMouseEnter={() => onHover(flatIndex)}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        onSelect(cmd)
                      }}
                      ref={isActive ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                        isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
                      )}
                    >
                      <Icon className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
                      <span className="shrink-0 text-[15px] font-medium">{cmd.label}</span>
                      {cmd.hint && (
                        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                          {cmd.hint}
                        </span>
                      )}
                      {shortcut && (
                        <span
                          className={cn(
                            'ml-auto shrink-0 text-[12px] tabular-nums',
                            isActive ? 'text-foreground/50' : 'text-muted-foreground/60'
                          )}
                          aria-hidden
                        >
                          {shortcut}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* plus 模式内置搜索框（slash 模式查询由编辑器驱动，不展示） */}
        {mode === 'plus' && (
          <div className="flex items-center gap-2 border-t px-4 py-2.5">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={onQueryKeyDown}
              placeholder="搜索…"
              autoFocus
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground/70"
            />
          </div>
        )}
      </div>
    </>
  )
}
