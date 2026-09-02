// ============================================================
// GeneralSection — 通用（general 组）复合设置页
//   对标参照截图样式：
//   ┌────────────────────────────────────────────────────────┐
//   │ 基础设置                                               │
//   │  主题  ┌──┐           · 下拉选择                       │
//   │  语言  ┌──┐           · 下拉选择                       │
//   └────────────────────────────────────────────────────────┘
//   ┌────────────────────────────────────────────────────────┐
//   │ 偏好设置                                               │
//   │  语音转录快捷键  ⬜ Alt+V ⚙️    · 开关 + 快捷键标签 + 配置钮│
//   │  本地链接打开方式   ┌──┐         · 下拉                  │
//   │  产物存储路径   C:\Users...[更改] · 路径框 + 更改按钮     │
//   └────────────────────────────────────────────────────────┘
//   ┌────────────────────────────────────────────────────────┐
//   │ AI 水印                                                │
//   │  隐藏 AI 生成标识        ⬜                            │
//   └────────────────────────────────────────────────────────┘
//
//   设计要点（逐像素规格）：
//   · SectionCard：#fafafa 背景，8px 圆角，1px #f0f0f0 描边
//   · 分组小标题：13px 加粗 #262626，mt-6 mb-3（首组 mt-0）
//   · SettingRow：左（标题/副文字）+ 右（控件）flex justify-between
//     py-[15px] / px-4 / 分隔线 1px #efefef（最后一行无分隔线）
//   · 控件：
//      Select：30px 高 · 200px 宽 · 8px 圆角 · 1px #d9d9d9 边框 · hover #bfbfbf
//      Switch：30px×17px 胶囊 · OFF #d9d9d9 / ON #52c41a
//      快捷键 Tag：1px #d9d9d9 边框 + 灰色背景 + px-2 rounded-[5px]
//      配置按钮：26px × 26px 圆形 灰色描边 Settings gear
//      路径框：左 8px 圆角 + 右 更改按钮（默认按钮 30px 高）
// ============================================================

import { useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
  Settings as SettingsGear,
  FolderOpen
} from 'lucide-react'
import { useSetAtom } from 'jotai'
import { cn, pxToRem } from '@/lib/utils'
import { selectListReducer } from '@/lib/select-list'
import { Button } from '@/components/ui/button'
import { useAppStore, FONT_SIZE_PX, type ThemeMode, type Language, type FontSizeMode } from '@/stores/useAppStore'
import { settingsOpenAtom, settingsCategoryAtom } from '@/stores/atoms'
import { resolveBinding } from '../../../../../shared/hotkey-registry'
import { formatBindingForDisplay } from '@/lib/match-accelerator'

// ===== 常量：下拉选项 =====
const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' }
]
const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en-US', label: 'English' }
]
const FONT_SIZE_OPTIONS: { value: FontSizeMode; label: string }[] = [
  { value: 'small', label: '紧凑（14px）' },
  { value: 'medium', label: '默认（15px）' },
  { value: 'large', label: '舒适（17px）' }
]
const LINK_OPEN_OPTIONS: { value: string; label: string }[] = [
  { value: 'always-ask', label: '始终询问' },
  { value: 'internal', label: '内置浏览器' },
  { value: 'external', label: '系统默认浏览器' }
]

export function GeneralSection() {
  // ===== 状态：语言/主题/字体大小 进入持久化 store；其余仍为局部 state =====
  const {
    theme,
    setTheme,
    language,
    setLanguage,
    fontSize,
    setFontSize
  } = useAppStore()
  const hotkeyOverrides = useAppStore((s) => s.hotkeys)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsCategory = useSetAtom(settingsCategoryAtom)
  const [transcribeHotkey, setTranscribeHotkey] = useState(true)
  const [linkOpen, setLinkOpen] = useState('always-ask')
  const [storagePath, setStoragePath] = useState('C:\\Users\\Administrator\\AppData\\Roaming\\Pioneering\\workspace')
  /** 当前字体档位的 1rem 像素基准（13/14/16），注入 Select 使 portal 下拉同步缩放 */
  const shellRemPx = FONT_SIZE_PX[fontSize]

  return (
    // 宽度对齐截图：内容限宽 + 左对齐（SettingsDialog 右侧已经有 padding），
    // 最大宽度保证在超宽窗口下不会无限拉伸，整体信息密度与截图一致。
    <div className="flex flex-col w-full h-full" style={{ maxWidth: 780 }}>
      {/* 分组 1：基础设置 */}
      <GroupHeader label="基础设置" />
      <SectionCard>
        <SettingRow
          index={0}
          title="个性化 · 主题"
          subtitle="选择界面主题（浅色 / 深色 / 跟随系统）"
          control={
            <Select
              value={theme}
              options={THEME_OPTIONS}
              remBasePx={shellRemPx}
              onChange={(v) => setTheme(v as ThemeMode)}
            />
          }
        />
        <SettingRow
          index={1}
          title="语言切换"
          subtitle="选择您喜欢的按钮标签和应用内其他文本的语言"
          control={
            <Select
              value={language}
              options={LANGUAGE_OPTIONS}
              remBasePx={shellRemPx}
              onChange={(v) => setLanguage(v as Language)}
            />
          }
        />
        <SettingRow
          index={2}
          title="字体大小"
          subtitle="调整界面整体字号基准，对话区 Markdown 随档位同比例缩放"
          control={
            <Select
              value={fontSize}
              options={FONT_SIZE_OPTIONS}
              remBasePx={shellRemPx}
              onChange={(v) => setFontSize(v as FontSizeMode)}
            />
          }
          last
        />
      </SectionCard>

      {/* 分组 2：偏好设置 */}
      <GroupHeader label="偏好设置" />
      <SectionCard>
        <SettingRow
          index={0}
          title="语音转录快捷键"
          subtitle="开启或关闭语音转录快捷键，录制自定义组合键，或恢复默认值。"
          control={
            <div className="flex items-center gap-2">
              <Switch
                checked={transcribeHotkey}
                onCheckedChange={setTranscribeHotkey}
              />
              {/* live 渲染实际生效绑定（快捷键设置页改绑后此处同步刷新） */}
              <HotkeyTag
                keys={formatBindingForDisplay(
                  resolveBinding('toggle-record', hotkeyOverrides)
                )
                  .split('+')
                  .map((s) => s.trim())
                  .filter(Boolean)}
              />
              <button
                type="button"
                title="配置快捷键"
                aria-label="配置快捷键"
                className="flex items-center justify-center rounded-full border border-[#d9d9d9] bg-white hover:bg-[#f5f5f5] hover:border-[#bfbfbf] transition-colors"
                style={{ width: 26, height: 26 }}
                onClick={() => {
                  // 跳转快捷键设置页（分类已合并：placeholder → ShortcutsSection）
                  setSettingsCategory('shortcut')
                  setSettingsOpen(true)
                }}
              >
                <SettingsGear size={14} stroke="#8c8c8c" strokeWidth={1.8} />
              </button>
            </div>
          }
        />
        <SettingRow
          index={1}
          title="本地链接的默认打开方式"
          subtitle="点击终端中的本地链接时，是否自动使用内置浏览器打开"
          control={
            <Select value={linkOpen} options={LINK_OPEN_OPTIONS} remBasePx={shellRemPx} onChange={setLinkOpen} />
          }
        />
        <SettingRow
          index={2}
          title="自定义产物存储路径"
          subtitle="新建任务和工作空间将保存在此（该更改不会修改已有的文件路径）"
          control={<PathPicker value={storagePath} onChange={setStoragePath} />}
          last
        />
      </SectionCard>
    </div>
  )
}

// ==================================================
// 视觉容器：GroupHeader / SectionCard / SettingRow
// ==================================================

function GroupHeader({ label }: { label: string }) {
  // 与截图对齐：加粗 14px，上方 32px 与 Dialog 标题保持呼吸间距，下方 16px 到首行
  return (
    <div
      className="font-semibold select-none shrink-0"
      style={{ fontSize: pxToRem(14), color: '#262626', marginTop: 32, marginBottom: 16 }}
    >
      {label}
    </div>
  )
}

function SectionCard({ children }: { children: ReactNode }) {
  // 与参考截图 / 快捷键卡片规格一致：
  // 圆角 8px + 1px #f0f0f0 描边 + overflow:hidden（行内分隔线不溢出圆角）
  return (
    <div
      className="shrink-0 w-full overflow-hidden"
      style={{
        background: '#fff',
        border: '1px solid #f0f0f0',
        borderRadius: 8
      }}
    >
      {children}
    </div>
  )
}

/** 单行设置：左（标题/副文字）+ 右（控件）
 *  卡片内部：左右 16px 内边距 + 斑马条纹背景 + hover 淡蓝高亮，与快捷键列表视觉对齐。 */
function SettingRow({
  title,
  subtitle,
  control,
  last = false,
  index = 0
}: {
  title: string
  subtitle?: string
  control: ReactNode
  last?: boolean
  /** 用于斑马条纹：索引从 0 开始（由父 SectionCard 内传入） */
  index?: number
}) {
  const zebraBg = index % 2 === 1 ? '#fafafa' : '#fff'
  return (
    <div
      className="relative transition-colors hover:bg-[#f5f9ff]"
      style={{ background: zebraBg }}
    >
      <div
        className="flex items-center justify-between"
        style={{ paddingTop: 16, paddingBottom: 16, paddingLeft: 16, paddingRight: 16 }}
      >
        {/* 左：标题 + 副文字 */}
        <div className="flex flex-col min-w-0 pr-6 flex-1">
          <span
            className="shrink-0 truncate"
            style={{ fontSize: pxToRem(14), color: '#262626', lineHeight: pxToRem(20), fontWeight: 500 }}
          >
            {title}
          </span>
          {subtitle && (
            <span
              className="mt-1 truncate"
              style={{ fontSize: pxToRem(12), color: '#8c8c8c', lineHeight: pxToRem(18) }}
            >
              {subtitle}
            </span>
          )}
        </div>
        {/* 右：控件 */}
        <div className="shrink-0 flex items-center justify-end">{control}</div>
      </div>
      {!last && (
        <div
          // 卡片内部行分隔线：全宽不缩进，与快捷键卡片一致
          style={{ height: 1, background: '#f0f0f0', marginLeft: 16, marginRight: 16 }}
          aria-hidden
        />
      )}
    </div>
  )
}

// ==================================================
// 控件 A：Select 下拉（自绘，不依赖 shadcn 组件）
//   30px 高 · 220px 宽（截图右侧下拉框宽度） · 8px 圆角 · 右侧 ChevronDown 14
//
//   ★ 关键：下拉层通过 createPortal 挂载到 body
//     避免 SectionCard 的 overflow:hidden（圆角卡片）把底部最后一行的下拉选项裁剪掉。
//     用 trigger.getBoundingClientRect() 定位在 trigger 下方 4px，
//     打开后监听 resize / scroll 自动重新对齐，滚动后仍准确对齐。
// ==================================================
function Select<T extends string>({
  value,
  options,
  onChange,
  remBasePx
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  /** 当前字体档位的 rem 基准（13/14/16）。dropdown 经 portal 挂到 body，
      不继承弹壳的 font-size，需显式注入使下拉文字与 trigger 同步缩放。 */
  remBasePx: number
}) {
  // 状态机（纯逻辑，见 lib/select-list.ts）：open / activeIdx
  const valueIdx = Math.max(0, options.findIndex((o) => o.value === value))
  const [state, dispatch] = useReducer(selectListReducer, {
    open: false,
    activeIdx: valueIdx
  })
  const { open, activeIdx } = state
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  /** 下拉层绝对定位（相对于 viewport，已换算为滚动后的像素坐标） */
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null)
  const current = options.find((o) => o.value === value) ?? options[0]!

  // ---------- 对齐：根据 trigger 的 bbox 算出 dropdown 在 viewport 的绝对坐标 ----------
  const reposition = () => {
    const t = triggerRef.current
    if (!t) return
    const r = t.getBoundingClientRect()
    setPos({ left: r.left, top: r.bottom + 4, width: r.width })
  }

  // 打开瞬间强制对齐（useLayoutEffect 避免 portal 渲染完第一帧闪烁错位）
  useLayoutEffect(() => {
    if (!open) return
    reposition()
    // ----- 滚动 / 尺寸变化时自动重对齐：SettingsDialog 内部滚动会改变 trigger 位置 -----
    const onReflow = () => reposition()
    window.addEventListener('resize', onReflow)
    window.addEventListener('scroll', onReflow, true) // capture，命中内部滚动容器
    return () => {
      window.removeEventListener('resize', onReflow)
      window.removeEventListener('scroll', onReflow, true)
    }
  }, [open])

  // Esc 关闭（capture 阶段先于 Dialog 处理，避免被吞）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      dispatch({ type: 'ESC' })
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open])

  // Tab 焦点移出 trigger/dropdown 时关闭
  useEffect(() => {
    if (!open) return
    const onFocusOut = (e: FocusEvent) => {
      const target = e.relatedTarget as Node | null
      if (target && triggerRef.current?.contains(target)) return
      if (target && dropdownRef.current?.contains(target)) return
      dispatch({ type: 'CLOSE' })
    }
    document.addEventListener('focusout', onFocusOut)
    return () => document.removeEventListener('focusout', onFocusOut)
  }, [open])

  /** 提交选中：先 onChange 再关闭（同步，无 document 级竞态） */
  const commit = (v: T) => {
    onChange(v)
    dispatch({ type: 'CLOSE' })
  }

  return (
    <div className="relative shrink-0" style={{ width: 220 }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() =>
          open
            ? dispatch({ type: 'CLOSE' })
            : dispatch({ type: 'OPEN', selectedIndex: valueIdx })
        }
        onKeyDown={(e) => {
          // 聚焦 trigger 时 ↓/Enter/Space 开下拉，随后交给列表区键盘导航
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            dispatch({ type: 'OPEN', selectedIndex: valueIdx })
            return
          }
          if (open) {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              dispatch({ type: 'ARROW_DOWN', optionCount: options.length })
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              dispatch({ type: 'ARROW_UP', optionCount: options.length })
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const target = options[activeIdx]
              if (target) commit(target.value)
            }
          }
        }}
        className="flex items-center justify-between w-full px-3 bg-white text-left transition-colors hover:border-[#bfbfbf] focus:outline-none focus:ring-2 focus:ring-[#1677ff]/30"
        style={{
          height: 30,
          border: '1px solid #d9d9d9',
          borderRadius: 8,
          fontSize: pxToRem(13),
          color: '#262626'
        }}
      >
        <span className="truncate pr-2">{current.label}</span>
        <ChevronDown
          size={14}
          strokeWidth={2}
          stroke="#8c8c8c"
          className={cn('shrink-0 transition-transform', open && '-rotate-180')}
        />
      </button>

      {/* Portal 到 body，彻底绕开 SectionCard 的 overflow:hidden。
          关键：改用「backdrop 关闭层 + 下拉层」两个兄弟节点，而非 document 级
          mousedown 监听——彻底消除「点击选项时 document 先关、选项的
          onChange 丢失」的竞态（这是此前选不中的根因）。 */}
      {open && pos && typeof document !== 'undefined' && document.body &&
        createPortal(
          <>
            {/* 透明遮罩：点击任意外部区域关闭下拉（z 低于下拉层，不遮挡选项）。
                必须显式 pointerEvents:auto —— Radix Dialog 默认 modal 模式会把
                dialog 外的 body 内容设为 pointer-events:none（这正是下拉"看得到
                点不中"的根因），portal 到 body 的下拉层必须显式恢复。 */}
            <div
              className="fixed inset-0 z-[9998]"
              style={{ pointerEvents: 'auto' }}
              onMouseDown={(e) => {
                e.preventDefault()
                dispatch({ type: 'CLOSE' })
              }}
            />
            <div
              ref={dropdownRef}
              role="listbox"
              tabIndex={-1}
              aria-activedescendant={activeIdx >= 0 ? `sel-opt-${activeIdx}` : undefined}
              className="fixed z-[9999] overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.08)]"
              style={{
                left: pos.left,
                top: pos.top,
                width: pos.width,
                borderRadius: 8,
                border: '1px solid #f0f0f0',
                background: '#fff',
                // 关键（同 backdrop）：显式恢复 pointer events，否则 Radix modal
                // 的 pointer-events:none 会让选项无法被点击。
                pointerEvents: 'auto',
                // dropdown 挂在 body 下不继承弹壳的 rem 基准，显式注入当前档位
                // 的 1rem 值（13/14/16），内部 pxToRem 字号即可与 trigger 同步缩放。
                fontSize: remBasePx,
                lineHeight: 1
              }}
            >
              {options.map((o, i) => {
                const isSelected = o.value === value
                const isActive = i === activeIdx
                // 选中总是蓝底优先；未选中才应用 hover/键盘 active 淡蓝
                const bg = isSelected ? '#f0f7ff' : isActive ? '#f5f9ff' : '#fff'
                return (
                  <div
                    key={o.value}
                    id={`sel-opt-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      commit(o.value)
                    }}
                    onMouseEnter={() => dispatch({ type: 'HOVER', index: i })}
                    className="cursor-pointer px-3 transition-colors"
                    style={{
                      height: 32,
                      lineHeight: '32px',
                      fontSize: pxToRem(13),
                      color: isSelected ? '#1677ff' : '#262626',
                      background: bg
                    }}
                  >
                    {o.label}
                  </div>
                )
              })}
            </div>
          </>,
          document.body
        )}
    </div>
  )
}

// ==================================================
// 控件 B：Switch 开关（对标截图圆角 Pill 风格）
// ==================================================
function Switch({
  checked,
  onCheckedChange
}: {
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1677ff]/40'
      )}
      style={{
        width: 30,
        height: 17,
        background: checked ? '#52c41a' : '#d9d9d9'
      }}
    >
      <span
        className="pointer-events-none inline-block transform rounded-full bg-white transition-transform duration-200"
        style={{
          width: 13,
          height: 13,
          marginLeft: 2,
          transform: `translateX(${checked ? 13 : 0}px)`,
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
        }}
      />
    </button>
  )
}

// ==================================================
// 控件 C：快捷键标签 Alt + V
// ==================================================
function HotkeyTag({ keys }: { keys: string[] }) {
  return (
    <div className="flex items-center gap-1 select-none">
      {keys.map((k, i) => (
        <span key={`${k}-${i}`} className="contents">
          <span
            className="inline-flex items-center justify-center"
            style={{
              fontSize: pxToRem(12),
              minWidth: 24,
              height: 22,
              padding: '0 6px',
              borderRadius: 5,
              background: '#fff',
              border: '1px solid #d9d9d9',
              color: '#595959',
              fontFamily: 'ui-sans-serif, system-ui, -apple-system',
              boxShadow: 'inset 0 -1px 0 #f0f0f0'
            }}
          >
            {k}
          </span>
          {i < keys.length - 1 && (
            <span style={{ fontSize: pxToRem(12), color: '#bfbfbf', padding: '0 2px' }}>
              +
            </span>
          )}
        </span>
      ))}
    </div>
  )
}

// ==================================================
// 控件 D：路径选择框 + 更改按钮
//   宽度 340（与截图的路径比例一致）
//   左 8px 圆角（右 0）· 右「更改」按钮 8px 圆角（左 0）
// ==================================================
function PathPicker({
  value,
  onChange
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    // 期望 340px，但绝不允许超出所在行宽：maxWidth 兜底 + 允许 flex 收缩
    <div className="flex items-stretch" style={{ width: 340, maxWidth: '100%', minWidth: 0 }}>
      <div
        className="flex items-center gap-2 px-3 bg-white min-w-0"
        style={{
          flex: '1 1 0%',
          height: 30,
          border: '1px solid #d9d9d9',
          borderRight: 'none',
          borderRadius: '8px 0 0 8px',
          fontSize: pxToRem(12),
          color: '#595959'
        }}
        title={value}
      >
        <FolderOpen size={13} stroke="#8c8c8c" strokeWidth={1.8} className="shrink-0" />
        <span className="truncate min-w-0 flex-1">{value}</span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        style={{
          height: 30,
          paddingLeft: 14,
          paddingRight: 14,
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          borderTopRightRadius: 8,
          borderBottomRightRadius: 8,
          fontSize: pxToRem(13)
        }}
        onClick={() => {
          const next = window.prompt('请输入新的存储路径', value)
          if (typeof next === 'string' && next.trim()) onChange(next.trim())
        }}
      >
        更改
      </Button>
    </div>
  )
}
