// ============================================================
// InputArea — 输入区域核心组件（web pro 视觉重构版）
//
// DOM 结构（自外向内，精准还原 web pro 模式）：
//   .pro-input-area
//     .pro-input-inner
//       └─ .pro-input-card (20px 圆角 / 分层阴影 / focus-within border+shadow)
//            ├─ .pro-input-status-row   运行时状态（ComposerRuntimeStatus + skill badge）
//            ├─ .pro-input-attachments  图片缩略图（可选）
//            ├─ .pro-input-main         FileAwareEditor（16px / 24px / 14px 20px 8px）
//            └─ .pro-input-toolbar
//                 ├─ .pro-input-toolbar-left  圆形「+」更多工具按钮
//                 └─ .pro-input-toolbar-right  模型选择 + 麦克风（disabled）+ 发送/停止
//      └─ 字符上限提示
//
// 保留全部 desktop 端功能特性：
//   - 图片附件（粘贴 / 拖拽 / 按钮添加）与预览
//   - FileAwareEditor（@ 文件引用 / / 快捷命令 弹层）
//   - 模型选择、Agent 模式切换、草稿持久化
//   - 拖拽高亮、字符上限校验
// ============================================================

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import {
  ArrowUp,
  Check,
  ChevronDown,
  ClipboardCheck,
  CornerDownLeft,
  FileText,
  HelpCircle,
  Image as ImageIcon,
  Mic,
  Plus,
  ShieldCheck,
  Square,
  X,
  Zap
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { fileApi, notificationApi } from '@/services/ipc'
import { useSetAtom } from 'jotai'
import { settingsOpenAtom, settingsCategoryAtom } from '@/stores/atoms'
import type { ImageAttachment } from '@/lib/input/image-attachments'
import {
  fileToImageAttachment,
  getPastedImageFiles,
  QUEUED_IMAGE_ONLY_TEXT
} from '@/lib/input/image-attachments'
import {
  deserializeEditorState,
  type SelectedFileItem
} from '@/lib/input/select-file-editor'
import { getSelectFileMentionQuery } from '@/lib/input/select-file-tags'
import { getDroppedLocalPaths } from '@/lib/input/drag-folder'
import { getSessionInputDraftKey } from '@/lib/input/input-drafts'

import { useInputDraftPersistence } from '@/hooks/use-input-draft-persistence'
import { useChatStore } from '@/stores/chatStore'
import { useHitlStore } from '@/stores/hitlStore'
import { useAppStore } from '@/stores/useAppStore'
import { resolveBinding } from '../../../../../shared/hotkey-registry'
import { matchesAccelerator } from '@/lib/match-accelerator'
import { FileAwareEditor, type FileAwareEditorHandle } from './FileAwareEditor'
import {
  CommandPalette,
  PALETTE_COMMANDS,
  filterPaletteCommands,
  groupPaletteCommands,
  flattenPaletteGroups,
  type PaletteCommand,
  type PaletteVisibleGroup
} from './CommandPalette'
import { FileSearchPopover } from './FileSearchPopover'
import { ImagePreview } from './ImagePreview'
import { ComposerRuntimeStatus } from './ComposerRuntimeStatus'
import './pro-input.css'

export interface InputAreaSendOptions {
  images?: ImageAttachment[]
  selectedFiles?: string[]
  skill?: string | null
  model?: string
}

/**
 * HITL 内联澄清条状态。
 * 非空时输入框进入"澄清应答"语义：提交内容作为澄清回答回传 Agent，
 * 而不是发起新的对话请求（对应设计文档 ClarifyingInputPanel 的落地形态）。
 */
export interface InputAreaHitlState {
  kind: 'tool_confirm' | 'clarifying' | 'choice' | 'plan_confirm'
  /** 澄清问题文本 */
  question?: string
  /** 兜底提示文案 */
  message?: string
  /** 候选选项（有值时渲染编号选项列表，点击直接作答；无值时仅自由文本输入） */
  options?: Array<{ id: string; label: string; description?: string }>
  /** kind='tool_confirm' 时携带待审批的工具调用（编号 + 工具名 + 参数） */
  toolCalls?: Array<{ id: string; name: string; args?: Record<string, unknown> }>
  /** kind='plan_confirm' 时携带待确认的产物文件（spec.md/tasks.md 等） */
  artifacts?: Array<{ name: string; path?: string }>
  /** 当前项在队列中的序号（从 1 开始） */
  index?: number
  /** 队列总项数 */
  total?: number
}

export interface InputAreaProps {
  /** 关联会话 ID（用于草稿键） */
  sessionId?: string | null
  /** 发送回调（文本 + 图片 + 选项） */
  onSend: (text: string, images?: ImageAttachment[], options?: InputAreaSendOptions) => void
  /** 停止流式输出 */
  onStop?: () => void
  /** 是否正在流式输出 */
  isStreaming?: boolean
  /** 是否禁用输入 */
  disabled?: boolean
  /** Agent 模式（透传给 SkillsMenu） */
  agentMode?: boolean
  /** 切换 Agent 模式 */
  onToggleAgent?: () => void
  /** 欢迎页态：输入卡片使用增强阴影引导关注 */
  isWelcome?: boolean
  /**
   * HITL 精简态（阶段三 3.4）：命中时省略 ModelSelect、Agent badge、`/` 命令、技能，
   * `+` 仅附件、仅 `↑` 发送，并禁用草稿持久化。
   */
  mode?: 'normal' | 'hitl'
  /** HITL 待答复项（有值时在输入框上方渲染内嵌卡并接管提交语义） */
  hitl?: InputAreaHitlState | null
  /** 最近一次答复/恢复失败的可见原因（由 hitlStore 透传，卡片内展示） */
  hitlError?: string | null
  /** 内联澄清条提交（自由文本回答） */
  onHitlAnswer?: (text: string) => void
  /** 点选候选选项（以选项 id 作答，立即提交） */
  onHitlSelectOption?: (optionId: string) => void
  /** 跳过当前澄清问题（仅 clarifying/choice 生效） */
  onHitlSkip?: () => void
  /** 工具审批-批准（可携带按 tool_call_id 覆盖的修改参数；返回 false 表示恢复未启动） */
  onHitlApprove?: (
    modifiedArgs: Record<string, Record<string, unknown>> | null
  ) => void | Promise<boolean>
  /** 工具审批-拒绝（approved=false 恢复；返回 false 表示恢复未启动） */
  onHitlReject?: () => void | Promise<boolean>
  /** 工具审批-取消（放弃整个 run，等价旧弹窗点遮罩/ESC） */
  onHitlDismiss?: () => void
  /** 方案确认门-执行此方案（kind='plan_confirm'，批准继续） */
  onHitlConfirmPlan?: () => void
}

const CHAR_LIMIT = 10000

/**
 * 方案确认门（kind='plan_confirm'）的固定说明语。
 * 当前为 UI-only 形态（后端尚无 plan_confirm 生产节点），说明语先内置；
 * 后端接入后如需按场景定制，可把该文案并入 interrupt 载荷（如 message 字段）。
 */
const PLAN_CONFIRM_HINT = '如果不符合预期，可以在输入框中输入指导要求（暂不支持在线编辑）。'
/** 方案确认门缺省问题文案（载荷未给 question/message 时兜底） */
const PLAN_CONFIRM_FALLBACK_QUESTION = '文档已生成，是否基于该方案继续执行？'

/**
 * dev-only mock 数据：/mock-plan 命令在当前会话入队的方案确认门载荷。
 * 对齐参考设计（TRAE Spec 模式三件套），后端 plan_confirm 节点接入后删除此 mock。
 */
const MOCK_PLAN_CONFIRM_QUESTION = '文档已经生成，请问是否要基于文档继续执行？'
const MOCK_PLAN_CONFIRM_ARTIFACTS = [
  { name: 'spec.md' },
  { name: 'tasks.md' },
  { name: 'checklist.md' }
]

/** 计算 `/` 触发的 Slash 命令查询（对应规范 §10.1） */
function getSlashQuery(
  text: string,
  cursor: number
): { start: number; end: number; query: string } | null {
  const before = text.slice(0, cursor)
  const m = before.match(/(?:^|\s)\/([^\s/]*)$/)
  if (!m) return null
  const start = m.index! + (m[0].length - m[1]!.length - 1)
  return { start, end: cursor, query: m[1]! }
}

// ============================================================
// 模型选择器
// ============================================================
const DEFAULT_MODEL = 'Auto'
const MODEL_OPTIONS: { label: string; value: string }[] = [
  { label: 'Auto', value: 'Auto' },
  { label: 'DeepSeek V4 Flash', value: 'deepseek-v4-flash' },
  { label: 'DeepSeek V4 Pro', value: 'deepseek-v4-Pro' },
  { label: 'GLM 5.2', value: 'GLM-5.2' },
  { label: 'Kimi K3', value: 'Kimi-K3' },
  { label: 'MiniMax M3', value: 'MiniMax-M3' },
  { label: '配置模型', value: '配置模型' },
]

function ModelSelect({
  value,
  onChange,
  disabled
}: {
  value: string
  onChange: (model: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const isCustomMode = value === '配置模型' || (custom.length > 0 && value === custom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsCategory = useSetAtom(settingsCategoryAtom)

  const handleSelect = (optValue: string) => {
    if (optValue === '配置模型') {
      setSettingsCategory('model')
      setSettingsOpen(true)
      setOpen(false)
      return
    }
    onChange(optValue)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="pro-input-model-btn"
              disabled={disabled}
            >
              <span>{isCustomMode && custom ? custom : value === '配置模型' ? '配置模型' : value}</span>
              <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>选择模型</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side="top" sideOffset={4} alignOffset={0} avoidCollisions={true} className="pro-input-more-pop min-w-[200px]">
        {MODEL_OPTIONS.slice(0, 6).map((opt) => (
          <DropdownMenuItem key={opt.value} onSelect={() => handleSelect(opt.value)}>
            <span>{opt.label}</span>
            {value === opt.value && <Check className="ml-auto size-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {MODEL_OPTIONS.slice(6).map((opt) => (
          <DropdownMenuItem key={opt.value} onSelect={() => handleSelect(opt.value)}>
            <span>{opt.label}</span>
            {value === opt.value && <Check className="ml-auto size-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
        {isCustomMode && (
          <div
            className="flex items-center gap-2 border-t px-2 py-2"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value)
                onChange(e.target.value)
              }}
              placeholder="输入模型名称"
              className="h-7 w-full rounded-md border bg-background px-2 text-xs outline-none focus:border-primary"
            />
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ============================================================
// HitlToolConfirmPanel — 工具审批内嵌卡（审批从模态弹窗迁入输入框上方）
//
// 能力与旧 HitlToolConfirmDialog 一一对应，不丢失任何交互：
//   - 工具列表：编号 + 工具名 + 参数单行摘要，点击行展开完整 JSON；
//   - 每个工具可独立切换"修改参数"（JSON textarea；批准时解析失败的项保持原参）；
//   - 拒绝（approved=false 恢复，图走拒绝分支）/ 批准并继续（可携带 modifiedArgs）；
//   - 右上 × = 放弃整个 run（等价旧弹窗点遮罩/ESC → abort）；
//   - resume 进行中按钮禁用防重复提交；恢复失败原因由 error 展示，可重试。
// 组件随审批项条件挂载/卸载，展开/改参等本地编辑状态天然按项隔离。
// ============================================================
function HitlToolConfirmPanel({
  hitl,
  error,
  onApprove,
  onReject,
  onDismiss
}: {
  hitl: InputAreaHitlState
  error?: string | null
  onApprove: (
    modifiedArgs: Record<string, Record<string, unknown>> | null
  ) => void | Promise<boolean>
  onReject: () => void | Promise<boolean>
  onDismiss: () => void
}) {
  const toolCalls = hitl.toolCalls ?? []
  const [resolving, setResolving] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [editMode, setEditMode] = useState<Record<string, boolean>>({})
  // 每个工具的「修改后参数」JSON 文本（初始为原参数格式化）
  const [argEdits, setArgEdits] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const tc of toolCalls) init[tc.id] = JSON.stringify(tc.args ?? {}, null, 2)
    return init
  })

  // 收集处于改参态且 JSON 合法的覆盖项（按 tool_call_id 索引；解析失败的项忽略，保持原参）
  const collectModifiedArgs = (): Record<string, Record<string, unknown>> | null => {
    let modifiedArgs: Record<string, Record<string, unknown>> | null = null
    for (const tc of toolCalls) {
      if (!editMode[tc.id]) continue
      try {
        const parsed = JSON.parse(argEdits[tc.id] ?? '')
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          modifiedArgs ??= {}
          modifiedArgs[tc.id] = parsed as Record<string, unknown>
        }
      } catch {
        // JSON 解析失败：保持原参（与旧模态弹窗行为一致）
      }
    }
    return modifiedArgs
  }

  // 仅当恢复未真正启动（返回 false）时解除忙碌态；成功时当前项卸载，无需复位
  const runAction = useCallback(async (action: () => void | Promise<boolean>) => {
    if (resolving) return
    setResolving(true)
    const ok = await action()
    if (ok === false) setResolving(false)
  }, [resolving])

  return (
    <div className="pro-input-hitl-panel">
      <div className="pro-input-hitl-header">
        <ShieldCheck className="size-4 shrink-0 text-amber-500" />
        <span className="pro-input-hitl-question">需要你的确认</span>
        {!!hitl.index && (
          <span className="pro-input-hitl-index">
            {hitl.index}
            {hitl.total ? `/${hitl.total}` : ''}
          </span>
        )}
        <button
          type="button"
          className="pro-input-hitl-skip"
          onClick={onDismiss}
          aria-label="取消并中止本次执行"
          title="取消并中止本次执行"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <p className="pro-input-hitl-tool-desc">
        {hitl.message || 'Agent 请求执行以下操作，请确认是否批准。'}
      </p>

      {/* 待审批工具列表：默认折叠为单行摘要，展开后查看完整参数 / 修改参数 */}
      <div className="pro-input-hitl-tools">
        {toolCalls.map((tc, i) => {
          const isOpen = !!expanded[tc.id]
          const isEdit = !!editMode[tc.id]
          return (
            <div key={tc.id} className="pro-input-hitl-tool">
              <button
                type="button"
                className="pro-input-hitl-tool-head"
                onClick={() => setExpanded((prev) => ({ ...prev, [tc.id]: !prev[tc.id] }))}
                aria-expanded={isOpen}
              >
                <span className="pro-input-hitl-tool-no" aria-hidden>
                  {i + 1}
                </span>
                <span className="pro-input-hitl-tool-name">{tc.name}</span>
                <span className="pro-input-hitl-tool-args-summary">
                  {JSON.stringify(tc.args ?? {})}
                </span>
                <ChevronDown
                  className={cn('pro-input-hitl-tool-chevron', isOpen && 'is-open')}
                  aria-hidden
                />
              </button>
              {isOpen && (
                <div className="pro-input-hitl-tool-body">
                  <pre className="pro-input-hitl-tool-args">
                    {JSON.stringify(tc.args ?? {}, null, 2)}
                  </pre>
                  <button
                    type="button"
                    className="pro-input-hitl-tool-edit-toggle"
                    onClick={() => setEditMode((prev) => ({ ...prev, [tc.id]: !prev[tc.id] }))}
                  >
                    <ChevronDown
                      className={cn('size-3.5 transition-transform', isEdit && 'rotate-180')}
                      aria-hidden
                    />
                    修改参数
                  </button>
                  {isEdit && (
                    <textarea
                      spellCheck={false}
                      className="pro-input-hitl-tool-edit"
                      value={argEdits[tc.id] ?? ''}
                      onChange={(e) =>
                        setArgEdits((prev) => ({ ...prev, [tc.id]: e.target.value }))
                      }
                      aria-label={`${tc.name} 修改后参数（JSON）`}
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {error && <p className="pro-input-hitl-error">{error}</p>}

      <div className="pro-input-hitl-divider" aria-hidden />

      <div className="pro-input-hitl-actions">
        <button
          type="button"
          className="pro-input-hitl-btn is-reject"
          onClick={() => void runAction(onReject)}
          disabled={resolving}
        >
          拒绝
        </button>
        <button
          type="button"
          className="pro-input-hitl-btn is-approve"
          onClick={() => void runAction(() => onApprove(collectModifiedArgs()))}
          disabled={resolving}
        >
          {resolving ? '处理中…' : '批准并继续'}
        </button>
      </div>
    </div>
  )
}

// ============================================================
// InputArea 主组件
// ============================================================
export function InputArea({
  sessionId,
  onSend,
  onStop,
  isStreaming = false,
  disabled = false,
  agentMode = false,
  onToggleAgent,
  isWelcome = false,
  mode = 'normal',
  hitl = null,
  hitlError = null,
  onHitlAnswer,
  onHitlSelectOption,
  onHitlSkip,
  onHitlApprove,
  onHitlReject,
  onHitlDismiss,
  onHitlConfirmPlan
}: InputAreaProps) {
  const editorRef = useRef<FileAwareEditorHandle>(null)
  const [text, setText] = useState('')
  // M2 快捷键引擎：发送/换行绑定（主进程 SOT 的缓存）
  const hotkeyOverrides = useAppStore((s) => s.hotkeys)
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([])
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [model, setModel] = useState<string>(DEFAULT_MODEL)
  const [focused, setFocused] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  // ---- HITL 精简态（阶段三 3.4）----
  const hitlMode = mode === 'hitl'
  // 工具审批已内嵌为审批卡（approve/reject/modified_args 在卡内完成），
  // 不再需要文本输入：审批态隐藏编辑区与工具栏；澄清/多选仍由输入框承接自由文本。
  const hitlAnswerable = !!hitl && hitl.kind !== 'tool_confirm'
  const hitlLocked = !!hitl && hitl.kind === 'tool_confirm'
  // 候选选项：有值时渲染编号列表（点击即作答），为空时退化为纯自由文本澄清
  const hitlOptions = hitl?.options ?? []
  // 方案确认门的产物文件（spec.md/tasks.md/checklist.md 等）
  const hitlArtifacts = hitl?.artifacts ?? []

  // ---- 弹出层状态 ----
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashTrigger, setSlashTrigger] = useState<{ start: number; end: number; query: string } | null>(null)
  const [slashActiveIndex, setSlashActiveIndex] = useState(0)
  // 「+」触发的同一面板（plus 模式）：查询由面板内置搜索框驱动
  const [plusOpen, setPlusOpen] = useState(false)
  const [plusQuery, setPlusQuery] = useState('')
  const [plusActiveIndex, setPlusActiveIndex] = useState(0)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionTrigger, setMentionTrigger] = useState<{ start: number; end: number; query: string } | null>(null)
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)

  // ---- 派生：已附加文件（从文本解析，保持单一数据源）----
  const selectedFiles = useMemo<SelectedFileItem[]>(() => deserializeEditorState(text).files, [text])

  // ---- 统一命令面板：单一注册表，「/」与「+」共用 ----
  // HITL 精简态（阶段三 3.4）：「+」仅保留附件动作，与既有约束一致
  const paletteCommands = useMemo<PaletteCommand[]>(
    () => (hitlMode ? PALETTE_COMMANDS.filter((c) => c.actionId === 'attach-file') : PALETTE_COMMANDS),
    [hitlMode]
  )

  const slashGroups = useMemo<PaletteVisibleGroup[]>(
    () => groupPaletteCommands(filterPaletteCommands(paletteCommands, slashTrigger?.query ?? '')),
    [paletteCommands, slashTrigger]
  )
  const plusGroups = useMemo<PaletteVisibleGroup[]>(
    () => groupPaletteCommands(filterPaletteCommands(paletteCommands, plusQuery)),
    [paletteCommands, plusQuery]
  )
  // 跨组拍平索引：键盘 ↑↓ 与 ⌘N 直选共用
  const slashFlat = useMemo<PaletteCommand[]>(() => flattenPaletteGroups(slashGroups), [slashGroups])
  const plusFlat = useMemo<PaletteCommand[]>(() => flattenPaletteGroups(plusGroups), [plusGroups])

  // ---- @ 文件搜索结果 ----
  const mentionFiles = useMemo<SelectedFileItem[]>(() => {
    if (!mentionTrigger) return []
    const q = mentionTrigger.query.toLowerCase()
    return selectedFiles.filter(
      (f) => !q || f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)
    )
  }, [mentionTrigger, selectedFiles])

  // ---- 字符计数 ----
  const charCount = text.length
  const isNearLimit = charCount > CHAR_LIMIT * 0.9
  const isOverLimit = charCount > CHAR_LIMIT

  // ---- 触发查询重算（光标或文本变化）----
  const computeTriggers = useCallback(() => {
    // HITL 精简态：省略 `/` 命令与 `@` 文件引用弹层
    if (hitlMode) return
    const ed = editorRef.current
    if (!ed) return
    const { end } = ed.getSelectionOffsets()

    const slash = getSlashQuery(text, end)
    if (slash) {
      setSlashTrigger(slash)
      setSlashOpen(true)
      setSlashActiveIndex(0)
    } else {
      setSlashOpen(false)
      setSlashTrigger(null)
    }

    const mention = getSelectFileMentionQuery(text, end)
    if (mention) {
      setMentionTrigger(mention)
      setMentionOpen(true)
      setMentionActiveIndex(0)
    } else {
      setMentionOpen(false)
      setMentionTrigger(null)
    }
  }, [text, hitlMode])

  // ---- 图片附件 ----
  const addImages = useCallback(async (files: File[]) => {
    const results = await Promise.all(
      files.map((f) =>
        fileToImageAttachment(f).then(
          (a): { ok: true; value: ImageAttachment } | { ok: false; error: unknown } => ({ ok: true, value: a }),
          (error): { ok: false; error: unknown } => ({ ok: false, error })
        )
      )
    )
    const valid: ImageAttachment[] = []
    let sizeErrorMsg: string | null = null
    for (const r of results) {
      if (r.ok) {
        valid.push(r.value)
      } else {
        const msg = r.error instanceof Error ? r.error.message : String(r.error)
        if (msg.includes('上限')) sizeErrorMsg = msg
      }
    }
    if (valid.length) setAttachedImages((prev) => [...prev, ...valid])
    if (sizeErrorMsg) notificationApi.show({ title: '图片过大', body: sizeErrorMsg })
  }, [])

  const removeImage = useCallback((id: string) => {
    setAttachedImages((prev) => prev.filter((i) => i.id !== id))
  }, [])

  // ---- 文件插入 helper ----
  const insertFileTokens = useCallback((paths: string[]) => {
    if (paths.length === 0) return
    const tokens = paths.map((p) => `@{${p}}`).join(' ')
    const needsLeadingSpace = text.length > 0 && !text.endsWith(' ') && !text.endsWith('\n')
    editorRef.current?.insertText((needsLeadingSpace ? ' ' : '') + tokens + ' ')
  }, [text])

  // ---- 浏览并附加文件 ----
  const handleAttachFile = useCallback(async () => {
    try {
      const result = await fileApi.openDialog({
        title: '选择要引用的文件',
        properties: ['openFile', 'multiSelections']
      })
      if (result?.canceled || !result?.filePaths?.length) return
      insertFileTokens(result.filePaths)
    } catch {
      /* 文件对话框不可用时不阻断 */
    }
  }, [insertFileTokens])

  // ---- 粘贴图片 ----
  const handlePaste = useCallback(
    (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const imageFiles = getPastedImageFiles(e.clipboardData)
      if (imageFiles.length) {
        e.preventDefault()
        void addImages(imageFiles)
      }
    },
    [addImages]
  )

  // ---- 拖拽（文件/图片）----
  const handleDragOver = useCallback((e: ReactDragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setIsDragging(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: ReactDragEvent) => {
    const related = e.relatedTarget as Node | null
    if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback(
    (e: ReactDragEvent) => {
      setIsDragging(false)
      const paths = getDroppedLocalPaths(e.dataTransfer)
      if (paths.length) {
        e.preventDefault()
        insertFileTokens(paths)
        return
      }
      const imageFiles = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
      if (imageFiles.length) {
        e.preventDefault()
        void addImages(imageFiles)
      }
    },
    [insertFileTokens, addImages]
  )

  // ---- Agent 模式切换（命令面板「模式」动作与工具栏徽标共用）----
  const setAgentMode = useChatStore((s) => s.setAgentMode)
  const handleToggleAgent = useCallback(() => {
    setAgentMode(!agentMode)
    onToggleAgent?.()
  }, [agentMode, setAgentMode, onToggleAgent])

  // ---- dev-only：/mock-plan 在当前会话注入方案确认门（纯前端 UI 预览，不经后端）----
  const triggerMockPlanConfirm = useCallback(() => {
    if (!import.meta.env.DEV) return
    const sid = sessionId
    if (!sid) {
      notificationApi.show({ title: '无法模拟方案确认门', body: '请先进入或创建一个会话后再使用 /mock-plan' })
      return
    }
    const chat = useChatStore.getState()
    // 当前会话已有暂停项时不覆盖（避免打断正在处理的真实 HITL）
    if (chat.hitlPausedSessionId === sid) return
    chat.restoreHitlPause({
      sessionId: sid,
      kind: 'plan_confirm',
      message: MOCK_PLAN_CONFIRM_QUESTION,
      question: MOCK_PLAN_CONFIRM_QUESTION
    })
    useHitlStore.getState().enqueue({
      sessionId: sid,
      kind: 'plan_confirm',
      message: MOCK_PLAN_CONFIRM_QUESTION,
      question: MOCK_PLAN_CONFIRM_QUESTION,
      artifacts: MOCK_PLAN_CONFIRM_ARTIFACTS,
      origin: 'live'
    })
  }, [sessionId])

  // ---- 「+」面板开关 ----
  const openPlus = useCallback(() => {
    setPlusQuery('')
    setPlusActiveIndex(0)
    // 与「/」面板互斥
    setSlashOpen(false)
    setPlusOpen(true)
  }, [])

  const closePlus = useCallback(() => {
    setPlusOpen(false)
    setPlusQuery('')
    setPlusActiveIndex(0)
  }, [])

  // ---- 统一命令分发：「/」与「+」选择后共用同一入口 ----
  const applyCommand = useCallback(
    (cmd: PaletteCommand, source: 'slash' | 'plus') => {
      const trigger = source === 'slash' ? slashTrigger : null

      if (cmd.kind === 'insert' && cmd.slashName) {
        const token = `${cmd.slashName} `
        if (trigger) {
          editorRef.current?.replaceRange(trigger.start, trigger.end, token)
        } else {
          editorRef.current?.insertText(token)
        }
      } else if (cmd.actionId === 'attach-file') {
        // 动作型命令：先移除「/」触发片段，再执行动作
        if (trigger) editorRef.current?.replaceRange(trigger.start, trigger.end, '')
        void handleAttachFile()
      } else if (cmd.actionId === 'toggle-agent') {
        if (trigger) editorRef.current?.replaceRange(trigger.start, trigger.end, '')
        handleToggleAgent()
      } else if (cmd.actionId === 'mock-plan-confirm') {
        // dev-only：清掉 slash 触发片段后注入 mock 方案确认门
        if (trigger) editorRef.current?.replaceRange(trigger.start, trigger.end, '')
        triggerMockPlanConfirm()
      }

      if (source === 'slash') {
        setSlashOpen(false)
        setSlashTrigger(null)
      } else {
        closePlus()
        editorRef.current?.focus()
      }
    },
    [slashTrigger, handleAttachFile, handleToggleAgent, triggerMockPlanConfirm, closePlus]
  )

  // ---- plus 面板搜索框键盘导航（slash 模式焦点在 textarea，由 handleKeyDown 处理）----
  const handlePlusQueryKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closePlus()
        editorRef.current?.focus()
        return
      }
      if (plusFlat.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setPlusActiveIndex((i) => (i + 1) % plusFlat.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setPlusActiveIndex((i) => (i - 1 + plusFlat.length) % plusFlat.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        applyCommand(plusFlat[plusActiveIndex]!, 'plus')
        return
      }
      // ⌘/Ctrl + 数字：直选可见项（与面板右侧徽标一致）
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        const cmd = plusFlat[Number(e.key) - 1]
        if (cmd) {
          e.preventDefault()
          applyCommand(cmd, 'plus')
        }
      }
    },
    [plusFlat, plusActiveIndex, applyCommand, closePlus]
  )

  // ---- 应用 @ 文件引用 ----
  const applyMention = useCallback(
    (path: string) => {
      if (!mentionTrigger) return
      editorRef.current?.replaceRange(mentionTrigger.start, mentionTrigger.end, `@{${path}} `)
      setMentionOpen(false)
      setMentionTrigger(null)
    },
    [mentionTrigger]
  )

  // ---- 发送 ----
  const handleSend = useCallback(() => {
    const promptText = text.trim()

    // HITL 内联澄清：输入框提交的是"澄清回答"，不发起新的对话请求。
    // 这条分支是输入框 HITL 能力的关键——否则提交会落到 sendMessage，
    // 与后端仍处于 interrupt 的 run 冲突。
    if (hitlAnswerable) {
      // 方案确认门：空文本回车 = 执行此方案（与卡片上的 Enter 提示一致）；
      // 有文本则视为"其他"指导要求，作为澄清回答回传（未来由后端据意见修订后重新询问）
      if (!promptText) {
        if (hitl?.kind === 'plan_confirm') {
          onHitlConfirmPlan?.()
          editorRef.current?.focus()
        }
        return
      }
      onHitlAnswer?.(promptText)
      setText('')
      setAttachedImages([])
      clearDraftRef.current?.()
      editorRef.current?.focus()
      return
    }

    if (!promptText && attachedImages.length === 0) return

    const hasSlash = promptText.startsWith('/')
    const message =
      selectedSkill && !hasSlash
        ? `[Skill: ${selectedSkill}]\n${promptText}`
        : promptText || QUEUED_IMAGE_ONLY_TEXT

    onSend(
      message,
      attachedImages.length ? attachedImages : undefined,
      {
        selectedFiles: selectedFiles.map((f) => f.path),
        skill: selectedSkill,
        model
      }
    )

    setText('')
    setAttachedImages([])
    setSelectedSkill(null)
    setSlashOpen(false)
    setMentionOpen(false)
    setSlashTrigger(null)
    setMentionTrigger(null)
    closePlus()
    clearDraftRef.current?.()
    editorRef.current?.focus()
  }, [text, attachedImages, selectedSkill, selectedFiles, model, onSend, hitlAnswerable, hitl, onHitlAnswer, onHitlConfirmPlan, closePlus])

  // ---- 键盘导航 ----
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (slashOpen && slashFlat.length) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSlashActiveIndex((i) => (i + 1) % slashFlat.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSlashActiveIndex((i) => (i - 1 + slashFlat.length) % slashFlat.length)
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          applyCommand(slashFlat[slashActiveIndex]!, 'slash')
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setSlashOpen(false)
          return
        }
        // ⌘/Ctrl + 数字：直选可见项（与面板右侧徽标一致）
        if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
          const cmd = slashFlat[Number(e.key) - 1]
          if (cmd) {
            e.preventDefault()
            applyCommand(cmd, 'slash')
            return
          }
        }
      }

      if (mentionOpen && mentionFiles.length) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setMentionActiveIndex((i) => (i + 1) % mentionFiles.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setMentionActiveIndex((i) => (i - 1 + mentionFiles.length) % mentionFiles.length)
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          applyMention(mentionFiles[mentionActiveIndex]!.path)
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setMentionOpen(false)
          return
        }
      }

      // M2 快捷键引擎：发送/换行走可配置绑定（设置页「快捷键」可改绑）。
      // isComposing 检查保留（IME 输入中的 Enter 不发送）；
      // slash/mention 弹层已在上面的分支提前 return，不受影响。
      if (!e.nativeEvent.isComposing) {
        if (matchesAccelerator(e.nativeEvent, resolveBinding('send-message', hotkeyOverrides))) {
          e.preventDefault()
          handleSend()
          return
        }
        // 换行绑定命中时插入 \n（默认 Shift+Enter，textarea 原生行为一致）
        if (
          matchesAccelerator(
            e.nativeEvent,
            resolveBinding('newline-on-input', hotkeyOverrides)
          )
        ) {
          // 默认 Shift+Enter 是 textarea 原生行为，无需干预；
          // 仅当用户改绑到其它组合时才需要手动插入换行
          const nl = resolveBinding('newline-on-input', hotkeyOverrides)
          if (nl && nl !== 'Shift+Enter') {
            e.preventDefault()
            editorRef.current?.insertText('\n')
          }
        }
      }
    },
    [slashOpen, slashFlat, slashActiveIndex, mentionOpen, mentionFiles, mentionActiveIndex, applyCommand, applyMention, handleSend, hotkeyOverrides]
  )

  // ---- 草稿持久化（HITL 精简态禁用）----
  const draftKey = useMemo(() => getSessionInputDraftKey(sessionId ?? 'home'), [sessionId])
  const { clearDraft, scheduleSave } = useInputDraftPersistence({
    draftKey,
    enabled: !isStreaming && !hitlMode,
    isFocused: () => focused,
    skipWhenStreaming: true,
    getValue: () => ({
      text,
      images: attachedImages,
      skill: selectedSkill,
      selectedFiles
    }),
    onRestore: (d) => {
      setText(d.text)
      setAttachedImages(d.images)
      setSelectedSkill(d.skill)
    }
  })
  const clearDraftRef = useRef(clearDraft)
  clearDraftRef.current = clearDraft

  useEffect(() => {
    scheduleSave()
  }, [text, attachedImages, selectedSkill, model, scheduleSave])

  useEffect(() => {
    computeTriggers()
  }, [text, computeTriggers])

  // ---- 渲染 ----
  // HITL 澄清态提交的是文本回答（不携带新附件），锁定时整体不可发送
  const canSend = hitlAnswerable
    ? text.trim().length > 0 && !isOverLimit
    : (text.trim().length > 0 || attachedImages.length > 0) && !isOverLimit

  return (
    <div className="pro-input-area">
      <div className="pro-input-inner">
        {/* 统一命令面板：「/」与「+」共用；仅其中一种模式打开时渲染 */}
        <CommandPalette
          open={slashOpen || plusOpen}
          mode={slashOpen ? 'slash' : 'plus'}
          groups={slashOpen ? slashGroups : plusGroups}
          activeIndex={slashOpen ? slashActiveIndex : plusActiveIndex}
          query={plusQuery}
          onQueryChange={(q) => {
            setPlusQuery(q)
            setPlusActiveIndex(0)
          }}
          onQueryKeyDown={handlePlusQueryKeyDown}
          onHover={slashOpen ? setSlashActiveIndex : setPlusActiveIndex}
          onSelect={(cmd) => applyCommand(cmd, slashOpen ? 'slash' : 'plus')}
          onClose={() => {
            closePlus()
            editorRef.current?.focus()
          }}
        />

        {/* @ 文件搜索弹出层 */}
        <FileSearchPopover
          open={mentionOpen}
          files={mentionFiles}
          activeIndex={mentionActiveIndex}
          onHover={setMentionActiveIndex}
          onSelectFile={applyMention}
          onBrowse={handleAttachFile}
        />

        {/* 输入卡片 */}
        <div
          className={cn('pro-input-card', isDragging && 'is-dragging', isWelcome && 'is-welcome')}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* HITL 内嵌卡：工具审批 / 方案确认 / 需求澄清统一在输入框上方承接。
              各分支显式 `&& hitl` 守卫，保证分支内 hitl 非空（嵌套三元不跨分支保留收窄）。 */}
          {hitl?.kind === 'tool_confirm' && hitl ? (
            <HitlToolConfirmPanel
              hitl={hitl}
              error={hitlError}
              onApprove={async (modifiedArgs) => (await onHitlApprove?.(modifiedArgs)) ?? false}
              onReject={async () => (await onHitlReject?.()) ?? false}
              onDismiss={() => onHitlDismiss?.()}
            />
          ) : hitl?.kind === 'plan_confirm' && hitl ? (
            /* 方案确认门：问题 → 说明 → 产物文件 → 执行此方案（Enter）→ 分隔线 → 下方输入框输入"其他"指导要求 */
            <div className="pro-input-hitl-panel">
              <div className="pro-input-hitl-header">
                <ClipboardCheck className="size-4 shrink-0 text-primary" />
                <span className="pro-input-hitl-question">
                  {hitl.question || hitl.message || PLAN_CONFIRM_FALLBACK_QUESTION}
                </span>
                {!!hitl.index && (
                  <span className="pro-input-hitl-index">
                    {hitl.index}
                    {hitl.total ? `/${hitl.total}` : ''}
                  </span>
                )}
                {onHitlDismiss && (
                  <button
                    type="button"
                    className="pro-input-hitl-skip"
                    onClick={onHitlDismiss}
                    aria-label="取消并中止本次执行"
                    title="取消并中止本次执行（Esc）"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>

              <p className="pro-input-hitl-tool-desc">{PLAN_CONFIRM_HINT}</p>

              {/* 产物文件列表（path 未提供时仅展示，不支持点击打开） */}
              {hitlArtifacts.length > 0 && (
                <div className="pro-input-hitl-artifacts">
                  {hitlArtifacts.map((a) => (
                    <div key={a.name} className="pro-input-hitl-artifact" title={a.path ?? a.name}>
                      <FileText className="size-4 shrink-0 text-blue-500" aria-hidden />
                      <span className="pro-input-hitl-artifact-name">{a.name}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="pro-input-hitl-options">
                <button
                  type="button"
                  className="pro-input-hitl-option is-plan-approve"
                  onClick={() => onHitlConfirmPlan?.()}
                  title="基于该方案继续执行（Enter）"
                >
                  <span className="pro-input-hitl-option-text">
                    <span className="pro-input-hitl-option-label">是的，执行此方案</span>
                  </span>
                  <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </div>

              <div className="pro-input-hitl-divider" aria-hidden />
            </div>
          ) : hitl ? (
            <div className="pro-input-hitl-panel">
              <div className="pro-input-hitl-header">
                <HelpCircle className="size-4 shrink-0 text-primary" />
                <span className="pro-input-hitl-question">
                  {hitl.question || hitl.message || 'Agent 需要你补充信息后才能继续。'}
                </span>
                {!!hitl.index && (
                  <span className="pro-input-hitl-index">
                    {hitl.index}
                    {hitl.total ? `/${hitl.total}` : ''}
                  </span>
                )}
                {hitlAnswerable && onHitlSkip && (
                  <button
                    type="button"
                    className="pro-input-hitl-skip"
                    onClick={onHitlSkip}
                    aria-label="跳过该问题"
                    title="跳过该问题，按现有信息继续"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              {hitlAnswerable && hitlOptions.length > 0 && (
                <div className="pro-input-hitl-options" role="listbox" aria-label="候选方向">
                  {hitlOptions.map((opt, i) => (
                    <button
                      key={opt.id}
                      type="button"
                      role="option"
                      className="pro-input-hitl-option"
                      onClick={() => onHitlSelectOption?.(opt.id)}
                      title="选择该方向并发送"
                    >
                      <span className="pro-input-hitl-option-no" aria-hidden>
                        {i + 1}
                      </span>
                      <span className="pro-input-hitl-option-text">
                        <span className="pro-input-hitl-option-label">{opt.label}</span>
                        {opt.description && (
                          <span className="pro-input-hitl-option-desc">{opt.description}</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {hitlAnswerable && hitlOptions.length > 0 && (
                <div className="pro-input-hitl-divider" aria-hidden />
              )}
            </div>
          ) : null}

          {/* 状态行：运行时状态 + 选中技能 */}
          {(attachedImages.length > 0 || selectedSkill) && (
            <div className="pro-input-status-row">
              <ComposerRuntimeStatus imageCount={attachedImages.length} />
              {selectedSkill && (
                <span className="inline-flex items-center gap-1 rounded bg-violet-500/10 px-1.5 py-0.5 text-[11px] text-violet-500">
                  <ImageIcon className="size-3" />
                  {selectedSkill}
                </span>
              )}
            </div>
          )}

          {/* 图片缩略图 */}
          {attachedImages.length > 0 && (
            <ImagePreview images={attachedImages} onRemove={removeImage} className="pro-input-attachments" />
          )}

          {/* 工具审批态：文本编辑区与工具栏由审批卡的操作按钮取代，整体不渲染 */}
          {!hitlLocked && (
          <>
          {/* 文本编辑区 */}
          <div className="pro-input-main">
            <FileAwareEditor
              ref={editorRef}
              value={text}
              onChange={setText}
              onKeyDown={handleKeyDown}
              onKeyUp={computeTriggers}
              onSelect={computeTriggers}
              onPaste={handlePaste}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={
                hitl
                  ? hitl.kind === 'plan_confirm'
                    ? '输入其他指导要求…（暂不支持在线编辑）'
                    : hitlOptions.length > 0
                      ? '自定义描述…'
                      : '在此补充说明后发送…'
                  : '你想知道什么？@引用对话文件，/调用技能与指令'
              }
              disabled={disabled}
              maxHeight={200}
            />
          </div>

          {/* 工具栏 */}
          <div className="pro-input-toolbar">
            <div className="pro-input-toolbar-left">
              {/* 「+」与「/」共用豆包式全宽命令面板（CommandPalette） */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="pro-input-more-btn"
                    disabled={isStreaming}
                    aria-label="添加附件 / 工具"
                    aria-expanded={plusOpen}
                    aria-haspopup="listbox"
                    onClick={() => {
                      if (plusOpen) {
                        closePlus()
                        editorRef.current?.focus()
                      } else {
                        openPlus()
                      }
                    }}
                  >
                    <Plus className="size-[18px]" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>添加附件 / 工具</TooltipContent>
              </Tooltip>

              {agentMode && !hitlMode && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="pro-input-agent-badge">
                      <Zap className="size-3.5" />
                      <span>Agent</span>
                      <button
                        type="button"
                        className="pro-input-agent-close"
                        onClick={handleToggleAgent}
                        aria-label="关闭 Agent 模式"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>点击关闭 Agent 模式</TooltipContent>
                </Tooltip>
              )}
            </div>

            <div className="pro-input-toolbar-right">
              {/* HITL 精简态（阶段三 3.4）：省略 ModelSelect 与麦克风，仅 ↑ 发送 */}
              {!hitlMode && <ModelSelect value={model} onChange={setModel} disabled={isStreaming} />}

              {/* 麦克风：与 web pro 端一致，暂未开放 */}
              {!hitlMode && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        className="pro-input-toolbar-btn"
                        disabled
                      >
                        <Mic className="size-[18px]" />
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>语音输入即将上线</TooltipContent>
                </Tooltip>
              )}

              {isStreaming ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="pro-input-send-btn is-stop"
                      onClick={onStop}
                      aria-label="停止生成"
                    >
                      <Square size={16} className="fill-current" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>停止生成</TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="pro-input-send-btn"
                      onClick={handleSend}
                      disabled={!canSend || disabled}
                      aria-label={hitlAnswerable ? '提交澄清回答' : '发送'}
                    >
                      <ArrowUp size={18} strokeWidth={2.5} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{hitlAnswerable ? '提交澄清回答 (Enter)' : '发送 (Enter)'}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
          </>
          )}
        </div>

        {/* 字符超限提示 */}
        {(isNearLimit || isOverLimit) && charCount > 0 && (
          <div className="pro-input-limit">
            <span
              className={cn(
                isOverLimit ? 'font-medium text-destructive' : 'text-amber-500'
              )}
            >
              {charCount}/{CHAR_LIMIT}
            </span>
          </div>
        )}

        {/* AI 生成内容免责声明（仅聊天模式显示，欢迎页隐藏） */}
        {!isWelcome && (
          <div className="pro-input-disclaimer">内容由AI生成，仅供参考</div>
        )}
      </div>
      </div>
  )
}
