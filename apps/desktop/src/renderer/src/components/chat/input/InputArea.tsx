// ============================================================
// InputArea — 输入区域核心组件（对应文档 §2）
// 整合 FileAwareEditor / SkillsMenu / Slash·File 弹出层 / 图片附件 /
// 草稿持久化 / Token 状态栏，统一处理发送、键盘、
// 拖拽与粘贴，并对外暴露与 ChatInput 兼容的 props。
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
import { Square, ImageIcon, Mic, ChevronDown, Check } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { fileApi } from '@/services/ipc'
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
import { SkillsMenu } from './SkillsMenu'
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

/** 计算 `/` 触发的 Slash 命令查询（对应文档 §10.1） */
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
  const [focused, setFocused] = useState(false)
  const [currentModel, setCurrentModel] = useState('DeepSeek-V4-Flash')
  const [modelOpen, setModelOpen] = useState(false)

  // ---- 弹出层状态 ----
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashTrigger, setSlashTrigger] = useState<{ start: number; end: number; query: string } | null>(null)
  const [slashActiveIndex, setSlashActiveIndex] = useState(0)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionTrigger, setMentionTrigger] = useState<{ start: number; end: number; query: string } | null>(null)
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

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
    const attachments = await Promise.all(
      files.map((f) => fileToImageAttachment(f).catch(() => null))
    )
    const valid = attachments.filter((a): a is ImageAttachment => !!a)
    if (valid.length) setAttachedImages((prev) => [...prev, ...valid])
  }, [])

  const removeImage = useCallback((id: string) => {
    setAttachedImages((prev) => prev.filter((i) => i.id !== id))
  }, [])

  // ---- 文件插入helper（在光标处插入 @{path} 序列）----
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
        skill: selectedSkill
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
  }, [text, attachedImages, selectedSkill, selectedFiles, onSend])

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

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [slashOpen, slashCommands, slashActiveIndex, mentionOpen, mentionFiles, mentionActiveIndex, applySlash, applyMention, handleSend]
  )

  // ---- 草稿持久化 ----
  const draftKey = useMemo(() => getSessionInputDraftKey(sessionId ?? 'home'), [sessionId])
  const { clearDraft } = useInputDraftPersistence({
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
    computeTriggers()
  }, [text, computeTriggers])

  // ---- 渲染 ----
  const canSend = (text.trim().length > 0 || attachedImages.length > 0) && !isOverLimit

  return (
    <div
      className="shrink-0 border-t border-border/50 bg-background px-4 pb-4 pt-3"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="relative max-w-[780px] mx-auto">
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

        {/* 输入卡片容器 — 参考原型 chat-input-box */}
        <div
          className={cn(
            'rounded-xl border bg-card shadow-sm transition-all duration-200 px-5 pt-4 pb-3.5',
            focused
              ? 'border-primary/30 shadow-[0_0_0_1px_rgba(79,70,229,0.08)]'
              : 'border-border/80 hover:border-muted-foreground/25',
            isDragging && 'border-primary/50 bg-primary/5'
          )}
        >
          {/* 图片附件（卡片内部） */}
          {attachedImages.length > 0 && (
            <ImagePreview images={attachedImages} onRemove={removeImage} className="-mx-5 px-5 pb-3 -mt-1" />
          )}

          {/* 文本编辑区域 — 原型：textarea 占满宽度 */}
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
            placeholder="帮你编写代码、调试 Bug、优化性能等开发工作，交付生产级代码产物。"
            disabled={disabled}
            className="flex-1 w-full min-w-0"
            maxHeight={240}
          />

          {/* 底部操作栏 — 参考原型 bottom-bar */}
          <div className="flex items-center justify-between gap-2 mt-3 min-w-0">
            {/* 左侧：工具菜单 — 原型 menu-dropdown */}
            <SkillsMenu
              onAttachFile={handleAttachFile}
              onToggleAgent={() => onToggleAgent?.()}
              onInsertCommand={(cmd) => editorRef.current?.insertText(cmd + ' ')}
              agentMode={agentMode}
              disabled={isStreaming}
            />

            {/* 右侧：模型选择 + 语音 + 发送 — 原型 right-controls */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* 模型选择器 — 原型 model-select */}
              <DropdownMenu open={modelOpen} onOpenChange={setModelOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    title="选择模型"
                  >
                    <span>{currentModel}</span>
                    <ChevronDown className={cn(modelOpen && 'rotate-180')} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" className="min-w-[180px]">
                  <DropdownMenuItem onSelect={() => setCurrentModel('DeepSeek-V4-Flash')}>
                    <span>内置模型 · DeepSeek-V4-Flash</span>
                    {currentModel === 'DeepSeek-V4-Flash' && (
                      <Check className="size-3.5 ml-auto text-primary" />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setCurrentModel('自定义')}>
                    <span>自定义</span>
                    {currentModel === '自定义' && (
                      <Check className="size-3.5 ml-auto text-primary" />
                    )}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* 语音输入按钮 — 原型 voice-btn */}
              <Button
                type="button"
                disabled={isStreaming}
                variant="ghost"
                size="icon-sm"
                title="语音输入"
              >
                <Mic />
              </Button>

              {/* 发送/停止按钮 — 原型 send-btn */}
              {isStreaming ? (
                <Button
                  onClick={onStop}
                  variant="destructive"
                  size="icon-sm"
                  title="停止生成"
                >
                  <Square />
                </Button>
              ) : (
                <Button
                  onClick={handleSend}
                  disabled={!canSend || disabled}
                  variant="default"
                  size="icon-sm"
                  title="发送 (Enter)"
                >
                  <svg
                    viewBox="340 308 368 418"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M505.6 320c-4.27 2.13-6.4 2.13-12.8 8.53l-153.6 153.6c-12.8 12.8-12.8 32 0 44.8 12.8 12.8 32 12.8 44.8 0l96-96V682.67c0 17.07 14.93 32 32 32s32-14.93 32-32V430.93l96 96c12.8 12.8 32 12.8 44.8 0s12.8-32 0-44.8l-153.6-153.6c-6.4-6.4-8.53-8.53-12.8-8.53s-8.53-2.13-12.8 0z" />
                  </svg>
                </Button>
              )}
            </div>
          </div>

          {/* 字符超限提示（仅接近/超过上限时） */}
          {(isNearLimit || isOverLimit) && charCount > 0 && (
            <div className="flex justify-end mt-1.5">
              <span
                className={cn(
                  'text-[11px] tabular-nums transition-colors',
                  isOverLimit
                    ? 'text-destructive font-medium'
                    : 'text-amber-500'
                )}
              >
                {charCount}/{CHAR_LIMIT}
              </span>
            </div>
          )}
        </div>

        {/* 底部状态 — 极简信息 */}
        <div className="flex items-center justify-between px-1 pt-1.5">
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
