// ============================================================
// InputArea — 输入区域核心组件（对应设计规范 §2 整体布局）
//
// DOM 结构（自上而下，严格对齐规范 §2）：
//   <Composer>                        居中卡片：max-w-3xl / rounded-2xl / border / focus-within ring
//     ├─ Attachments (条件渲染)       图片缩略图行
//     ├─ Textarea                     FileAwareEditor：多行、自适应高度、resize-none
//     └─ Toolbar (flex justify-between)
//          ├─ Left：附件(Popover) + 模型选择 + 工具
//          └─ Right：快捷键提示 + 发送/停止按钮
//
// 组合能力：SlashCommandPopover（/ 命令）/ FileSearchPopover（@ 文件）/
// ImagePreview（图片附件）/ ComposerRuntimeStatus（状态栏）。
// 统一处理：发送、键盘导航、拖拽、粘贴、草稿持久化与 Token 估算。
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
import { ArrowUp, Square, Paperclip, Plus, ChevronDown, Check, ImageIcon, Zap, Terminal, Eraser, HelpCircle } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { fileApi, notificationApi } from '@/services/ipc'
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
import { useEstimatedTokens } from '@/hooks/use-estimated-tokens'
import { useInputDraftPersistence } from '@/hooks/use-input-draft-persistence'
import { FileAwareEditor, type FileAwareEditorHandle } from './FileAwareEditor'
import {
  SlashCommandPopover,
  BUILTIN_SLASH_COMMANDS,
  scoreSlashCommand,
  type SlashCommand
} from './SlashCommandPopover'
import { FileSearchPopover } from './FileSearchPopover'
import { ImagePreview } from './ImagePreview'
import { ComposerRuntimeStatus } from './ComposerRuntimeStatus'

export interface InputAreaSendOptions {
  images?: ImageAttachment[]
  selectedFiles?: string[]
  skill?: string | null
  model?: string
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
}

const CHAR_LIMIT = 10000

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
// 底部工具栏 — 对应规范 §2 Toolbar
// 左：附件/工具（合并单一下拉）+ 模型选择；右：发送/停止
// 以受控 props 接收状态与回调，保持 InputArea 主组件精简可维护。
// ============================================================
interface ComposerToolbarProps {
  canSend: boolean
  disabled: boolean
  isStreaming: boolean
  onSend: () => void
  onStop?: () => void
  // 左侧：附件
  onAttachFile: () => void
  // 左侧：工具
  agentMode: boolean
  onToggleAgent: () => void
  onInsertCommand: (command: string) => void
  // 模型选择（受控，状态上提到 InputArea 主组件）
  model: string
  onModelChange: (model: string) => void
}

function ComposerToolbar({
  canSend,
  disabled,
  isStreaming,
  onSend,
  onStop,
  onAttachFile,
  agentMode,
  onToggleAgent,
  onInsertCommand,
  model,
  onModelChange
}: ComposerToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1">
      {/* 左：附件(Popover) + 工具（对应原型：左侧仅附件图标） */}
      <div className="flex min-w-0 items-center gap-1.5">
        {/* 附件 / 工具：将「添加附件」与「技能菜单」合并为单一下拉（对应规范 §4.3 / §8） */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="muted"
              size="icon-sm"
              title="添加附件 / 工具"
              disabled={isStreaming}
              className="rounded-full"
            >
              <Plus />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            {/* 添加附件子菜单（上传文件 / 上传图片） */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Paperclip className="size-4" />
                <span>添加附件</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-40">
                <DropdownMenuItem onSelect={() => onAttachFile()}>
                  <Paperclip className="size-4" />
                  <span>上传文件</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAttachFile()}>
                  <ImageIcon className="size-4" />
                  <span>上传图片</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {/* 工具项（原 SkillsMenu 内容） */}
            <DropdownMenuItem onSelect={() => onAttachFile()}>
              <Paperclip className="size-4" />
              <span>附件</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onToggleAgent()}>
              <Zap className={cn('size-4', agentMode && 'text-primary')} />
              <span>模式{agentMode ? ' · Agent' : ''}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onInsertCommand('/agent')}>
              <Terminal className="size-4" />
              <span>技能</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAttachFile()}>
              <HelpCircle className="size-4" />
              <span>连接</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>快捷命令</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onInsertCommand('/clear')}>
              <Eraser className="size-4" />
              <span>清空对话</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onInsertCommand('/help')}>
              <HelpCircle className="size-4" />
              <span>帮助</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 右：快捷键提示 + 模型选择 + 发送/停止（对齐原型：模型在右、紧邻发送） */}
      <div className="flex shrink-0 items-center gap-3">
        {/* 模型选择（对齐原型 .model-btn，置于右侧发送之前） */}
        <ModelSelect value={model} onChange={onModelChange} disabled={isStreaming} />
        {isStreaming ? (
          // 停止按钮：原型 --stop-bg/--stop-fg 反相（Light 深底白图标 / Dark 白底深图标）
          <button
            type="button"
            onClick={onStop}
            title="停止生成"
            aria-label="停止生成"
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-full shadow-sm transition-colors',
              'bg-[#18181B] text-[#FFFFFF] hover:bg-[#27272A] active:scale-[.94]',
              'dark:bg-[#FAFAFA] dark:text-[#18181B] dark:hover:bg-[#E4E4E7]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#18181B]/40 dark:focus-visible:ring-[#FAFAFA]/40'
            )}
          >
            <Square className="size-4 fill-current" />
          </button>
        ) : (
          // 发送按钮：原型 Agent 紫（Light #6D28D9 / Dark #8B5CF6），空内容置灰
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend || disabled}
            title="发送 (Enter)"
            aria-label="发送"
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-full shadow-sm',
              'bg-[#6D28D9] text-white transition-[background-color,transform]',
              'hover:bg-[#5B21B6] active:bg-[#4C1D95] active:scale-[.94]',
              'dark:bg-[#8B5CF6] dark:hover:bg-[#7C3AED] dark:active:bg-[#6D28D9]',
              'disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              'dark:focus-visible:ring-[#8B5CF6]/50'
            )}
          >
            <ArrowUp className="size-[18px]" />
          </button>
        )}
      </div>
    </div>
  )
}

// ============================================================
// 模型选择器 — 独立管理展开态，避免主组件状态膨胀
// ============================================================
const MODEL_OPTIONS = ['DeepSeek-V4-Flash', '自定义'] as const

function ModelSelect({
  value,
  onChange,
  disabled
}: {
  /** 当前选中的模型（内置名或自定义名） */
  value: string
  /** 选中变化（内置名，或自定义输入框内容） */
  onChange: (model: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  // 处于自定义模式：选了“自定义”且尚未输入具体名称，或已输入名称
  const isCustomMode = value === '自定义' || (custom.length > 0 && value === custom)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="muted"
          size="sm"
          title="选择模型"
          disabled={disabled}
          className="rounded-full gap-1"
        >
          <span>{isCustomMode && custom ? custom : value === '自定义' ? '自定义模型' : value}</span>
          <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="min-w-[200px]">
        {MODEL_OPTIONS.map((model) => (
          <DropdownMenuItem key={model} onSelect={() => onChange(model)}>
            <span>{model === '自定义' ? '自定义模型' : `内置模型 · ${model}`}</span>
            {value === model && <Check className="ml-auto size-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
        {isCustomMode && (
          // onPointerDown 阻止冒泡，避免点击输入框导致下拉意外关闭
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
// InputArea 主组件
// ============================================================
export function InputArea({
  sessionId,
  onSend,
  onStop,
  isStreaming = false,
  disabled = false,
  agentMode = false,
  onToggleAgent
}: InputAreaProps) {
  const editorRef = useRef<FileAwareEditorHandle>(null)
  const [text, setText] = useState('')
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([])
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [model, setModel] = useState<string>(MODEL_OPTIONS[0])
  const [focused, setFocused] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  // ---- 弹出层状态 ----
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashTrigger, setSlashTrigger] = useState<{ start: number; end: number; query: string } | null>(null)
  const [slashActiveIndex, setSlashActiveIndex] = useState(0)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionTrigger, setMentionTrigger] = useState<{ start: number; end: number; query: string } | null>(null)
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)

  // ---- 派生：已附加文件（从文本解析，保持单一数据源）----
  const selectedFiles = useMemo<SelectedFileItem[]>(() => deserializeEditorState(text).files, [text])

  // ---- Slash 命令过滤（由 InputArea 统一计算后下发）----
  const slashCommands = useMemo<SlashCommand[]>(() => {
    if (!slashTrigger) return []
    const q = slashTrigger.query
    return BUILTIN_SLASH_COMMANDS.map((c) => ({ c, s: scoreSlashCommand(c.name, q) }))
      .filter((x) => x.s !== Infinity)
      .sort((a, b) => a.s - b.s)
      .map((x) => x.c)
  }, [slashTrigger])

  // ---- @ 文件搜索结果（从已附加文件过滤）----
  const mentionFiles = useMemo<SelectedFileItem[]>(() => {
    if (!mentionTrigger) return []
    const q = mentionTrigger.query.toLowerCase()
    return selectedFiles.filter(
      (f) => !q || f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)
    )
  }, [mentionTrigger, selectedFiles])

  // ---- Token 估算 / 字符计数 ----
  const tokens = useEstimatedTokens(text, attachedImages.length)
  const charCount = text.length
  const isNearLimit = charCount > CHAR_LIMIT * 0.9
  const isOverLimit = charCount > CHAR_LIMIT

  // ---- 触发查询重算（光标或文本变化）----
  const computeTriggers = useCallback(() => {
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
  }, [text])

  // ---- 图片附件 ----
  const addImages = useCallback(async (files: File[]) => {
    const results = await Promise.all(
      files.map((f) => fileToImageAttachment(f).then(
        (a): { ok: true; value: ImageAttachment } | { ok: false; error: unknown } => ({ ok: true, value: a }),
        (error): { ok: false; error: unknown } => ({ ok: false, error })
      ))
    )
    const valid: ImageAttachment[] = []
    let sizeErrorMsg: string | null = null
    for (const r of results) {
      if (r.ok) {
        valid.push(r.value)
      } else {
        // P4: 仅当超限（消息含“上限”）时收集文案并提示用户，其余错误静默忽略。
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

  // ---- 文件插入 helper（在光标处插入 @{path} 序列）----
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

  // ---- 应用 Slash 命令 ----
  const applySlash = useCallback(
    (cmd: SlashCommand) => {
      if (!slashTrigger) return
      editorRef.current?.replaceRange(slashTrigger.start, slashTrigger.end, `${cmd.name} `)
      setSlashOpen(false)
      setSlashTrigger(null)
    },
    [slashTrigger]
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
    clearDraftRef.current?.()
    editorRef.current?.focus()
  }, [text, attachedImages, selectedSkill, selectedFiles, model, onSend])

  // ---- 键盘导航 ----
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (slashOpen && slashCommands.length) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSlashActiveIndex((i) => (i + 1) % slashCommands.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSlashActiveIndex((i) => (i - 1 + slashCommands.length) % slashCommands.length)
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          applySlash(slashCommands[slashActiveIndex]!)
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setSlashOpen(false)
          return
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

      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        handleSend()
      }
    },
    [slashOpen, slashCommands, slashActiveIndex, mentionOpen, mentionFiles, mentionActiveIndex, applySlash, applyMention, handleSend]
  )

  // ---- 草稿持久化 ----
  const draftKey = useMemo(() => getSessionInputDraftKey(sessionId ?? 'home'), [sessionId])
  const { clearDraft, scheduleSave } = useInputDraftPersistence({
    draftKey,
    enabled: !isStreaming,
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

  // 内容（文本 / 图片 / 技能 / 模型）变化时去抖保存草稿，刷新或切换会话后恢复。
  // scheduleSave 内部已做 hydrated / 聚焦态 / 空草稿 守卫，无需在此重复判断。
  useEffect(() => {
    scheduleSave()
  }, [text, attachedImages, selectedSkill, model, scheduleSave])

  useEffect(() => {
    computeTriggers()
  }, [text, computeTriggers])

  // ---- 渲染 ----
  const canSend = (text.trim().length > 0 || attachedImages.length > 0) && !isOverLimit

  return (
    <div className="shrink-0 px-4 pb-6 pt-3">
      <div className="relative mx-auto w-full max-w-3xl">
        {/* Slash 命令弹出层（对应规范 §10.1） */}
        <SlashCommandPopover
          open={slashOpen}
          commands={slashCommands}
          activeIndex={slashActiveIndex}
          onHover={setSlashActiveIndex}
          onSelect={applySlash}
        />

        {/* @ 文件搜索弹出层（对应规范 §10.2） */}
        <FileSearchPopover
          open={mentionOpen}
          files={mentionFiles}
          activeIndex={mentionActiveIndex}
          onHover={setMentionActiveIndex}
          onSelectFile={applyMention}
          onBrowse={handleAttachFile}
        />

        {/* 输入卡片容器 — 对应规范 §2 / §3.3 / §3.5；主色采用原型 Agent 紫（局部，不改动全局主题） */}
        <div
          className={cn(
            'rounded-2xl border bg-card shadow-sm transition-colors',
            'focus-within:border-[#6D28D9]/50 focus-within:ring-2 focus-within:ring-[#6D28D9]/20',
            'dark:focus-within:border-[#8B5CF6]/50 dark:focus-within:ring-[#8B5CF6]/30',
            isDragging &&
              'border-[#6D28D9] bg-[#6D28D9]/5 dark:border-[#8B5CF6] dark:bg-[#8B5CF6]/5'
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* 附件区（图片缩略图）— 对应规范 §2 Attachments */}
          {attachedImages.length > 0 && (
            <ImagePreview images={attachedImages} onRemove={removeImage} className="px-3 pt-3" />
          )}

          {/* 文本编辑区 — 对应规范 §2 Textarea / §4.1 */}
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
            placeholder="你想知道什么？@引用对话文件，/调用技能与指令"
            disabled={disabled}
            className="px-3 py-2"
            maxHeight={200}
          />

          {/* 底部操作栏 — 对应规范 §2 Toolbar */}
          <ComposerToolbar
            canSend={canSend}
            disabled={disabled}
            isStreaming={isStreaming}
            onSend={handleSend}
            onStop={onStop}
            onAttachFile={handleAttachFile}
            agentMode={agentMode}
            onToggleAgent={() => onToggleAgent?.()}
            onInsertCommand={(cmd) => editorRef.current?.insertText(cmd + ' ')}
            model={model}
            onModelChange={setModel}
          />
        </div>

        {/* 字符超限提示（仅接近/超过上限时） */}
        {(isNearLimit || isOverLimit) && charCount > 0 && (
          <div className="flex justify-end px-1 pt-1.5">
            <span
              className={cn(
                'text-[11px] tabular-nums transition-colors',
                isOverLimit ? 'font-medium text-destructive' : 'text-amber-500'
              )}
            >
              {charCount}/{CHAR_LIMIT}
            </span>
          </div>
        )}

        {/* 底部状态 — 极简信息 */}
        <div className="flex items-center justify-between px-1 pt-2">
          <ComposerRuntimeStatus
            tokens={tokens}
            imageCount={attachedImages.length}
            agentMode={agentMode}
            charCount={charCount}
          />
          {selectedSkill && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-500">
              <ImageIcon className="size-3" />
              {selectedSkill}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
