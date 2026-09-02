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

import { useState, type ReactNode } from 'react'
import {
  ChevronDown,
  Settings as SettingsGear,
  FolderOpen
} from 'lucide-react'
import { useSetAtom } from 'jotai'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useAppStore, type ThemeMode, type Language, type FontSizeMode } from '@/stores/useAppStore'
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
  { value: 'small', label: '紧凑（13px）' },
  { value: 'medium', label: '默认（14px）' },
  { value: 'large', label: '舒适（16px）' }
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
              onChange={(v) => setLanguage(v as Language)}
            />
          }
        />
        <SettingRow
          index={2}
          title="字体大小"
          subtitle="调整界面整体字号基准，16px 舒适档同时放大对话区 Markdown"
          control={
            <Select
              value={fontSize}
              options={FONT_SIZE_OPTIONS}
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
            <Select value={linkOpen} options={LINK_OPEN_OPTIONS} onChange={setLinkOpen} />
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
      style={{ fontSize: 14, color: '#262626', marginTop: 32, marginBottom: 16 }}
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
            style={{ fontSize: 14, color: '#262626', lineHeight: '20px', fontWeight: 500 }}
          >
            {title}
          </span>
          {subtitle && (
            <span
              className="mt-1 truncate"
              style={{ fontSize: 12, color: '#8c8c8c', lineHeight: '18px' }}
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
// ==================================================
function Select<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value) ?? options[0]!
  return (
    <div className="relative shrink-0" style={{ width: 220 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        className="flex items-center justify-between w-full px-3 bg-white text-left transition-colors hover:border-[#bfbfbf]"
        style={{
          height: 30,
          border: '1px solid #d9d9d9',
          borderRadius: 8,
          fontSize: 13,
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
      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-[34px] z-20 w-full overflow-hidden bg-white shadow-[0_2px_12px_rgba(0,0,0,0.08)]"
          style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}
        >
          {options.map((o) => (
            <div
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(o.value)
                setOpen(false)
              }}
              className="cursor-pointer px-3 transition-colors"
              style={{
                height: 32,
                lineHeight: '32px',
                fontSize: 13,
                color: o.value === value ? '#1677ff' : '#262626',
                background: o.value === value ? '#f0f7ff' : '#fff'
              }}
            >
              {o.label}
            </div>
          ))}
        </div>
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
            className="inline-flex items-center justify-center text-[12px]"
            style={{
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
            <span className="text-[12px]" style={{ color: '#bfbfbf', padding: '0 2px' }}>
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
          fontSize: 12,
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
          fontSize: 13
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
