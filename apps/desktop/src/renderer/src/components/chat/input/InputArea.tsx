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
  Image as ImageIcon,
  Mic,
  Paperclip,
  Plus,
  Square,
  Terminal,
  Zap
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'
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

import { useInputDraftPersistence } from '@/hooks/use-input-draft-persistence'
import { useChatStore } from '@/stores/chatStore'
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
import './pro-input.css'

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
// 模型选择器
// ============================================================
const DEFAULT_MODEL = 'deepseek-chat'
const MODEL_OPTIONS: { label: string; value: string }[] = [
  { label: 'DeepSeek Chat', value: DEFAULT_MODEL },
  { label: '自定义', value: '自定义' },
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
  const isCustomMode = value === '自定义' || (custom.length > 0 && value === custom)

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
              <span>{isCustomMode && custom ? custom : value === '自定义' ? '自定义模型' : value}</span>
              <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>选择模型</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side="top" className="pro-input-more-pop min-w-[200px]">
        {MODEL_OPTIONS.map((opt) => (
          <DropdownMenuItem key={opt.value} onSelect={() => onChange(opt.value)}>
            <span>{opt.label === '自定义' ? '自定义模型' : `内置模型 · ${opt.label}`}</span>
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
  const [model, setModel] = useState<string>(DEFAULT_MODEL)
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

  // ---- Slash 命令过滤 ----
  const slashCommands = useMemo<SlashCommand[]>(() => {
    if (!slashTrigger) return []
    const q = slashTrigger.query
    return BUILTIN_SLASH_COMMANDS
      .map((c) => ({ c, s: scoreSlashCommand(c.name, q) }))
      .filter((x) => x.s !== Infinity)
      .sort((a, b) => a.s - b.s)
      .map((x) => x.c)
  }, [slashTrigger])

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

  useEffect(() => {
    scheduleSave()
  }, [text, attachedImages, selectedSkill, model, scheduleSave])

  useEffect(() => {
    computeTriggers()
  }, [text, computeTriggers])

  // ---- 渲染 ----
  const canSend = (text.trim().length > 0 || attachedImages.length > 0) && !isOverLimit

  const setAgentMode = useChatStore((s) => s.setAgentMode)
  const handleToggleAgent = useCallback(() => {
    setAgentMode(!agentMode)
    onToggleAgent?.()
  }, [agentMode, setAgentMode, onToggleAgent])

  return (
    // 顶层包裹本地 TooltipProvider：RootLayout 的全局 Provider 仅覆盖 TopBarActions，
    // 而 InputArea 经 <Outlet/> 渲染、不在其内。Radix Tooltip 缺少 Provider 会在
    // 渲染期抛错导致整树白屏，故此处自包含一层（与 ConversationList/ContextPanel 一致）。
    <TooltipProvider>
      <div className="pro-input-area">
        <div className="pro-input-inner">
        {/* Slash 命令弹出层 */}
        <SlashCommandPopover
          open={slashOpen}
          commands={slashCommands}
          activeIndex={slashActiveIndex}
          onHover={setSlashActiveIndex}
          onSelect={applySlash}
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
          className={cn('pro-input-card', isDragging && 'is-dragging')}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* 状态行：运行时状态 + 选中技能 */}
          {(agentMode || attachedImages.length > 0 || selectedSkill) && (
            <div className="pro-input-status-row">
              <ComposerRuntimeStatus imageCount={attachedImages.length} agentMode={agentMode} />
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
              placeholder="你想知道什么？@引用对话文件，/调用技能与指令"
              disabled={disabled}
              maxHeight={200}
            />
          </div>

          {/* 工具栏 */}
          <div className="pro-input-toolbar">
            <div className="pro-input-toolbar-left">
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="pro-input-more-btn"
                        disabled={isStreaming}
                      >
                        <Plus className="size-[18px]" />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>添加附件 / 工具</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start" side="top" className="pro-input-more-pop w-56">
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Paperclip />
                      <span>添加附件</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-40">
                      <DropdownMenuItem onSelect={() => handleAttachFile()}>
                        <Paperclip />
                        <span>上传文件</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleAttachFile()}>
                        <ImageIcon />
                        <span>上传图片</span>
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem onSelect={() => handleAttachFile()}>
                    <Paperclip />
                    <span>附件</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleToggleAgent}>
                    <Zap className={cn('size-4', agentMode && 'text-primary')} />
                    <span>模式{agentMode ? ' · Agent' : ''}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => editorRef.current?.insertText('/agent ')}>
                    <Terminal />
                    <span>技能</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleAttachFile()}>
                    <HelpCircleIcon />
                    <span>连接</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="pro-input-toolbar-right">
              <ModelSelect value={model} onChange={setModel} disabled={isStreaming} />

              {/* 麦克风：与 web pro 端一致，暂未开放 */}
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
                      aria-label="发送"
                    >
                      <ArrowUp size={18} strokeWidth={2.5} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>发送 (Enter)</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
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
      </div>
      </div>
    </TooltipProvider>
  )
}

/** 临时小图标组件：避免因缺少 HelpCircle 导入而报错 */
function HelpCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  )
}
